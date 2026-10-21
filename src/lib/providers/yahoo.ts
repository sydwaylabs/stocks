import { getJson, type Fetch } from "./http.js";
import { num, ProviderError, str, type ChartRange, type Extended, type Details, type NewsItem, type Quote, type SearchResult, type Series } from "./types.js";

/**
 * Yahoo Finance's chart and search endpoints. Unofficial and keyless: they are what the plugin
 * works on out of the box. The batch quote (`v7/quote`) and `quoteSummary` endpoints need a crumb
 * these days, so everything a key shows comes from the chart's `meta` block.
 */

const CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";
const SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search";

/** Result types left out of search: a stock's futures and options crowd out the stock itself. */
const HIDDEN_TYPES = new Set(["FUTURE", "OPTION"]);

export type ChartResult = { quote: Quote; details: Details; series: Series };

export function parseChart(body: unknown, symbol: string): ChartResult {
  const chart = (body as { chart?: { result?: unknown[] | null; error?: { code?: string; description?: string } | null } })?.chart;
  if (chart?.error) {
    const kind = chart.error.code === "Not Found" ? "not-found" : "unavailable";
    throw new ProviderError(kind, `${symbol}: ${chart.error.description ?? chart.error.code ?? "error"}`);
  }
  const result = chart?.result?.[0] as
    | { meta?: Record<string, unknown>; timestamp?: unknown[]; indicators?: { quote?: { close?: unknown[] }[] } }
    | undefined;
  const meta = result?.meta;
  const price = num(meta?.regularMarketPrice);
  if (!meta || price === undefined) throw new ProviderError("unavailable", `${symbol}: chart has no price`);

  const prevClose = num(meta.previousClose) ?? num(meta.chartPreviousClose);
  const change = prevClose !== undefined ? price - prevClose : undefined;
  // From our own change and close, not Yahoo's regularMarketChangePercent: for crypto that is over
  // a different span, and Bitcoin read -$58.71 beside +0.51%. Worked out here, the two always agree.
  const changePct =
    change !== undefined && prevClose ? (change / prevClose) * 100 : num(meta.regularMarketChangePercent);
  const marketTime = num(meta.regularMarketTime);

  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const stamps = result?.timestamp ?? [];
  const points: number[] = [];
  const times: number[] = [];
  closes.forEach((raw, i) => {
    const v = num(raw);
    const t = num(stamps[i]);
    if (v === undefined) return;
    points.push(v);
    // A response with no timestamps still draws, spaced evenly, rather than not at all.
    times.push(t !== undefined ? t * 1000 : i);
  });

  return {
    quote: {
      symbol: str(meta.symbol) ?? symbol,
      name: str(meta.shortName) ?? str(meta.longName),
      currency: str(meta.currency),
      price,
      prevClose,
      change,
      changePct,
      dayHigh: num(meta.regularMarketDayHigh),
      dayLow: num(meta.regularMarketDayLow),
      marketTime: marketTime !== undefined ? marketTime * 1000 : undefined,
      source: "yahoo",
    },
    details: {
      exchange: str(meta.fullExchangeName) ?? str(meta.exchangeName),
      instrumentType: str(meta.instrumentType),
      wk52High: num(meta.fiftyTwoWeekHigh),
      wk52Low: num(meta.fiftyTwoWeekLow),
      volume: num(meta.regularMarketVolume),
    },
    series: {
      points,
      times,
      session: sessionOf(meta),
      baseline: num(meta.chartPreviousClose) ?? prevClose,
      utcOffset: (num(meta.gmtoffset) ?? 0) * 1000,
    },
  };
}

/**
 * The regular session a one-day chart covers. `tradingPeriods` describes the day the data is from
 * — Friday's, over a weekend — so it comes first; `currentTradingPeriod` is the fallback. Longer
 * ranges have no single session and return undefined.
 */
function sessionOf(meta: Record<string, unknown>): Series["session"] {
  const periods = Array.isArray(meta.tradingPeriods) ? (meta.tradingPeriods.flat(2) as Record<string, unknown>[]) : null;
  // Several periods is a multi-day chart, which has no one session.
  if (periods && periods.length !== 1) return undefined;
  const period = periods?.[0] ?? (meta.currentTradingPeriod as { regular?: Record<string, unknown> } | undefined)?.regular;
  const start = num(period?.start);
  const end = num(period?.end);
  return start !== undefined && end !== undefined && end > start ? { start: start * 1000, end: end * 1000 } : undefined;
}

/**
 * The last pre-market or after-hours trade in a one-day chart asked for with `includePrePost`.
 * The bar's own time says which session it was in, so nothing is guessed from the clock. Yahoo's
 * `fulldayPrice` was tried first: it falls back to the regular close the moment after-hours
 * trading ends, and the after-hours line vanished overnight with it.
 */
