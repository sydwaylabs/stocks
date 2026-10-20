import { describe, expect, it, vi } from "vitest";

import { ProviderError, type Quote } from "./providers/types.js";
import type { ChartResult } from "./providers/yahoo.js";
import { daysUntil, exchangeDate, isStale, QuoteService, unitOf, type Providers } from "./quotes.js";

function chart(symbol: string, overrides: Partial<Quote> = {}): ChartResult {
  return {
    quote: { symbol, name: `${symbol} Inc`, currency: "USD", price: 100, prevClose: 98, change: 2, changePct: 2.04, source: "yahoo", ...overrides },
    details: { instrumentType: "EQUITY", wk52High: 120, wk52Low: 80, volume: 1000 },
    series: { points: [98, 99, 100], times: [0, 1, 2], utcOffset: 0 },
  };
}

function finnhubQuote(symbol: string): Quote {
  return { symbol, price: 101, prevClose: 98, change: 3, changePct: 3.06, source: "finnhub" };
}

const fail = (kind: ConstructorParameters<typeof ProviderError>[0]) => () =>
  Promise.reject(new ProviderError(kind, kind));

function stubs(overrides: Partial<Providers> = {}): Providers {
  return {
    yahooChart: vi.fn(async (s: string) => chart(s)),
    yahooSearch: vi.fn(async () => [{ symbol: "AAPL", name: "Apple", type: "EQUITY" }]),
    yahooRange: vi.fn(async (s: string) => ({ ...chart(s), series: { points: [1, 2, 3, 4], times: [0, 1, 2, 3], utcOffset: 0 } })),
    finnhubQuote: vi.fn(async (s: string) => finnhubQuote(s)),
    finnhubProfile: vi.fn(async () => ({ name: "Apple Inc", exchange: "NASDAQ", marketCap: 3e12, industry: "Technology", country: "US", website: "https://www.apple.com/" })),
    finnhubMetric: vi.fn(async () => ({ wk52High: 130, wk52Low: 70, pe: 31.2, eps: 6.1, dividendYield: 0.44, beta: 1.2 })),
    finnhubEarnings: vi.fn(async () => ({ date: "2026-10-29", hour: "amc" as const })),
    finnhubSearch: vi.fn(async () => [{ symbol: "AAPL", name: "APPLE INC", type: "Common Stock" }]),
    nasdaqMarketCap: vi.fn(async () => 2e12),
    ...overrides,
  };
}

