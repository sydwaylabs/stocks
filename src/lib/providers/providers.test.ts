import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import * as finnhub from "./finnhub.js";
import { getJson } from "./http.js";
import { parseMarketCap } from "./nasdaq.js";
import { ProviderError } from "./types.js";
import { parseChart, parseExtended, parseNews, parseSearch } from "./yahoo.js";

/** Fixtures were captured from the live endpoints on 2026-10-16, then trimmed. */
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

function kindOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof ProviderError ? error.kind : "other";
  }
  return undefined;
}

describe("yahoo chart", () => {
  it("parses a US equity", () => {
    const { quote, details, series } = parseChart(fixture("yahoo-chart-aapl.json"), "AAPL");
    expect(quote.symbol).toBe("AAPL");
    expect(quote.source).toBe("yahoo");
    expect(quote.currency).toBe("USD");
    expect(quote.price).toBeGreaterThan(0);
    expect(quote.prevClose).toBeGreaterThan(0);
    expect(quote.change).toBeCloseTo(quote.price - quote.prevClose!, 6);
    expect(quote.marketTime).toBeGreaterThan(1_700_000_000_000);
    expect(details.instrumentType).toBe("EQUITY");
    expect(details.wk52High).toBeGreaterThanOrEqual(details.wk52Low!);
    expect(details.marketCap).toBeUndefined();
  });

  it("takes the last after-hours trade, with its time, once after-hours trading has ended", () => {
    // Captured at 20:03 ET, when Yahoo's fulldayPrice had already fallen back to the close.
    const x = parseExtended(fixture("yahoo-chart-tsla-prepost.json"));
    expect(x).toMatchObject({ price: 380.45, session: "post" });
    expect(new Date(x!.at).toISOString()).toBe("2026-10-20T23:59:58.000Z");
  });

  it("names the session by the trade's own time, and has nothing while the regular session trades", () => {
    const periods = { pre: [[{ start: 100, end: 200 }]], regular: [[{ start: 200, end: 300 }]], post: [[{ start: 300, end: 400 }]] };
    const body = (times: number[], closes: (number | null)[]) =>
      ({ chart: { result: [{ meta: { tradingPeriods: periods }, timestamp: times, indicators: { quote: [{ close: closes }] } }] } });
    expect(parseExtended(body([110, 150], [9, 10]))).toMatchObject({ price: 10, session: "pre" });
    expect(parseExtended(body([150, 250], [10, 11]))).toBeUndefined();
    expect(parseExtended(body([250, 310, 320], [11, 12, null]))).toMatchObject({ price: 12, session: "post", at: 310_000 });
    // A chart asked for without extended hours lists regular periods only, as an array.
    expect(parseExtended(fixture("yahoo-chart-aapl.json"))).toBeUndefined();
  });

  it("drops null gaps from the series, keeping times aligned", () => {
    const { series } = parseChart(fixture("yahoo-chart-aapl.json"), "AAPL");
    expect(series.points).toHaveLength(11);
    expect(series.times).toHaveLength(11);
    expect(series.points.every(Number.isFinite)).toBe(true);
    // The fixture's fourth close is null, so the fourth time kept is the fifth bar's.
    expect(series.times[3] - series.times[2]).toBe(10 * 60_000);
    expect(series.utcOffset).toBe(-4 * 3600_000);
  });

  it("reads the session and baseline", () => {
    const { series, quote } = parseChart(fixture("yahoo-chart-aapl.json"), "AAPL");
    expect(series.session!.end - series.session!.start).toBe(6.5 * 3600_000);
    expect(series.baseline).toBe(quote.prevClose);
    const multiDay = { chart: { result: [{ meta: { regularMarketPrice: 1, tradingPeriods: [[{ start: 1, end: 2 }], [{ start: 3, end: 4 }]] } }] } };
    expect(parseChart(multiDay, "X").series.session).toBeUndefined();
  });

  it("works out the % from its own change, so the two never disagree in sign", () => {
    for (const name of ["yahoo-chart-aapl.json", "yahoo-chart-btc.json"]) {
      const { quote } = parseChart(fixture(name), "X");
      expect(quote.changePct).toBeCloseTo((quote.change! / quote.prevClose!) * 100, 9);
      expect(Math.sign(quote.changePct!)).toBe(Math.sign(quote.change!));
    }
  });

  it("parses crypto", () => {
    const { quote, details } = parseChart(fixture("yahoo-chart-btc.json"), "BTC-USD");
    expect(quote.name).toBe("Bitcoin USD");
    expect(details.instrumentType).toBe("CRYPTOCURRENCY");
  });

  it("reports an unknown symbol as not found", () => {
    expect(kindOf(() => parseChart(fixture("yahoo-chart-notfound.json"), "ZZZ"))).toBe("not-found");
  });

  it("treats a malformed body as unavailable", () => {
    expect(kindOf(() => parseChart({}, "AAPL"))).toBe("unavailable");
    expect(kindOf(() => parseChart({ chart: { result: [{ meta: {} }] } }, "AAPL"))).toBe("unavailable");
    expect(kindOf(() => parseChart(null, "AAPL"))).toBe("unavailable");
  });
});

