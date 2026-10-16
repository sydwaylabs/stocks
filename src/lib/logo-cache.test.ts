import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fileStem, LogoCache, sniffImage } from "./logo-cache.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const URL_A = "https://static2.finnhub.io/file/publicdatany/finnhubimage/stock_logo/AAPL.png";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "logos-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function server(body: Uint8Array, init: ResponseInit = {}) {
  return vi.fn(async () => new Response(body, { status: 200, ...init })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("sniffImage", () => {
  it("knows raster images by their first bytes", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffImage(Buffer.from("GIF89a"))).toBe("image/gif");
  });

  it("refuses HTML, SVG and anything else", () => {
    expect(sniffImage(Buffer.from("<html><body>Not found</body></html>"))).toBeNull();
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>'))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });
});

describe("fileStem", () => {
  it("keeps symbols as safe file names", () => {
    expect(fileStem("aapl")).toBe("AAPL");
    expect(fileStem("BRK-B")).toBe("BRK-B");
    expect(fileStem("../../etc/passwd")).toBeNull();
    expect(fileStem("")).toBeNull();
  });
});

describe("LogoCache", () => {
  it("downloads once, then serves from disk", async () => {
    const fetchImpl = server(PNG);
    const cache = new LogoCache(dir, { fetchImpl });
    expect(await cache.get("AAPL", URL_A)).toEqual({ type: "image/png", body: PNG });
    expect(await new LogoCache(dir, { fetchImpl }).get("AAPL", URL_A)).toEqual({ type: "image/png", body: PNG });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("shares one download between simultaneous asks", async () => {
    const fetchImpl = server(PNG);
    const cache = new LogoCache(dir, { fetchImpl });
    await Promise.all([cache.get("AAPL", URL_A), cache.get("aapl", URL_A)]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("downloads again after 30 days, or when the URL changes", async () => {
    let now = 1_000_000;
    const fetchImpl = server(PNG);
    const cache = new LogoCache(dir, { fetchImpl, now: () => now });
    await cache.get("AAPL", URL_A);
    await cache.get("AAPL", `${URL_A}?v=2`);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    now += 31 * 24 * 60 * 60_000;
    await cache.get("AAPL", `${URL_A}?v=2`);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("keeps serving an old logo when the download fails", async () => {
    let now = 1_000_000;
    await new LogoCache(dir, { fetchImpl: server(PNG), now: () => now }).get("AAPL", URL_A);
    now += 40 * 24 * 60 * 60_000;
    const failing = vi.fn(async () => { throw new TypeError("offline"); }) as unknown as typeof fetch;
    expect((await new LogoCache(dir, { fetchImpl: failing, now: () => now }).get("AAPL", URL_A))?.type).toBe("image/png");
  });

  it("stores nothing that is not an image, too big, or not https", async () => {
    expect(await new LogoCache(dir, { fetchImpl: server(Buffer.from("<html>")) }).get("A", URL_A)).toBeNull();
    expect(await new LogoCache(dir, { fetchImpl: server(PNG, { status: 404 }) }).get("B", URL_A)).toBeNull();
    const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]);
    expect(await new LogoCache(dir, { fetchImpl: server(big) }).get("C", URL_A)).toBeNull();
    const fetchImpl = server(PNG);
    expect(await new LogoCache(dir, { fetchImpl }).get("D", "http://example.com/x.png")).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ignores a cached file that has been replaced with something else", async () => {
    const fetchImpl = server(PNG);
    const cache = new LogoCache(dir, { fetchImpl });
    await cache.get("AAPL", URL_A);
    writeFileSync(join(dir, "AAPL.img"), "<html>");
    expect((await cache.get("AAPL", URL_A))?.type).toBe("image/png");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
