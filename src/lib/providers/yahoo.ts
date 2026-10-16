import { getJson, type Fetch } from "./http.js";
import { num, ProviderError, str, type Details, type Quote, type SearchResult, type Series } from "./types.js";

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
    | { meta?: Record<string, unknown>; indicators?: { quote?: { close?: unknown[] }[] } }
    | undefined;
  const meta = result?.meta;
  const price = num(meta?.regularMarketPrice);
  if (!meta || price === undefined) throw new ProviderError("unavailable", `${symbol}: chart has no price`);

  const prevClose = num(meta.previousClose) ?? num(meta.chartPreviousClose);
  const change = prevClose !== undefined ? price - prevClose : undefined;
  const changePct =
    num(meta.regularMarketChangePercent) ??
    (change !== undefined && prevClose ? (change / prevClose) * 100 : undefined);
  const marketTime = num(meta.regularMarketTime);

  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const points = closes.map(num).filter((n): n is number => n !== undefined);

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
    series: { points },
  };
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

export async function fetchChart(symbol: string, fetchImpl?: Fetch): Promise<ChartResult> {
  const url = `${CHART_URL}${encodeURIComponent(symbol)}?range=1d&interval=5m&includePrePost=false`;
  return parseChart(await getJson(url, { fetchImpl }), symbol);
}

export async function search(query: string, fetchImpl?: Fetch): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, quotesCount: "12", newsCount: "0", listsCount: "0" });
  return parseSearch(await getJson(`${SEARCH_URL}?${params}`, { fetchImpl }));
}
