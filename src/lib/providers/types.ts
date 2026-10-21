/**
 * The shapes every quote source is parsed into, so the rest of the plugin never sees a provider's
 * own JSON. Fields a source does not supply are left undefined rather than guessed.
 */

export type Source = "yahoo" | "finnhub" | "nasdaq";

export type Quote = {
  symbol: string;
  name?: string;
  currency?: string;
  price: number;
  prevClose?: number;
  change?: number;
  changePct?: number;
  dayHigh?: number;
  dayLow?: number;
  /** Epoch ms of the last trade the price reflects. */
  marketTime?: number;
  /** US listings, in the detail view: the latest pre-market or after-hours trade. */
  extended?: Extended;
  source: Source;
};

/** The last trade outside the regular session, and which side of it: before the open or after the close. */
export type Extended = { price: number; at: number; session: "pre" | "post" };

export type Details = {
  exchange?: string;
  instrumentType?: string;
  wk52High?: number;
  wk52Low?: number;
  volume?: number;
  marketCap?: number;
  // With a Finnhub key only:
  pe?: number;
  eps?: number;
  /** Percent, e.g. 0.44 for 0.44%. */
  dividendYield?: number;
  beta?: number;
  industry?: string;
  country?: string;
  logo?: string;
  website?: string;
  earnings?: Earnings;
};

/** The next scheduled earnings report. `date` is the exchange's calendar date, YYYY-MM-DD. */
export type Earnings = { date: string; hour?: "bmo" | "amc" | "dmh" };

/**
 * Closes, oldest first, with the epoch-ms time of each. Gaps Yahoo leaves as null are dropped from
 * both, so `points[i]` was the price at `times[i]`.
 */
export type Series = {
  points: number[];
  times: number[];
  /** The regular session the points belong to (one-day charts only), epoch ms. */
  session?: { start: number; end: number };
  /** The close before the first point: the line a chart is measured against. */
  baseline?: number;
  /** The exchange's offset from UTC in ms, for telling one of its trading days from the next. */
  utcOffset: number;
};

/** The spans the window's chart offers. The key's sparkline is always "1d". */
export const CHART_RANGES = ["1d", "5d", "1mo", "6mo", "ytd", "1y"] as const;
export type ChartRange = (typeof CHART_RANGES)[number];

/** A headline from Yahoo's news search. */
export type NewsItem = {
  title: string;
  publisher?: string;
  /** Epoch ms. */
  publishedAt: number;
  url: string;
  /** The symbols Yahoo tags the story with: one for a story about a company, many for a round-up. */
  tickers: string[];
  /** Yahoo's 140 px square of the story's picture, when it has one. */
  thumbnail?: string;
};

export type SearchResult = {
  symbol: string;
  name: string;
  /** EQUITY, ETF, MUTUALFUND, CRYPTOCURRENCY, INDEX, CURRENCY… */
  type: string;
  exchange?: string;
};

/**
 * `unauthorized` is a bad key. `no-access` is a good key asking for something its plan does not
 * cover — Finnhub's free tier and most non-US listings — which is a reason to fall back, not to
 * tell the user their key is wrong. See getJson for how the two are told apart.
 */
export type ProviderErrorKind = "not-found" | "unauthorized" | "no-access" | "rate-limited" | "unavailable";

/** Every provider failure, classified so the orchestrator can decide what to try next. */
export class ProviderError extends Error {
  constructor(readonly kind: ProviderErrorKind, message: string) {
    super(message);
  }
}

/** A finite number, or undefined. Providers send null, strings and NaN for "no value". */
export function num(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}
