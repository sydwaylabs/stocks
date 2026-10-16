import { compact, formatChange, formatPct, formatPriceLong, trendOf, type Trend } from "./format.js";
import type { Snapshot } from "./quotes.js";
import type { SearchResult } from "./providers/types.js";

/**
 * What the window shows, already formatted, so the page only lays it out. Formatting stays in
 * format.ts where it is tested, and the page never sees a provider's raw numbers except the
 * series it draws.
 */
export type DetailData = {
  symbol: string;
  name: string;
  exchange?: string;
  price: string;
  currency?: string;
  change: string;
  changePct: string;
  trend: Trend;
  points: number[];
  prevClose?: number;
  /** Where the current price sits in a low–high range, 0–1, with both ends formatted. */
  ranges: { label: string; low: string; high: string; at: number }[];
  rows: { label: string; value: string }[];
  source: string;
  /** Epoch ms; the page formats it, since WebKit uses the Mac's own zone data. */
  marketTime?: number;
  fetchedAt: number;
  note?: string;
};

const SOURCE_NAMES = { yahoo: "Yahoo Finance", finnhub: "Finnhub", nasdaq: "Nasdaq" } as const;

export function buildDetail(snap: Snapshot): DetailData {
  const { quote, details } = snap;
  const ranges: DetailData["ranges"] = [];
  const range = (label: string, low?: number, high?: number) => {
    if (low === undefined || high === undefined || high < low) return;
    const at = high === low ? 0.5 : Math.min(1, Math.max(0, (quote.price - low) / (high - low)));
    ranges.push({ label, low: formatPriceLong(low), high: formatPriceLong(high), at });
  };
  range("Day range", quote.dayLow, quote.dayHigh);
  range("52-week range", details.wk52Low, details.wk52High);

  const rows: DetailData["rows"] = [];
  if (quote.prevClose !== undefined) rows.push({ label: "Previous close", value: formatPriceLong(quote.prevClose) });
  if (details.marketCap !== undefined) rows.push({ label: "Market cap", value: compact(details.marketCap) });
  if (details.volume !== undefined) rows.push({ label: "Volume", value: compact(details.volume) });
  if (details.instrumentType) rows.push({ label: "Type", value: typeLabel(details.instrumentType) });

  return {
    symbol: quote.symbol,
    name: quote.name ?? quote.symbol,
    exchange: details.exchange,
    price: formatPriceLong(quote.price),
    currency: quote.currency,
    change: formatChange(quote.change),
    changePct: formatPct(quote.changePct),
    trend: trendOf(quote.change ?? quote.changePct),
    points: snap.series?.points ?? [],
    prevClose: quote.prevClose,
    ranges,
    rows,
    source: SOURCE_NAMES[quote.source],
    marketTime: quote.marketTime,
    fetchedAt: snap.fetchedAt,
    note: snap.keyRejected ? "Finnhub refused the saved key, so this is from Yahoo." : undefined,
  };
}

const TYPE_LABELS: Record<string, string> = {
  EQUITY: "Stock",
  ETF: "ETF",
  MUTUALFUND: "Fund",
  CRYPTOCURRENCY: "Crypto",
  INDEX: "Index",
  CURRENCY: "Currency",
  FUTURE: "Future",
};

export function typeLabel(type: string): string {
  return TYPE_LABELS[type.toUpperCase()] ?? (type ? type[0].toUpperCase() + type.slice(1).toLowerCase() : "");
}

/**
 * Remembers what the search view last showed, so a `select` can only name a symbol that is on
 * screen. The page cannot assign an arbitrary string to the key — references/native-window.md,
 * "Answer only for things the page is already showing".
 */
export class SearchSession {
  private shown = new Map<string, SearchResult>();

  remember(results: SearchResult[]): SearchResult[] {
    this.shown = new Map(results.map((r) => [r.symbol, r]));
    return results;
  }

  pick(symbol: unknown): SearchResult | undefined {
    return typeof symbol === "string" ? this.shown.get(symbol) : undefined;
  }
}
