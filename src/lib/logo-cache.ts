import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { USER_AGENT, type Fetch } from "./providers/http.js";

/**
 * Company logos on disk, so the window does not download a 60 KB image from Finnhub every time it
 * opens, and does not load anything from the internet itself.
 *
 * Kept in ~/Library/Caches (macOS may clear it; that only costs a re-download). A logo is fetched
 * again after {@link MAX_AGE_MS}, or at once if Finnhub starts naming a different URL for it.
 *
 * Only real raster images are kept — identified by their first bytes, not the server's say-so — and
 * nothing over {@link MAX_BYTES}. An HTML error page, or an SVG that could carry script, is never
 * stored or served.
 */

const MAX_AGE_MS = 30 * 24 * 60 * 60_000;
const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 8_000;

export type Logo = { type: string; body: Buffer };

/** The image type from its first bytes, or null if it is not one we serve. */
export function sniffImage(body: Uint8Array): string | null {
  const b = body;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  if (b.length >= 6 && String.fromCharCode(...b.slice(0, 4)) === "GIF8") return "image/gif";
  return null;
}

/** Symbols become file names, so only a conservative alphabet survives. */
export function fileStem(symbol: string): string | null {
  const stem = symbol.toUpperCase().replace(/[^A-Z0-9.^=-]/g, "");
  return stem && stem.length <= 24 && !stem.startsWith(".") ? stem : null;
}

type Meta = { url: string; type: string; savedAt: number };

export class LogoCache {
  private readonly inflight = new Map<string, Promise<Logo | null>>();

  constructor(
    private readonly dir: string,
    private readonly options: { fetchImpl?: Fetch; now?: () => number } = {}
  ) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  /** The logo for `symbol`, from disk if it is fresh and from `url`, else downloaded. */
  async get(symbol: string, url: string): Promise<Logo | null> {
    const stem = fileStem(symbol);
    if (!stem) return null;
    const pending = this.inflight.get(stem);
    if (pending) return pending;
    const request = this.load(stem, url).finally(() => this.inflight.delete(stem));
    this.inflight.set(stem, request);
    return request;
  }

  private async load(stem: string, url: string): Promise<Logo | null> {
    const image = join(this.dir, `${stem}.img`);
    const metaPath = join(this.dir, `${stem}.json`);
    const cached = await this.read(image, metaPath);
    if (cached && cached.meta.url === url && this.now() - cached.meta.savedAt < MAX_AGE_MS) return cached.logo;

    const fresh = await this.download(url);
    if (!fresh) return cached?.logo ?? null; // An old logo beats none while Finnhub is unreachable.
    await mkdir(this.dir, { recursive: true });
    // Write beside, then rename, so a reader never sees half a file.
    await writeFile(`${image}.tmp`, fresh.body);
    await rename(`${image}.tmp`, image);
    const meta: Meta = { url, type: fresh.type, savedAt: this.now() };
    await writeFile(metaPath, JSON.stringify(meta));
    return fresh;
  }

  private async read(image: string, metaPath: string): Promise<{ logo: Logo; meta: Meta } | null> {
    try {
      const meta = JSON.parse(await readFile(metaPath, "utf8")) as Meta;
      if ((await stat(image)).size > MAX_BYTES) return null;
      const body = await readFile(image);
      const type = sniffImage(body);
      return type ? { logo: { type, body }, meta } : null;
    } catch {
      return null;
    }
  }

  private download(url: string): Promise<Logo | null> {
    return downloadImage(url, this.options.fetchImpl);
  }
}

/** An image from `url`: https only, at most {@link MAX_BYTES}, and a raster type by its bytes. */
export async function downloadImage(url: string, fetchImpl?: Fetch): Promise<Logo | null> {
  if (!/^https:\/\//.test(url)) return null;
  try {
    const res = await (fetchImpl ?? fetch)(url, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES) return null;
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > MAX_BYTES) return null;
    const type = sniffImage(body);
    return type ? { type, body } : null;
  } catch {
    return null;
  }
}
