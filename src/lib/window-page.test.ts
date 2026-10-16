import { describe, expect, it } from "vitest";

import { buildDetail, SearchSession, typeLabel } from "./detail-data.js";
import type { Snapshot } from "./quotes.js";
import { renderPage, scriptJson } from "./window-page.js";

function scriptsIn(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

describe("window page", () => {
  const inits = [
    { mode: "search" as const, windowTitle: "Stocks — choose a symbol" },
    { mode: "detail" as const, symbol: "AAPL", windowTitle: "Stocks — AAPL" },
    { mode: "detail" as const, symbol: "</script><script>bad()</script>", windowTitle: "</script>`${x}`" },
  ];

  it("emits two script blocks that parse, for every start", () => {
    for (const init of inits) {
      const scripts = scriptsIn(renderPage("tok</script>", init));
      expect(scripts).toHaveLength(2);
      for (const src of scripts) expect(() => new Function(src)).not.toThrow();
    }
  });

  it("escapes markup in embedded JSON", () => {
    expect(scriptJson("</script>")).toBe('"\\u003c/script>"');
  });

  it("writes data into the DOM only through textContent", () => {
    const html = renderPage("t", inits[1]);
    expect(html).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
  });
});

describe("detail data", () => {
  const snap: Snapshot = {
    quote: { symbol: "AAPL", name: "Apple Inc.", currency: "USD", price: 343.46, prevClose: 342, change: 1.46, changePct: 0.427, dayHigh: 347.82, dayLow: 340.46, marketTime: 1, source: "yahoo" },
    details: { exchange: "NasdaqGS", instrumentType: "EQUITY", wk52High: 348.15, wk52Low: 243.42, volume: 59_768_020, marketCap: 5.01e12 },
    series: { points: [342, 343] },
    fetchedAt: 2,
  };

  it("formats every field the window shows", () => {
    const d = buildDetail(snap);
    expect(d).toMatchObject({ symbol: "AAPL", price: "343.46", change: "+1.46", changePct: "+0.43%", trend: "up", source: "Yahoo Finance" });
    expect(d.ranges.map((r) => r.label)).toEqual(["Day range", "52-week range"]);
    expect(d.ranges[0].at).toBeGreaterThan(0);
    expect(d.ranges[0].at).toBeLessThan(1);
    expect(d.rows).toEqual([
      { label: "Previous close", value: "342.00" },
      { label: "Market cap", value: "5.01T" },
      { label: "Volume", value: "59.8M" },
      { label: "Type", value: "Stock" },
    ]);
    expect(d.note).toBeUndefined();
  });

  it("leaves out what the source did not give", () => {
    const d = buildDetail({ quote: { symbol: "X", price: 1, source: "finnhub" }, details: {}, fetchedAt: 0 });
    expect(d.ranges).toEqual([]);
    expect(d.rows).toEqual([]);
    expect(d.points).toEqual([]);
    expect(d.trend).toBe("flat");
  });

  it("notes a rejected key", () => {
    expect(buildDetail({ ...snap, keyRejected: true }).note).toMatch(/refused/);
  });

  it("labels instrument types", () => {
    expect(typeLabel("MUTUALFUND")).toBe("Fund");
    expect(typeLabel("Common Stock")).toBe("Common stock");
  });
});

describe("search session", () => {
  it("accepts only a symbol it last returned", () => {
    const session = new SearchSession();
    session.remember([{ symbol: "AAPL", name: "Apple", type: "EQUITY" }]);
    expect(session.pick("AAPL")?.name).toBe("Apple");
    expect(session.pick("MSFT")).toBeUndefined();
    expect(session.pick(42)).toBeUndefined();
    session.remember([{ symbol: "MSFT", name: "Microsoft", type: "EQUITY" }]);
    expect(session.pick("AAPL")).toBeUndefined();
  });
});