describe("yahoo news", () => {
  it("returns headlines with their publisher, time, link and tags", () => {
    const items = parseNews(fixture("yahoo-news-aapl.json"));
    expect(items).toHaveLength(9);
    expect(items[1]).toMatchObject({ publisher: "Investing.com", tickers: ["AAPL"] });
    expect(items[1].title).toMatch(/foldable/);
    expect(items.every((n) => n.url.startsWith("https://") && n.publishedAt > 1.7e12)).toBe(true);
  });

  it("takes the square picture, from Yahoo's image host only", () => {
    const items = parseNews(fixture("yahoo-news-aapl.json"));
    expect(items.filter((n) => n.thumbnail).length).toBeGreaterThan(3);
    expect(items.every((n) => !n.thumbnail || n.thumbnail.startsWith("https://s.yimg.com/"))).toBe(true);
    const story = (url: string) => ({ news: [{ title: "a", link: "https://x.test/", providerPublishTime: 1, thumbnail: { resolutions: [{ tag: "140x140", url }] } }] });
    expect(parseNews(story("https://elsewhere.test/a.jpg"))[0].thumbnail).toBeUndefined();
    expect(parseNews(story("https://s.yimg.com.evil.test/a.jpg"))[0].thumbnail).toBeUndefined();
  });

  it("drops a story with no title or a link that is not https", () => {
    const body = { news: [{ title: "a", link: "http://x.test/", providerPublishTime: 1 }, { link: "https://x.test/", providerPublishTime: 1 }, { title: "b", link: "https://x.test/b", providerPublishTime: 1 }] };
    expect(parseNews(body).map((n) => n.title)).toEqual(["b"]);
  });

  it("refuses a body with no news list", () => {
    expect(kindOf(() => parseNews({}))).toBe("unavailable");
  });
});

describe("yahoo search", () => {
  it("returns symbols with names, types and exchanges, hiding futures", () => {
    const results = parseSearch(fixture("yahoo-search.json"));
    expect(results[0]).toEqual({ symbol: "AAPL", name: "Apple Inc.", type: "EQUITY", exchange: "NASDAQ" });
    expect(results.some((r) => r.type === "FUTURE")).toBe(false);
    expect(results.map((r) => r.symbol)).toContain("APC.DE");
  });

  it("refuses a body with no quotes list", () => {
    expect(kindOf(() => parseSearch({}))).toBe("unavailable");
  });
});

describe("nasdaq market cap", () => {
  it("parses the comma-grouped value", () => {
    expect(parseMarketCap(fixture("nasdaq-summary-aapl.json"))).toBe(5_012_517_062_800);
  });

  it("reports an unknown symbol as not found", () => {
    expect(kindOf(() => parseMarketCap(fixture("nasdaq-summary-notfound.json")))).toBe("not-found");
  });

  it("returns undefined when the summary has no market cap", () => {
    expect(parseMarketCap({ data: { summaryData: { MarketCap: { value: "N/A" } } } })).toBeUndefined();
  });
});

