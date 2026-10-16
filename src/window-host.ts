import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, chmod } from "node:fs/promises";
import { constants } from "node:fs";
import { type AddressInfo } from "node:net";
import { platform } from "node:os";

/**
 * The plumbing every plugin window shares: an ephemeral loopback server, a token that gates it,
 * a native host to display it, and the rules for when a host has failed rather than been closed.
 *
 * Use this for every window in a plugin rather than copying it per window. A second copy is how
 * one plugin came to have its host lookup in three places, and duplicated security code is the
 * kind that drifts.
 *
 * Callers supply the page and handle their own message types; ping, close and error are handled
 * here because they mean the same thing for any window.
 *
 * See references/native-window.md for the architecture and the macOS behaviour behind it.
 */

/** Bundled native host, relative to the sdPlugin root (the plugin's working directory). */
const NATIVE_HOST = "bin/stocks-host";

/** Chromium-family browsers that support `--app=` windows, in preference order. */
const BROWSER_CANDIDATES: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ],
  // The native host is macOS only and there is no osascript fallback on Windows, so a browser is
  // the only way these windows work there.
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
};

/**
 * A host that never asked for the page has failed, even if its process is still alive: a binary
 * macOS refuses to run can hang rather than exit.
 */
const PAGE_LOAD_TIMEOUT_MS = 6_000;

/** Thrown when a host could not display anything — try the next one, do not treat as a close. */
export class WindowLaunchError extends Error {}

/**
 * Returns every command capable of showing a window, best first.
 *
 * All of them rather than the best one, because a host can be present yet unlaunchable — a
 * quarantined unsigned binary is the usual case — so callers work down the list.
 */
export async function findHosts(): Promise<string[]> {
  const hosts: string[] = [];
  try {
    await access(NATIVE_HOST, constants.X_OK);
    hosts.push(NATIVE_HOST);
  } catch {
    // `streamdeck pack` stores no permission bits, so a packed install's host arrives without its
    // exec bit. plugin.js is unaffected because Stream Deck runs it as an argument to node.
    try {
      await access(NATIVE_HOST, constants.F_OK);
      await chmod(NATIVE_HOST, 0o755);
      await access(NATIVE_HOST, constants.X_OK);
      hosts.push(NATIVE_HOST);
    } catch {
      // Not built for this checkout, or not writable — browsers only.
    }
  }
  for (const path of BROWSER_CANDIDATES[platform()] ?? []) {
    try {
      await access(path);
      hosts.push(path);
    } catch {
      // Not installed — try the next candidate.
    }
  }
  return hosts;
}

export type WindowMessage = { type?: unknown } & Record<string, unknown>;

export type ServeWindowOptions = {
  /** Builds the page. Called per request, so a mutating window re-renders on refresh. */
  renderPage: (token: string) => string;
  /**
   * Handles anything beyond ping, close and error. Whatever it resolves to is sent back as the
   * JSON reply; returning nothing sends `{}`.
   */
  onMessage?: (message: WindowMessage) => Promise<unknown> | unknown;
  /**
   * Serves an extra HTML page, for a window that embeds another one in a pane. Return null and
   * the request 404s, so a caller can validate the parameters and refuse rather than render
   * something for an id it does not recognise.
   */
  renderRoute?: (pathname: string, params: URLSearchParams) => string | null;
  /** Hands back a closer so the caller can dismiss the window when its key goes away. */
  onOpen?: (close: () => void) => void;
  onWarn?: (message: string) => void;
  /** Abandon the window after this long without a ping. Polling deliberately does not count. */
  timeoutMs: number;
  width: number;
  height: number;
  /**
   * The window's title, as `NSWindow.title`. Read only by the native host. It hides the title
   * bar's text and runs as an accessory app, with no menu bar, no Window menu and no Dock icon,
   * so a sighted user never sees this. VoiceOver does, and it tells two open windows apart
   * there. The page has to show the window's name itself; see references/page-conventions.md.
   *
   * Chrome's `--app=` mode has no equivalent flag; its window follows the page's own
   * `document.title`, so a caller wanting the browser fallback titled the same way sets that from
   * the page. Omitted, the native host falls back to "Plugin".
   */
  title?: string;
  /**
   * Web pages the window may open in the default browser, by exact URL — a credit that links to
   * its source, a help page. The page asks with `{ type: "openLink", url }`; a plain link does
   * nothing, because the host handles no new windows and WKWebView ignores `target=_blank` without
   * one. Exact rather than by domain, because anything the page can ask for, an injected script
   * could ask for too.
   */
  links?: readonly string[];
  /**
   * Extra flags for the native host, such as `--no-focus`.
   *
   * Appended after the standard ones. Chromium ignores flags it does not know, so the browser
   * fallback keeps working — but a flag that changes behaviour will only take effect under the
   * native host, so nothing here may be load-bearing.
   */
  hostArgs?: string[];
};

/**
 * Serves a window and resolves when it closes.
 *
 * @param hostPath Executable from {@link findHosts}. Spawned directly rather than through `open`,
 * because `open -a` drops `--args` when the browser is already running, which would surface the
 * page as an ordinary tab instead of an app window.
 */
