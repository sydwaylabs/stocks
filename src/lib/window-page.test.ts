import { describe, expect, it } from "vitest";

import { buildBoardCard, buildDetail, formatEarnings, SearchSession, thin, typeLabel } from "./detail-data.js";
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
    { mode: "search" as const, windowTitle: "Stocks — add to watchlist", adding: true, canChange: false },
    { mode: "board" as const, symbol: "AAPL", windowTitle: "Stocks — watchlist", adding: true, canChange: false },
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
    series: { points: [342, 343], times: [0, 1], utcOffset: 0 },
    fetchedAt: 2,
  };

  it("formats every field the window shows", () => {
    const d = buildDetail(snap);
    expect(d).toMatchObject({ symbol: "AAPL", price: "343.46", change: "+1.46", changePct: "+0.43%", trend: "up", source: "Yahoo Finance" });
    expect(d.rows).toEqual([
      { label: "Day range", value: "340.46 – 347.82" },
      { label: "52-week range", value: "243.42 – 348.15" },
      { label: "Previous close", value: "342.00" },
      { label: "Market cap", value: "5.01T" },
      { label: "Volume", value: "59.8M" },
      { label: "Type", value: "Stock" },
    ]);
    expect(d.note).toBeUndefined();
  });

  it("leaves out what the source did not give", () => {
    const d = buildDetail({ quote: { symbol: "X", price: 1, source: "finnhub" }, details: {}, fetchedAt: 0 });
    expect(d.rows).toEqual([]);
    expect(d.chart).toBeUndefined();
    expect(d.trend).toBe("flat");
  });

  it("adds the Finnhub rows when they are there", () => {
    const d = buildDetail({
      ...snap,
      details: { ...snap.details, pe: 31.24, eps: 6.1, dividendYield: 0.4412, beta: 1.2, earnings: { date: "2026-10-29", hour: "amc" }, industry: "Technology", country: "US", website: "https://www.apple.com/" },
    });
    expect(d.rows.map((r) => r.label)).toEqual([
      "Day range", "52-week range", "Previous close", "Market cap", "Volume", "P/E (TTM)", "EPS (TTM)", "Dividend yield", "Beta", "Next earnings", "Type",
    ]);
    expect(d.rows.find((r) => r.label === "Dividend yield")?.value).toBe("0.44%");
    expect(d.company).toBe("Technology · US");
    expect(d.website).toBe("https://www.apple.com/");
  });

  it("formats an earnings date as written, with its session", () => {
    expect(formatEarnings({ date: "2026-10-29", hour: "amc" })).toBe("Thu Oct 29, after close");
    expect(formatEarnings({ date: "2026-11-02", hour: "bmo" })).toBe("Mon Nov 2, before open");
    expect(formatEarnings({ date: "2026-11-02" })).toBe("Mon Nov 2");
  });

  it("notes a rejected key", () => {
    expect(buildDetail({ ...snap, keyRejected: true }).note).toMatch(/refused/);
  });

  it("labels instrument types", () => {
    expect(typeLabel("MUTUALFUND")).toBe("Fund");
    expect(typeLabel("Common Stock")).toBe("Common stock");
  });
});

describe("board cards", () => {
  it("formats a card, thinning the sparkline but keeping the last price", () => {
    const points = Array.from({ length: 79 }, (_, i) => 340 + i * 0.01);
    const card = buildBoardCard({
      quote: { symbol: "AAPL", name: "Apple Inc.", currency: "USD", price: 343.46, prevClose: 342, change: 1.46, changePct: 0.427, source: "yahoo" },
      details: {}, series: { points, times: points.map((_, i) => i), utcOffset: 0 }, fetchedAt: 0,
    });
    expect(card).toMatchObject({ symbol: "AAPL", price: "343.46", change: "+1.46", changePct: "+0.43%", changeAmount: "+$1.46", trend: "up" });
    expect(card.points.length).toBeLessThanOrEqual(61);
    expect(card.points.at(-1)).toBe(points.at(-1));
  });

  it("thins only long series", () => {
    expect(thin([1, 2, 3], 60)).toEqual([1, 2, 3]);
    expect(thin([0, 1, 2, 3, 4, 5, 6], 3)).toEqual([0, 3, 6]);
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
