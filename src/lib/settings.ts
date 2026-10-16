import { normalise } from "./quotes.js";

/** Per-key settings. The Finnhub key is not here: it is global, and sealed (see key-store.ts). */
export type TickerSettings = {
  symbol?: string;
  /** The name search returned, kept for the inspector to show beside the symbol. */
  name?: string;
  /** Minutes between refreshes. Arrives from the inspector as a string. */
  intervalMin?: number;
  display?: "price" | "change";
};

/** Fields the inspector edits, written once on a new key so it never shows a placeholder as a value. */
export const EDITABLE = ["symbol", "intervalMin", "display"] as const;

export const INTERVALS = [1, 5, 15] as const;

const DEFAULTS: Required<TickerSettings> = { symbol: "", name: "", intervalMin: 5, display: "price" };

/**
 * One place where saved settings are merged and coerced. sdpi-components saves every field as a
 * string, so the interval is coerced and clamped to the choices offered, and a hand-typed symbol is
 * trimmed and upper-cased so `aapl ` and `AAPL` are the same key.
 */
export function mergeWithDefaults(saved: Partial<TickerSettings> | undefined): Required<TickerSettings> {
  const base = { ...DEFAULTS, ...saved };
  const interval = Number(base.intervalMin);
  return {
    symbol: typeof base.symbol === "string" ? normalise(base.symbol).slice(0, 24) : "",
    name: typeof base.name === "string" ? base.name : "",
    intervalMin: (INTERVALS as readonly number[]).includes(interval) ? interval : DEFAULTS.intervalMin,
    display: base.display === "change" ? "change" : "price",
  };
}
