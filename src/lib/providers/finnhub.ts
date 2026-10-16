import { getJson, type Fetch } from "./http.js";
import { num, ProviderError, str, type Details, type Earnings, type Quote, type SearchResult } from "./types.js";

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

export type Profile = Pick<Details, "exchange" | "marketCap" | "industry" | "country" | "logo" | "website"> & { name?: string };

/** Market cap arrives in millions of the listing currency. */
export function parseProfile(body: unknown): Profile {
  const p = body as Record<string, unknown>;
  const cap = num(p?.marketCapitalization);
  return {
    name: str(p?.name),
    exchange: str(p?.exchange),
    marketCap: cap ? cap * 1_000_000 : undefined,
    industry: str(p?.finnhubIndustry),
    country: str(p?.country),
    logo: httpsUrl(p?.logo),
    website: httpsUrl(p?.weburl),
  };
}

export type Metric = Pick<Details, "wk52High" | "wk52Low" | "pe" | "eps" | "dividendYield" | "beta">;

/**
 * `/stock/metric?metric=all` carries a hundred-odd ratios under names that vary by what a company
 * reports, so each figure takes the first of several names that is present.
 */
export function parseMetric(body: unknown): Metric {
  const m = (body as { metric?: Record<string, unknown> })?.metric ?? {};
  const first = (...names: string[]) => names.map((n) => num(m[n])).find((v) => v !== undefined);
  return {
    wk52High: first("52WeekHigh"),
    wk52Low: first("52WeekLow"),
    pe: first("peTTM", "peBasicExclExtraTTM", "peExclExtraTTM", "peNormalizedAnnual"),
    eps: first("epsTTM", "epsBasicExclExtraItemsTTM", "epsExclExtraItemsTTM", "epsInclExtraItemsTTM"),
    dividendYield: first("dividendYieldIndicatedAnnual", "currentDividendYieldTTM"),
    beta: first("beta"),
  };
}

/** The earliest report on or after `today` (YYYY-MM-DD), from `/calendar/earnings`. */
export function parseEarnings(body: unknown, today: string): Earnings | undefined {
  const list = (body as { earningsCalendar?: unknown })?.earningsCalendar;
  if (!Array.isArray(list)) return undefined;
  const upcoming = (list as Record<string, unknown>[])
    .map((e) => ({ date: str(e?.date), hour: str(e?.hour) }))
    .filter((e): e is { date: string; hour: string | undefined } => !!e.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const next = upcoming[0];
  if (!next) return undefined;
  const hour = next.hour === "bmo" || next.hour === "amc" || next.hour === "dmh" ? next.hour : undefined;
  return hour ? { date: next.date, hour } : { date: next.date };
}

/** Only web URLs reach the window: it sets them as an image source and offers them as a link. */
function httpsUrl(value: unknown): string | undefined {
  const s = str(value);
  if (!s) return undefined;
  try {
    const url = new URL(s);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
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

export async function fetchProfile(symbol: string, key: string, fetchImpl?: Fetch): Promise<Profile> {
  return parseProfile(await getJson(url("/stock/profile2", { symbol }), { headers: headers(key), fetchImpl }));
}

export async function fetchMetric(symbol: string, key: string, fetchImpl?: Fetch): Promise<Metric> {
  return parseMetric(
    await getJson(url("/stock/metric", { symbol, metric: "all" }), { headers: headers(key), fetchImpl })
  );
}

/** Reports in the next 90 days; `today` is the exchange's date, YYYY-MM-DD. */
export async function fetchEarnings(symbol: string, key: string, today: string, fetchImpl?: Fetch): Promise<Earnings | undefined> {
  const to = new Date(Date.parse(`${today}T12:00:00Z`) + 90 * 86_400_000).toISOString().slice(0, 10);
  const body = await getJson(url("/calendar/earnings", { symbol, from: today, to }), { headers: headers(key), fetchImpl });
  return parseEarnings(body, today);
}

export async function search(query: string, key: string, fetchImpl?: Fetch): Promise<SearchResult[]> {
  return parseSearch(await getJson(url("/search", { q: query }), { headers: headers(key), fetchImpl }));
}