// Shapes from Finnhub's API documentation; replace with captured fixtures once a key is to hand.
describe("finnhub", () => {
  const quote = { c: 261.74, d: 1.2, dp: 0.46, h: 263.31, l: 260.68, o: 261.07, pc: 260.54, t: 1792180800 };

  it("parses a quote", () => {
    const q = finnhub.parseQuote(quote, "AAPL");
    expect(q).toMatchObject({ symbol: "AAPL", price: 261.74, prevClose: 260.54, changePct: 0.46, source: "finnhub" });
    expect(q.marketTime).toBe(1792180800_000);
  });

  it("treats the all-zero answer for an unknown symbol as not found", () => {
    const zeros = { c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 };
    expect(kindOf(() => finnhub.parseQuote(zeros, "ZZZ"))).toBe("not-found");
  });

  it("parses a profile, scaling market cap from millions", () => {
    const profile = finnhub.parseProfile({
      name: "Apple Inc", exchange: "NASDAQ NMS", marketCapitalization: 3_900_000.5, finnhubIndustry: "Technology",
      country: "US", logo: "https://static2.finnhub.io/file/publicdatany/finnhubimage/stock_logo/AAPL.png", weburl: "https://www.apple.com/",
    });
    expect(profile).toMatchObject({ name: "Apple Inc", marketCap: 3_900_000_500_000, industry: "Technology", country: "US", website: "https://www.apple.com/" });
    expect(profile.logo).toMatch(/^https:/);
    expect(finnhub.parseProfile({}).marketCap).toBeUndefined();
  });

  it("keeps only web URLs from a profile", () => {
    const p = finnhub.parseProfile({ logo: "javascript:alert(1)", weburl: "file:///etc/passwd" });
    expect(p.logo).toBeUndefined();
    expect(p.website).toBeUndefined();
  });

  it("reads ratios, taking the first name present", () => {
    expect(finnhub.parseMetric({ metric: { "52WeekHigh": 280, "52WeekLow": 170, peTTM: 31.2, epsTTM: 6.1, dividendYieldIndicatedAnnual: 0.44, beta: 1.2 } }))
      .toEqual({ wk52High: 280, wk52Low: 170, pe: 31.2, eps: 6.1, dividendYield: 0.44, beta: 1.2 });
    expect(finnhub.parseMetric({ metric: { peBasicExclExtraTTM: 20, epsBasicExclExtraItemsTTM: 2, currentDividendYieldTTM: 1.5 } }))
      .toMatchObject({ pe: 20, eps: 2, dividendYield: 1.5 });
    expect(finnhub.parseMetric({ metric: { peTTM: null } }).pe).toBeUndefined();
    expect(finnhub.parseMetric({})).toEqual({});
  });

  it("finds the next earnings report on or after today", () => {
    const body = { earningsCalendar: [
      { date: "2027-01-28", hour: "amc", symbol: "AAPL" },
      { date: "2026-10-29", hour: "amc", symbol: "AAPL" },
      { date: "2026-07-30", hour: "amc", symbol: "AAPL" },
    ] };
    expect(finnhub.parseEarnings(body, "2026-10-20")).toEqual({ date: "2026-10-29", hour: "amc" });
    expect(finnhub.parseEarnings(body, "2026-10-29")).toEqual({ date: "2026-10-29", hour: "amc" });
    expect(finnhub.parseEarnings({ earningsCalendar: [{ date: "2026-11-01", hour: "" }] }, "2026-10-20")).toEqual({ date: "2026-11-01" });
    expect(finnhub.parseEarnings({ earningsCalendar: [] }, "2026-10-20")).toBeUndefined();
    expect(finnhub.parseEarnings({}, "2026-10-20")).toBeUndefined();
  });

  it("parses search", () => {
    const body = { count: 1, result: [{ description: "APPLE INC", displaySymbol: "AAPL", symbol: "AAPL", type: "Common Stock" }] };
    expect(finnhub.parseSearch(body)).toEqual([{ symbol: "AAPL", name: "APPLE INC", type: "Common Stock" }]);
  });
});

describe("getJson", () => {
  const respond = (status: number, body: string) =>
    (async () => new Response(body, { status })) as unknown as typeof fetch;

  const kindOfAsync = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (error) {
      return error instanceof ProviderError ? error.kind : "other";
    }
    return undefined;
  };

  it("maps status codes", async () => {
    expect(await kindOfAsync(getJson("u", { fetchImpl: respond(401, '{"error":"Invalid API key."}') }))).toBe("unauthorized");
    expect(await kindOfAsync(getJson("u", { fetchImpl: respond(403, "{}") }))).toBe("no-access");
    expect(await kindOfAsync(getJson("u", { fetchImpl: respond(429, "{}") }))).toBe("rate-limited");
    expect(await kindOfAsync(getJson("u", { fetchImpl: respond(500, "{}") }))).toBe("unavailable");
    expect(await kindOfAsync(getJson("u", { fetchImpl: respond(200, "<html>") }))).toBe("unavailable");
    expect(await kindOfAsync(getJson("u", { fetchImpl: respond(404, "<html>") }))).toBe("not-found");
  });

  it("tells a bad Finnhub key from a good one without access", async () => {
    expect(await kindOfAsync(getJson("u", { fetchImpl: respond(401, '{"error":"Invalid API key."}') }))).toBe("unauthorized");
    expect(await kindOfAsync(getJson("u", { fetchImpl: respond(401, '{"error":"You don\'t have access to this resource."}') }))).toBe("no-access");
  });

  it("passes a JSON 404 through for the parser to read", async () => {
    await expect(getJson("u", { fetchImpl: respond(404, '{"chart":{}}') })).resolves.toEqual({ chart: {} });
  });

  it("maps a network failure to unavailable", async () => {
    const failing = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    expect(await kindOfAsync(getJson("u", { fetchImpl: failing }))).toBe("unavailable");
  });
});