export async function serveWindow(
  hostPath: string,
  options: ServeWindowOptions
): Promise<void> {
  const token = randomBytes(16).toString("hex");
  const warn = options.onWarn ?? (() => { /* caller opted out of diagnostics */ });

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let child: ChildProcess | undefined;
    let idleTimer: NodeJS.Timeout | undefined;
    let loadWatchdog: NodeJS.Timeout | undefined;
    let pageServed = false;

    const server = createServer(handle);

    function stop(): void {
      if (idleTimer) clearTimeout(idleTimer);
      if (loadWatchdog) clearTimeout(loadWatchdog);
      server.close();
      // The window owns nothing else, so terminating the host is safe.
      child?.kill();
    }

    function finish(): void {
      if (settled) return;
      settled = true;
      stop();
      resolve();
    }

    /** A host that never displayed anything — the caller should try the next one. */
    function failLaunch(detail: string): void {
      if (settled) return;
      settled = true;
      stop();
      reject(new WindowLaunchError(`${hostPath} failed to launch: ${detail}`));
    }

    function armIdleTimer(): void {
      if (settled) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(finish, options.timeoutMs);
    }

    function sendJson(res: ServerResponse, payload: unknown): void {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(payload ?? {}));
    }

    function handle(req: IncomingMessage, res: ServerResponse): void {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      // Any local process can reach this port, so the token gates every route before any routing.
      if (url.searchParams.get("t") !== token) {
        res.writeHead(403).end("forbidden");
        return;
      }

      if (url.pathname === "/") {
        pageServed = true;
        if (loadWatchdog) clearTimeout(loadWatchdog);
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        }).end(options.renderPage(token));
        return;
      }

      const extra = options.renderRoute?.(url.pathname, url.searchParams);
      if (typeof extra === "string") {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        }).end(extra);
        return;
      }

      if (url.pathname === "/message" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          let parsed: WindowMessage;
          try {
            parsed = JSON.parse(body) as WindowMessage;
          } catch {
            sendJson(res, {});
            return;
          }

          if (parsed.type === "ping") {
            armIdleTimer();
            sendJson(res, {});
            return;
          }

          if (parsed.type === "error" && typeof parsed.message === "string") {
            warn(`window page error: ${parsed.message}`);
            sendJson(res, {});
            return;
          }

          if (parsed.type === "close") {
            sendJson(res, {});
            finish();
            return;
          }

          if (parsed.type === "openLink") {
            const link = typeof parsed.url === "string" ? parsed.url : "";
            if ((options.links ?? []).includes(link) && platform() === "darwin") {
              spawn("open", [link], { stdio: "ignore", detached: true }).unref();
            } else {
              warn(`window asked to open a link it was not given: ${link.slice(0, 120)}`);
            }
            sendJson(res, {});
            return;
          }

          const handler = options.onMessage;
          if (!handler) {
            sendJson(res, {});
            return;
          }
          Promise.resolve()
            .then(() => handler(parsed))
            .then((reply) => sendJson(res, reply))
            .catch((error: unknown) => {
              const message = error instanceof Error ? error.message : "Failed";
              warn(`window message "${String(parsed.type)}" failed: ${message}`);
              sendJson(res, { message });
            });
        });
        return;
      }

      res.writeHead(404).end("not found");
    }

    server.on("error", (error) => failLaunch(error.message));

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const target = `http://127.0.0.1:${port}/?t=${token}`;
      // Chrome's own flag spelling, which the native host also accepts, so the two are
      // interchangeable and nothing here needs to know which one it spawned. `--title` is the
      // exception: Chrome has no such flag and silently ignores it, but the native host reads it,
      // so it is always safe to pass and only sometimes does anything.
      child = spawn(hostPath, [
        `--app=${target}`,
        `--window-size=${options.width},${options.height}`,
        "--no-first-run",
        "--no-default-browser-check",
        ...(options.title ? [`--title=${options.title}`] : []),
        ...(options.hostArgs ?? []),
      ], { stdio: ["ignore", "ignore", "pipe"], detached: false });

      child.stderr?.on("data", (chunk) => {
        const text = String(chunk).trim();
        if (text) warn(text);
      });

      child.on("error", (error) => failLaunch(error.message));

      // Exit status separates the two reasons a host can be gone: code 0 means it ran and the
      // window was closed (the page's own close message usually beats this, but it can lose the
      // race); anything else means it never displayed, and the next host is worth trying.
      child.on("exit", (code, signal) => {
        if (settled) return;
        if (code === 0 && !signal) finish();
        else failLaunch(signal ? `killed by ${signal}` : `exited with code ${code}`);
      });

      options.onOpen?.(finish);
      armIdleTimer();
      loadWatchdog = setTimeout(() => {
        if (!pageServed) failLaunch(`never requested the page within ${PAGE_LOAD_TIMEOUT_MS}ms`);
      }, PAGE_LOAD_TIMEOUT_MS);
    });
  });
}