describe("QuoteService.snapshot", () => {
  it("uses Yahoo when there is no key", async () => {
    const providers = stubs();
    const snap = await new QuoteService(() => null, { providers }).snapshot("aapl");
    expect(snap.quote.source).toBe("yahoo");
    expect(snap.series?.points).toHaveLength(3);
    expect(providers.finnhubQuote).not.toHaveBeenCalled();
    expect(providers.yahooChart).toHaveBeenCalledWith("AAPL");
  });

  it("prices from Finnhub with a key, keeping Yahoo's name and sparkline", async () => {
    const snap = await new QuoteService(() => "k", { providers: stubs() }).snapshot("AAPL");
    expect(snap.quote).toMatchObject({ source: "finnhub", price: 101, name: "AAPL Inc", currency: "USD" });
    expect(snap.series?.points).toHaveLength(3);
  });

  it("falls back to Yahoo for symbols Finnhub cannot price", async () => {
    for (const kind of ["not-found", "no-access", "rate-limited", "unavailable"] as const) {
      const service = new QuoteService(() => "k", { providers: stubs({ finnhubQuote: fail(kind) }) });
      const snap = await service.snapshot("VOD.L");
      expect(snap.quote.source).toBe("yahoo");
      expect(snap.keyRejected).toBeUndefined();
    }
  });

  it("does not ask Finnhub about indices, foreign listings or coins", async () => {
    const providers = stubs();
    const service = new QuoteService(() => "k", { providers });
    for (const symbol of ["^GSPTSE", "RY.TO", "VOD.L", "BTC-USD"]) {
      const snap = await service.snapshot(symbol);
      expect(snap.quote.source).toBe("yahoo");
      expect(snap.keyRejected).toBeUndefined();
      expect(await service.earnings(symbol)).toBeUndefined();
    }
    expect(providers.finnhubQuote).not.toHaveBeenCalled();
    expect(providers.finnhubEarnings).not.toHaveBeenCalled();
  });

  it("flags a rejected key while still answering from Yahoo", async () => {
    const snap = await new QuoteService(() => "bad", { providers: stubs({ finnhubQuote: fail("unauthorized") }) }).snapshot("AAPL");
    expect(snap.quote.source).toBe("yahoo");
    expect(snap.keyRejected).toBe(true);
  });

  it("still prices from Finnhub when Yahoo is down", async () => {
    const snap = await new QuoteService(() => "k", { providers: stubs({ yahooChart: fail("unavailable") }) }).snapshot("AAPL");
    expect(snap.quote.source).toBe("finnhub");
    expect(snap.series).toBeUndefined();
  });

  it("surfaces Yahoo's failure when there is no key", async () => {
    const service = new QuoteService(() => null, { providers: stubs({ yahooChart: fail("unavailable") }) });
    await expect(service.snapshot("AAPL")).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("prefers not-found when both sources fail", async () => {
    const service = new QuoteService(() => "k", {
      providers: stubs({ yahooChart: fail("unavailable"), finnhubQuote: fail("not-found") }),
    });
    await expect(service.snapshot("ZZZ")).rejects.toMatchObject({ kind: "not-found" });
  });

  it("serves keys on one symbol with one request, and re-asks once the cache is stale", async () => {
    let now = 1_000_000;
    const providers = stubs();
    const service = new QuoteService(() => null, { providers, now: () => now });
    await Promise.all([service.snapshot("AAPL"), service.snapshot("aapl"), service.snapshot(" AAPL ")]);
    expect(providers.yahooChart).toHaveBeenCalledTimes(1);
    await service.snapshot("AAPL");
    expect(providers.yahooChart).toHaveBeenCalledTimes(1);
    now += 60_000;
    await service.snapshot("AAPL");
    expect(providers.yahooChart).toHaveBeenCalledTimes(2);
  });

  it("skips the cache when forced, but not twice within a few seconds", async () => {
    let now = 1_000_000;
    const providers = stubs();
    const service = new QuoteService(() => null, { providers, now: () => now });
    await service.snapshot("AAPL");
    now += 6_000;
    await service.snapshot("AAPL", { force: true });
    expect(providers.yahooChart).toHaveBeenCalledTimes(2);
    now += 2_000;
    await service.snapshot("AAPL", { force: true });
    expect(providers.yahooChart).toHaveBeenCalledTimes(2);
  });

  it("asks only Yahoo for a lite quote, which never stands in for a full one", async () => {
    const providers = stubs();
    const service = new QuoteService(() => "k", { providers });
    expect((await service.snapshot("AAPL", { lite: true })).quote.source).toBe("yahoo");
    expect(providers.finnhubQuote).not.toHaveBeenCalled();
    // A key or the panel still gets Finnhub's price...
    expect((await service.snapshot("AAPL")).quote.source).toBe("finnhub");
    expect(providers.finnhubQuote).toHaveBeenCalledTimes(1);
    // ...and that full answer serves the list too.
    await service.snapshot("AAPL", { lite: true });
    expect(providers.yahooChart).toHaveBeenCalledTimes(2);
  });

  it("keeps a lite quote for an index, which a key would not have priced anyway, as the full one", async () => {
    const providers = stubs();
    const service = new QuoteService(() => "k", { providers });
    await service.snapshot("^GSPC", { lite: true });
    await service.snapshot("^GSPC");
    expect(providers.yahooChart).toHaveBeenCalledTimes(1);
  });

  it("keeps a quote fetched after the close for minutes, not seconds", async () => {
    let now = 1_000_000;
    const closed = { ...chart("AAPL"), series: { points: [98, 99, 100], times: [0, 1, 2], utcOffset: 0, session: { start: 0, end: now - 60_000 } } };
    const open = { ...chart("MSFT"), series: { points: [98, 99, 100], times: [0, 1, 2], utcOffset: 0, session: { start: 0, end: now + 3_600_000 } } };
    const providers = stubs({ yahooChart: vi.fn(async (s: string) => (s === "AAPL" ? closed : open)) });
    const service = new QuoteService(() => null, { providers, now: () => now });
    await service.snapshot("AAPL");
    await service.snapshot("MSFT");
    now += 60_000;
    await service.snapshot("AAPL");
    await service.snapshot("MSFT");
    // Only the open market was asked again.
    expect(providers.yahooChart).toHaveBeenCalledTimes(3);
    now += 5 * 60_000;
    await service.snapshot("AAPL");
    expect(providers.yahooChart).toHaveBeenCalledTimes(4);
  });
});

describe("QuoteService.detailed", () => {
  it("takes market cap, ratios, company facts and earnings from Finnhub with a key", async () => {
    const snap = await new QuoteService(() => "k", { providers: stubs() }).detailed("AAPL");
    expect(snap.details).toMatchObject({
      marketCap: 3e12, wk52High: 130, wk52Low: 70, pe: 31.2, eps: 6.1, dividendYield: 0.44, beta: 1.2,
      industry: "Technology", country: "US", website: "https://www.apple.com/",
      earnings: { date: "2026-10-29", hour: "amc" },
    });
    // Yahoo's exchange name stays; Finnhub's profile does not overwrite it.
    expect(snap.details.exchange).toBeUndefined();
  });

  it("adds no Finnhub extras without a key", async () => {
    const providers = stubs();
    const snap = await new QuoteService(() => null, { providers }).detailed("AAPL");
    expect(snap.details.pe).toBeUndefined();
    expect(snap.details.earnings).toBeUndefined();
    expect(providers.finnhubMetric).not.toHaveBeenCalled();
    expect(providers.finnhubEarnings).not.toHaveBeenCalled();
  });

  it("asks Nasdaq for market cap on a US equity without a key", async () => {
    const providers = stubs();
    const snap = await new QuoteService(() => null, { providers }).detailed("AAPL");
    expect(snap.details.marketCap).toBe(2e12);
    expect(snap.details.wk52High).toBe(120);
  });

  it("does not ask Nasdaq about non-US listings or crypto", async () => {
    const providers = stubs({
      yahooChart: vi.fn(async (s: string) =>
        s === "BTC-USD"
          ? { ...chart(s), details: { instrumentType: "CRYPTOCURRENCY" } }
          : chart(s, { currency: "GBp" })),
    });
    const service = new QuoteService(() => null, { providers });
    expect((await service.detailed("VOD.L")).details.marketCap).toBeUndefined();
    expect((await service.detailed("BTC-USD")).details.marketCap).toBeUndefined();
    expect(providers.nasdaqMarketCap).not.toHaveBeenCalled();
  });

  it("leaves market cap out when Nasdaq fails", async () => {
    const snap = await new QuoteService(() => null, { providers: stubs({ nasdaqMarketCap: fail("unavailable") }) }).detailed("AAPL");
    expect(snap.details.marketCap).toBeUndefined();
  });
});

describe("QuoteService.earnings", () => {
  it("needs a key, caches for hours, and swallows failures", async () => {
    let now = Date.parse("2026-10-20T15:00:00Z");
    const providers = stubs();
    expect(await new QuoteService(() => null, { providers }).earnings("AAPL")).toBeUndefined();
    expect(providers.finnhubEarnings).not.toHaveBeenCalled();

    const service = new QuoteService(() => "k", { providers, now: () => now });
    expect(await service.earnings("aapl")).toEqual({ date: "2026-10-29", hour: "amc" });
    expect(providers.finnhubEarnings).toHaveBeenCalledWith("AAPL", "k", "2026-10-20");
    await service.earnings("AAPL");
    expect(providers.finnhubEarnings).toHaveBeenCalledTimes(1);
    now += 7 * 60 * 60_000;
    await service.earnings("AAPL");
    expect(providers.finnhubEarnings).toHaveBeenCalledTimes(2);

    const failing = new QuoteService(() => "k", { providers: stubs({ finnhubEarnings: fail("no-access") }) });
    expect(await failing.earnings("VOD.L")).toBeUndefined();
  });

  it("dates by Wall Street's calendar", () => {
    // 02:00 UTC on the 21st is still the 20th in New York.
    expect(exchangeDate(Date.parse("2026-10-21T02:00:00Z"))).toBe("2026-10-20");
    expect(daysUntil("2026-10-29", "2026-10-20")).toBe(9);
    expect(daysUntil("2026-11-02", "2026-10-31")).toBe(2);
    expect(daysUntil("2026-10-19", "2026-10-20")).toBe(-1);
  });
});

describe("QuoteService.chart", () => {
  it("draws today from the quote already fetched, and longer ranges on request, cached", async () => {
    let now = 1_000_000;
    const providers = stubs();
    const service = new QuoteService(() => null, { providers, now: () => now });
    expect((await service.chart("AAPL", "1d")).points).toEqual([98, 99, 100]);
    expect(providers.yahooRange).not.toHaveBeenCalled();
    expect((await service.chart("AAPL", "5d")).points).toHaveLength(4);
    await service.chart("aapl", "5d");
    expect(providers.yahooRange).toHaveBeenCalledTimes(1);
    expect(providers.yahooRange).toHaveBeenCalledWith("AAPL", "5d");
    now += 11 * 60_000;
    await service.chart("AAPL", "5d");
    expect(providers.yahooRange).toHaveBeenCalledTimes(2);
  });

  it("asks past the cache when forced, as the window's refresh does", async () => {
    let now = 1_000_000;
    const providers = stubs();
    const service = new QuoteService(() => null, { providers, now: () => now });
    await service.chart("AAPL", "5d");
    await service.chart("AAPL", "1d");
    now += 6_000;
    await service.chart("AAPL", "5d", { force: true });
    expect(providers.yahooRange).toHaveBeenCalledTimes(2);
    await service.chart("AAPL", "1d", { force: true });
    expect(providers.yahooChart).toHaveBeenCalledTimes(2);
  });

  it("fetches today's chart itself when the quote came without one", async () => {
    const providers = stubs({ yahooChart: fail("unavailable") });
    await new QuoteService(() => "k", { providers }).chart("AAPL", "1d");
    expect(providers.yahooRange).toHaveBeenCalledWith("AAPL", "1d");
  });
});

describe("QuoteService.logo", () => {
  it("asks for one profile per symbol, keeps it a day, and shares it with the detail view", async () => {
    let now = 1_000_000;
    const providers = stubs({ finnhubProfile: vi.fn(async () => ({ logo: "https://x/AAPL.png", marketCap: 3e12 })) });
    const service = new QuoteService(() => "k", { providers, now: () => now });
    await Promise.all([service.logo("AAPL"), service.logo("aapl")]);
    expect(await service.logo("AAPL")).toBe("https://x/AAPL.png");
    await service.detailed("AAPL");
    expect(providers.finnhubProfile).toHaveBeenCalledTimes(1);
    now += 25 * 60 * 60_000;
    await service.logo("AAPL");
    expect(providers.finnhubProfile).toHaveBeenCalledTimes(2);
  });

  it("has none without a key, for foreign listings, or when Finnhub fails — and retries a failure", async () => {
    const providers = stubs();
    expect(await new QuoteService(() => null, { providers }).logo("AAPL")).toBeUndefined();
    expect(await new QuoteService(() => "k", { providers }).logo("RY.TO")).toBeUndefined();
    expect(providers.finnhubProfile).not.toHaveBeenCalled();
    const failing = stubs({ finnhubProfile: vi.fn(fail("rate-limited")) });
    const service = new QuoteService(() => "k", { providers: failing });
    expect(await service.logo("AAPL")).toBeUndefined();
    await service.logo("AAPL");
    expect(failing.finnhubProfile).toHaveBeenCalledTimes(2);
  });
});

describe("QuoteService.search", () => {
  it("uses Yahoo, and Finnhub only when Yahoo fails and a key is set", async () => {
    const providers = stubs({ yahooSearch: fail("unavailable") });
    expect(await new QuoteService(() => "k", { providers }).search("apple")).toHaveLength(1);
    expect(providers.finnhubSearch).toHaveBeenCalledWith("apple", "k");
    await expect(new QuoteService(() => null, { providers }).search("apple")).rejects.toBeInstanceOf(ProviderError);
  });

  it("returns nothing for a blank query without asking anyone", async () => {
    const providers = stubs();
    expect(await new QuoteService(() => null, { providers }).search("  ")).toEqual([]);
    expect(providers.yahooSearch).not.toHaveBeenCalled();
  });
});

describe("isStale", () => {
  const series = (end: number) => ({ points: [1, 2], times: [0, 1], utcOffset: 0, session: { start: 0, end } });
  it("fades an old quote from an open market, never one fetched after the close", () => {
    expect(isStale({ fetchedAt: 1_000, series: series(5_000) }, 60_000, 200_000)).toBe(true);
    expect(isStale({ fetchedAt: 1_000, series: series(5_000) }, 60_000, 30_000)).toBe(false);
    expect(isStale({ fetchedAt: 6_000, series: series(5_000) }, 60_000, 9_000_000)).toBe(false);
    expect(isStale({ fetchedAt: 1_000 }, 60_000, 200_000)).toBe(true);
  });
});

describe("unitOf", () => {
  it("counts an index in points, whatever currency Yahoo gives it", () => {
    const quote = { symbol: "^GSPTSE", price: 1, currency: "CAD", source: "yahoo" as const };
    expect(unitOf({ quote, details: { instrumentType: "INDEX" } })).toBe("points");
    expect(unitOf({ quote, details: {} })).toBe("points");
    expect(unitOf({ quote: { ...quote, symbol: "RY.TO" }, details: { instrumentType: "EQUITY" } })).toBe("CAD");
  });
});
