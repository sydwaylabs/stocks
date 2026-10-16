import { describe, expect, it } from "vitest";

import { compact, formatChange, formatChangeShort, formatPct, formatPrice } from "./format.js";
import { escapeXml, mixHex, numberFont, renderKey, sparkline, symbolFont } from "./key-image.js";

describe("format", () => {
  it("keeps prices to eight characters or fewer", () => {
    for (const p of [0.000123, 0.5, 1.5, 343.46, 1234.56, 81651.17, 123456.7, 98765432]) {
      expect(formatPrice(p).length, `${p} → ${formatPrice(p)}`).toBeLessThanOrEqual(8);
    }
    expect(formatPrice(343.46)).toBe("343.46");
    expect(formatPrice(1234.56)).toBe("1,234.6");
    expect(formatPrice(81651.17)).toBe("81,651");
    expect(formatPrice(0.0001234)).toBe("0.000123");
  });

  it("signs percentages with ASCII", () => {
    expect(formatPct(0.427)).toBe("+0.43%");
    expect(formatPct(-1.5)).toBe("-1.50%");
    expect(formatPct(0)).toBe("0.00%");
    expect(formatPct(-0.001)).toBe("0.00%");
    expect(formatPct(undefined)).toBe("");
  });

  it("formats the move as an amount for the key", () => {
    expect(formatChangeShort(1.46, "USD")).toBe("+$1.46");
    expect(formatChangeShort(-0.52, "GBP")).toBe("-£0.52");
    expect(formatChangeShort(-371.625, "USD")).toBe("-$371.63");
    expect(formatChangeShort(-1234.5, "USD")).toBe("-$1,235");
    expect(formatChangeShort(0.5, "GBp")).toBe("+0.50");
    expect(formatChangeShort(0, undefined)).toBe("0.00");
    expect(formatChangeShort(undefined, "USD")).toBe("");
  });

  it("formats change and big numbers", () => {
    expect(formatChange(-0.07)).toBe("-0.07");
    expect(formatChange(1.2)).toBe("+1.20");
    expect(compact(5_012_517_062_800)).toBe("5.01T");
    expect(compact(845_200_000_000)).toBe("845B");
    expect(compact(59_768_020)).toBe("59.8M");
    expect(compact(950)).toBe("950");
  });
});

describe("key image", () => {
  const quote = {
    kind: "quote" as const, symbol: "AAPL", price: 343.46, change: 1.46, changePct: 0.43,
    points: [340, 342, 341, 343.46], prevClose: 342, currency: "USD", display: "price" as const, changeAs: "percent" as const, stale: false,
  };

  it("draws a 144 square svg for every view", () => {
    const views = [
      { kind: "empty" as const },
      { kind: "loading" as const, symbol: "AAPL" },
      { kind: "error" as const, symbol: "ZZZ", message: "Not found" },
      quote,
      { ...quote, display: "change" as const },
      { ...quote, stale: true },
    ];
    for (const view of views) {
      const svg = renderKey(view);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).toContain('viewBox="0 0 144 144"');
      expect(svg).not.toMatch(/rgba\(/);
    }
  });

  it("shows the move as a percentage or an amount", () => {
    expect(renderKey(quote)).toContain("+0.43%");
    expect(renderKey({ ...quote, changeAs: "amount" })).toContain("+$1.46");
    expect(renderKey({ ...quote, changeAs: "amount" })).not.toContain("%");
    expect(renderKey({ ...quote, display: "change", changeAs: "amount" })).toContain("+$1.46");
  });

  it("colours by trend and dims when stale", () => {
    expect(renderKey(quote)).toContain("#29bd50");
    expect(renderKey({ ...quote, change: -1, changePct: -0.3 })).toContain("#ef4b4b");
    expect(renderKey({ ...quote, stale: true })).not.toContain('fill="#29bd50"');
  });

  it("escapes markup in symbols", () => {
    const svg = renderKey({ kind: "error", symbol: "<b>&", message: "x" });
    expect(svg).not.toContain("<b>");
    expect(escapeXml(`<"&'>`)).toBe("&#60;&#34;&#38;&#39;&#62;");
  });

  it("sizes text by length", () => {
    expect(symbolFont("AAPL").size).toBeGreaterThan(symbolFont("BTC-USD").size);
    expect(symbolFont("VERYLONGSYMBOL").text).toBe("VERYLONG…");
    expect(numberFont("343.46")).toBeGreaterThan(numberFont("1,234.6"));
  });

  it("draws no sparkline from fewer than two points", () => {
    expect(sparkline([1], 1, "#fff", { x: 0, y: 0, w: 10, h: 10 })).toBe("");
    expect(sparkline([1, 2], undefined, "#fff", { x: 0, y: 0, w: 10, h: 10 })).toContain("polyline");
  });

  it("mixes solid colours", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});
