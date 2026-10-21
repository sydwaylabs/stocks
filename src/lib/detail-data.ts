import { buildChart, type ChartData } from "./chart-data.js";
import { compact, formatChange, formatChangeShort, formatPct, formatPriceLong, trendOf, type Trend } from "./format.js";
import { unitOf, type Snapshot } from "./quotes.js";
import { POINTS } from "./format.js";
import type { Earnings, Quote, SearchResult } from "./providers/types.js";

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
  /** Outside regular hours, a US listing's price in pre-market or after-hours trading. */
  extended?: ExtendedLine;
  /** Today's chart. Longer ranges are asked for separately, when picked. */
  chart?: ChartData;
  /** `hint` explains the figure, shown on hover; plain words for someone new to the term. */
  rows: { label: string; value: string; hint?: string }[];
  /** Company facts from a Finnhub key: industry and country, already joined. */
  company?: string;
  /** Finnhub's URL when built; the window swaps it for its own cached /asset/logo address. */
  logo?: string;
  website?: string;
  source: string;
  /** Epoch ms; the page formats it, since WebKit uses the Mac's own zone data. */
  marketTime?: number;
  fetchedAt: number;
  note?: string;
};

export type ExtendedLine = { label: "Pre-market" | "After hours"; price: string; change: string; changePct: string; trend: Trend };

/**
 * The last pre-market or after-hours trade against the last close — overnight and over a weekend
 * too, as Apple's Stocks shows it — or nothing once the regular session has traded, or when it
 * has not moved.
 */
export function extendedLine(quote: Quote): ExtendedLine | undefined {
  const x = quote.extended;
  if (!x || !quote.price) return undefined;
  const change = x.price - quote.price;
  if (Math.abs(change) < 1e-9) return undefined;
  return {
    label: x.session === "pre" ? "Pre-market" : "After hours",
    price: formatPriceLong(x.price),
    change: formatChange(change),
    changePct: formatPct((change / quote.price) * 100),
    trend: trendOf(change),
  };
}

const SOURCE_NAMES = { yahoo: "Yahoo Finance", finnhub: "Finnhub", nasdaq: "Nasdaq" } as const;

export function buildDetail(snap: Snapshot): DetailData {
  const { quote, details } = snap;
  const rows: DetailData["rows"] = [];
  const range = (label: string, low?: number, high?: number) => {
    if (low === undefined || high === undefined || high < low) return;
    rows.push({ label, value: `${formatPriceLong(low)} – ${formatPriceLong(high)}`, hint: HINTS[label] });
  };
  range("Day range", quote.dayLow, quote.dayHigh);
  range("52-week range", details.wk52Low, details.wk52High);
  if (quote.prevClose !== undefined) rows.push({ label: "Previous close", value: formatPriceLong(quote.prevClose) });
  if (details.marketCap !== undefined) rows.push({ label: "Market cap", value: compact(details.marketCap) });
  if (details.volume !== undefined) rows.push({ label: "Volume", value: compact(details.volume) });
  // The rest only arrive with a Finnhub key.
  if (details.pe !== undefined) rows.push({ label: "P/E (TTM)", value: details.pe.toFixed(1) });
  if (details.eps !== undefined) rows.push({ label: "EPS (TTM)", value: details.eps.toFixed(2) });
  if (details.dividendYield !== undefined) rows.push({ label: "Dividend yield", value: `${details.dividendYield.toFixed(2)}%` });
  if (details.beta !== undefined) rows.push({ label: "Beta", value: details.beta.toFixed(2) });
  if (details.earnings) rows.push({ label: "Next earnings", value: formatEarnings(details.earnings) });
  // No "Type" row: the symbol was chosen, so what it is is known; search labels it when choosing.

  for (const row of rows) row.hint ??= HINTS[row.label];

  return {
    symbol: quote.symbol,
    name: quote.name ?? quote.symbol,
    exchange: details.exchange,
    price: formatPriceLong(quote.price),
    // An index level has no currency to show beside it.
    currency: unitOf(snap) === POINTS ? undefined : quote.currency,
    change: formatChange(quote.change),
    changePct: formatPct(quote.changePct),
    trend: trendOf(quote.change ?? quote.changePct),
    extended: extendedLine(quote),
    chart: snap.series && snap.series.points.length > 1 ? buildChart(snap.series, "1d") : undefined,
    rows,
    company: [details.industry, details.country].filter(Boolean).join(" · ") || undefined,
    logo: details.logo,
    website: details.website,
    source: SOURCE_NAMES[quote.source],
    marketTime: quote.marketTime,
    fetchedAt: snap.fetchedAt,
    note: snap.keyRejected ? "Finnhub refused the saved key, so this is from Yahoo." : undefined,
  };
}

/** What each figure means, in one short line. Shown on a resting hover in the window. */
export const HINTS: Record<string, string> = {
  "Day range": "Today's low and high.",
  "52-week range": "The low and high over the past year.",
  "Previous close": "Yesterday's closing price.",
  "Market cap": "The company's total value: price × shares.",
  Volume: "Shares traded today.",
  "P/E (TTM)": "Price ÷ the past year's earnings per share.",
  "EPS (TTM)": "Profit per share over the past year.",
  "Dividend yield": "A year's dividends as a % of the price.",
  Beta: "Swings vs the market: 1 = same, higher = more.",
  "Next earnings": "When results are next reported.",
};

const HOURS = { bmo: "before open", amc: "after close", dmh: "during market hours" } as const;

/** "Thu Oct 30, after close". The date is a calendar date, so it is formatted in UTC as written. */
export function formatEarnings(earnings: Earnings): string {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })
    .format(Date.parse(`${earnings.date}T12:00:00Z`))
    .replace(",", "");
  return earnings.hour ? `${day}, ${HOURS[earnings.hour]}` : day;
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

/** One card on a watchlist's board: a glance, with the full view a click away. */
export type BoardCard = {
  symbol: string;
  name: string;
  price?: string;
  currency?: string;
  change?: string;
  changePct?: string;
  /** The move with its currency sign, for the pill when it shows amounts: "+$1.46", "-C$2.31". */
  changeAmount?: string;
  trend: Trend;
  /** The day's closes, thinned to {@link CARD_POINTS} — a card's sparkline needs no more. */
  points: number[];
  prevClose?: number;
  /** Set instead of a price when the quote could not be had. */
  error?: string;
  /** The window's own address for the cached logo, when there is one. */
  logo?: string;
};

export const CARD_POINTS = 60;

export function buildBoardCard(snap: Snapshot): BoardCard {
  const { quote, series } = snap;
  return {
    symbol: quote.symbol,
    name: quote.name ?? quote.symbol,
    price: formatPriceLong(quote.price),
    currency: unitOf(snap) === POINTS ? undefined : quote.currency,
    change: formatChange(quote.change),
    changePct: formatPct(quote.changePct),
    changeAmount: formatChangeShort(quote.change, unitOf(snap)),
    trend: trendOf(quote.change ?? quote.changePct),
    points: thin(series?.points ?? [], CARD_POINTS),
    prevClose: quote.prevClose,
  };
}

/** Every k-th point, always ending on the last so the line finishes at the current price. */
export function thin(points: number[], max: number): number[] {
  if (points.length <= max) return points;
  const k = Math.ceil(points.length / max);
  const out = points.filter((_, i) => i % k === 0);
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}
