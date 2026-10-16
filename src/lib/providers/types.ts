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
  source: Source;
};

export type Details = {
  exchange?: string;
  instrumentType?: string;
  wk52High?: number;
  wk52Low?: number;
  volume?: number;
  marketCap?: number;
};

/** Intraday closes, oldest first. Gaps Yahoo leaves as null are dropped. */
export type Series = { points: number[] };

export type SearchResult = {
  symbol: string;
  name: string;
  /** EQUITY, ETF, MUTUALFUND, CRYPTOCURRENCY, INDEX, CURRENCY… */
  type: string;
  exchange?: string;
};

/**
 * `unauthorized` is a bad key (HTTP 401). `no-access` is a good key asking for something its plan
 * does not cover (HTTP 403) — Finnhub's free tier and most non-US listings — which is a reason to
 * fall back, not to tell the user their key is wrong.
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
