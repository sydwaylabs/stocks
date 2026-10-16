import { getJson, type Fetch } from "./http.js";
import { num, ProviderError, str, type Details, type Quote, type SearchResult } from "./types.js";

/**
 * Finnhub, the official source for people who add a free key. The free tier covers `/quote`,
 * `/stock/profile2` and `/stock/metric`; intraday candles are paid, so the sparkline always comes
 * from Yahoo. Free real-time quotes are mostly US listings — anything Finnhub cannot price falls
 * back to Yahoo.
 */

const BASE = "https://finnhub.io/api/v1";

export function parseQuote(body: unknown, symbol: string): Quote {
  const q = body as Record<string, unknown>;
  if (typeof q?.error === "string") throw new ProviderError("unauthorized", q.error);
  const price = num(q?.c);
  // Finnhub answers an unknown symbol with a 200 and every field zero rather than an error.
  if (!price) throw new ProviderError("not-found", `${symbol}: no Finnhub quote`);
  const t = num(q.t);
  return {
    symbol,
    price,
    prevClose: num(q.pc) || undefined,
    change: num(q.d),
    changePct: num(q.dp),
    dayHigh: num(q.h) || undefined,
    dayLow: num(q.l) || undefined,
    marketTime: t ? t * 1000 : undefined,
    source: "finnhub",
  };
}

/** Market cap arrives in millions of the listing currency. */
export function parseProfile(body: unknown): { name?: string; exchange?: string; marketCap?: number } {
  const p = body as Record<string, unknown>;
  const cap = num(p?.marketCapitalization);
  return {
    name: str(p?.name),
    exchange: str(p?.exchange),
    marketCap: cap ? cap * 1_000_000 : undefined,
  };
}

export function parseMetric(body: unknown): Pick<Details, "wk52High" | "wk52Low"> {
  const m = (body as { metric?: Record<string, unknown> })?.metric;
  return { wk52High: num(m?.["52WeekHigh"]), wk52Low: num(m?.["52WeekLow"]) };
}

export function parseSearch(body: unknown): SearchResult[] {
  const result = (body as { result?: unknown })?.result;
  if (!Array.isArray(result)) throw new ProviderError("unavailable", "Finnhub search returned no result list");
  return (result as Record<string, unknown>[]).flatMap((r) => {
    const symbol = str(r?.symbol);
    return symbol ? [{ symbol, name: str(r.description) ?? symbol, type: str(r.type) ?? "" }] : [];
  });
}

function url(path: string, params: Record<string, string>): string {
  return `${BASE}${path}?${new URLSearchParams(params)}`;
}

/** The key goes in a header, not the query string, so it never lands in a logged URL. */
function headers(key: string): Record<string, string> {
  return { "X-Finnhub-Token": key };
}

export async function fetchQuote(symbol: string, key: string, fetchImpl?: Fetch): Promise<Quote> {
  return parseQuote(await getJson(url("/quote", { symbol }), { headers: headers(key), fetchImpl }), symbol);
}

export async function fetchProfile(symbol: string, key: string, fetchImpl?: Fetch) {
  return parseProfile(await getJson(url("/stock/profile2", { symbol }), { headers: headers(key), fetchImpl }));
}

export async function fetchMetric(symbol: string, key: string, fetchImpl?: Fetch) {
  return parseMetric(
    await getJson(url("/stock/metric", { symbol, metric: "all" }), { headers: headers(key), fetchImpl })
  );
}

export async function search(query: string, key: string, fetchImpl?: Fetch): Promise<SearchResult[]> {
  return parseSearch(await getJson(url("/search", { q: query }), { headers: headers(key), fetchImpl }));
}
