import { spawn } from "node:child_process";

/**
 * Text output on macOS: typing into whatever is frontmost, and the clipboard.
 *
 * Both spawn rather than exec, so nothing blocks the plugin's event loop. The plugin is one Node
 * process serving every key on the deck, and a synchronous shell-out freezes all of them.
 */

/**
 * Escapes text for interpolation into an AppleScript string literal.
 *
 * AppleScript treats `\` as an escape character inside string literals, so an unescaped backslash
 * — a Windows path, a regex, escaped JSON, LaTeX — makes `osascript` fail to *compile*. That
 * surfaces as the button silently doing nothing, with no error anywhere.
 *
 * Backslashes are doubled first, or the escaping of the quotes would itself be escaped. Newlines
 * become `\n` / `\r` so the generated script stays on one line.
 */
export function escapeForAppleScript(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

/** Types text into the frontmost application. */
export async function simulateTyping(text: string): Promise<void> {
  const script = `tell application "System Events" to keystroke "${escapeForAppleScript(text)}"`;
  await runOsascript(script);
}

export async function copyToClipboard(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("pbcopy");
    proc.stdin.write(text);
    proc.stdin.end();
    proc.on("error", reject);
    proc.on("close", (code) => {
      code === 0 ? resolve() : reject(new Error("pbcopy failed"));
    });
  });
}

export async function readClipboard(): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("pbpaste");
    let out = "";
    proc.stdout.on("data", (chunk) => { out += chunk; });
    proc.on("error", reject);
    proc.on("close", (code) => {
      code === 0 ? resolve(out) : reject(new Error("pbpaste failed"));
    });
  });
}

/**
 * Runs a script on stdin.
 *
 * Fine for anything that produces no value. **A script whose result you need — `choose from list`
 * is the one that bites — must be run from a temp file instead**, or the selected value comes
 * back wrong.
 */
function runOsascript(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("osascript", ["-"]);
    proc.stdin.write(script);
    proc.stdin.end();
    proc.on("error", reject);
    proc.on("close", (code) => {
      code === 0 ? resolve() : reject(new Error(`osascript exited with code ${code}`));
    });
  });
}