export function parseExtended(body: unknown): Extended | undefined {
  const result = (body as { chart?: { result?: unknown[] | null } })?.chart?.result?.[0] as
    | { meta?: Record<string, unknown>; timestamp?: unknown[]; indicators?: { quote?: { close?: unknown[] }[] } }
    | undefined;
  const periods = result?.meta?.tradingPeriods as Record<string, unknown> | undefined;
  if (!periods || Array.isArray(periods)) return undefined;
  const spans = (key: string) =>
    (Array.isArray(periods[key]) ? (periods[key] as unknown[]).flat(2) : []) as Record<string, unknown>[];
  const within = (key: string, t: number) => spans(key).some((p) => {
    const start = num(p?.start), end = num(p?.end);
    return start !== undefined && end !== undefined && t >= start && t < end;
  });
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const stamps = result?.timestamp ?? [];
  for (let i = closes.length - 1; i >= 0; i--) {
    const price = num(closes[i]);
    const t = num(stamps[i]);
    if (price === undefined || t === undefined) continue;
    // The newest trade decides: one in the regular session means there is nothing extra to show.
    const session = within("pre", t) ? "pre" : within("post", t) ? "post" : undefined;
    return session ? { price, at: t * 1000, session } : undefined;
  }
  return undefined;
}

export async function fetchExtended(symbol: string, fetchImpl?: Fetch): Promise<Extended | undefined> {
  const url = `${CHART_URL}${encodeURIComponent(symbol)}?range=1d&interval=5m&includePrePost=true`;
  return parseExtended(await getJson(url, { fetchImpl }));
}

export function parseSearch(body: unknown): SearchResult[] {
  const quotes = (body as { quotes?: unknown })?.quotes;
  if (!Array.isArray(quotes)) throw new ProviderError("unavailable", "search returned no quotes list");
  const results: SearchResult[] = [];
  for (const raw of quotes as Record<string, unknown>[]) {
    const symbol = str(raw?.symbol);
    const type = str(raw?.quoteType) ?? "";
    if (!symbol || HIDDEN_TYPES.has(type)) continue;
    results.push({
      symbol,
      name: str(raw.shortname) ?? str(raw.longname) ?? symbol,
      type,
      exchange: str(raw.exchDisp) ?? str(raw.exchange),
    });
  }
  return results;
}

/**
 * The 140 px square, and only from Yahoo's own image host: the plugin downloads it for the window,
 * so it fetches nothing a story could point anywhere else.
 */
function thumbnailOf(thumbnail: unknown): string | undefined {
  const sizes = (thumbnail as { resolutions?: unknown })?.resolutions;
  if (!Array.isArray(sizes)) return undefined;
  const square = (sizes as Record<string, unknown>[]).find((r) => r?.tag === "140x140");
  const url = str(square?.url);
  return url && /^https:\/\/[a-z0-9.-]+\.yimg\.com\//.test(url) ? url : undefined;
}

/** Stories from a search, newest first as Yahoo sends them. Only https links: the page opens them. */
export function parseNews(body: unknown): NewsItem[] {
  const news = (body as { news?: unknown })?.news;
  if (!Array.isArray(news)) throw new ProviderError("unavailable", "search returned no news list");
  const items: NewsItem[] = [];
  for (const raw of news as Record<string, unknown>[]) {
    const title = str(raw?.title);
    const url = str(raw?.link);
    const published = num(raw?.providerPublishTime);
    if (!title || !url?.startsWith("https://") || published === undefined) continue;
    const tickers = Array.isArray(raw.relatedTickers) ? raw.relatedTickers.filter((t): t is string => typeof t === "string") : [];
    items.push({ title, publisher: str(raw.publisher), publishedAt: published * 1000, url, tickers, thumbnail: thumbnailOf(raw.thumbnail) });
  }
  return items;
}

export async function fetchChart(symbol: string, fetchImpl?: Fetch): Promise<ChartResult> {
  const url = `${CHART_URL}${encodeURIComponent(symbol)}?range=1d&interval=5m&includePrePost=false`;
  return parseChart(await getJson(url, { fetchImpl }), symbol);
}

/** Bar size per range: about 80–150 points each, enough for a smooth line and no more. */
const INTERVALS: Record<ChartRange, string> = { "1d": "5m", "5d": "15m", "1mo": "60m", "6mo": "1d", ytd: "1d", "1y": "1d" };

export async function fetchRange(symbol: string, range: ChartRange, fetchImpl?: Fetch): Promise<ChartResult> {
  const url = `${CHART_URL}${encodeURIComponent(symbol)}?range=${range}&interval=${INTERVALS[range]}&includePrePost=false`;
  return parseChart(await getJson(url, { fetchImpl }), symbol);
}

export async function search(query: string, fetchImpl?: Fetch): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, quotesCount: "12", newsCount: "0", listsCount: "0" });
  return parseSearch(await getJson(`${SEARCH_URL}?${params}`, { fetchImpl }));
}

export async function news(query: string, fetchImpl?: Fetch): Promise<NewsItem[]> {
  const params = new URLSearchParams({ q: query, quotesCount: "0", newsCount: "10", listsCount: "0" });
  return parseNews(await getJson(`${SEARCH_URL}?${params}`, { fetchImpl }));
}
