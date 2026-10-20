import { CONDITIONS, type Condition, type Phase } from "./alert.js";
import { normalise } from "./quotes.js";

/** Per-key settings. The Finnhub key is not here: it is global, and sealed (see key-store.ts). */
export type TickerSettings = {
  symbol?: string;
  /** The name search returned, kept for the inspector to show beside the symbol. */
  name?: string;
  /** Minutes between refreshes. Arrives from the inspector as a string. */
  intervalMin?: number;
  display?: "price" | "change";
  changeAs?: "percent" | "amount";
  /** Keep this key's window open until it is closed by hand: no idle close, none on a folder change. */
  pinWindow?: boolean;
};

/** Fields the inspector edits, written once on a new key so it never shows a placeholder as a value. */
export const EDITABLE = ["symbol", "intervalMin", "display", "changeAs"] as const;

export const INTERVALS = [1, 5, 15] as const;

const DEFAULTS: Required<TickerSettings> = { symbol: "", name: "", intervalMin: 1, display: "price", changeAs: "percent", pinWindow: false };

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
    changeAs: base.changeAs === "amount" ? "amount" : "percent",
    pinWindow: base.pinWindow === true,
  };
}

// ---- Price Alert ----


export type AlertSettings = {
  symbol?: string;
  name?: string;
  condition?: Condition;
  /** A price for above/below, a percentage for the % moves. Arrives as a string. */
  target?: number;
  /** Open the window when the alert fires, as well as turning the key amber. */
  popup?: boolean;
  pinWindow?: boolean;
  /** Persisted so a fired alert is still fired after a restart. */
  phase?: Phase;
  firedAt?: number | null;
  firedPrice?: number | null;
};

export const ALERT_EDITABLE = ["symbol", "condition", "target", "popup"] as const;

const ALERT_DEFAULTS: Required<AlertSettings> = {
  symbol: "", name: "", condition: "above", target: 0, popup: true, pinWindow: false, phase: "armed", firedAt: null, firedPrice: null,
};

export function mergeAlert(saved: Partial<AlertSettings> | undefined): Required<AlertSettings> {
  const base = { ...ALERT_DEFAULTS, ...saved };
  const target = Number(String(base.target ?? "").replace(/[,%$\s]/g, ""));
  return {
    symbol: typeof base.symbol === "string" ? normalise(base.symbol).slice(0, 24) : "",
    name: typeof base.name === "string" ? base.name : "",
    condition: CONDITIONS.includes(base.condition) ? base.condition : "above",
    target: Number.isFinite(target) && target > 0 ? target : 0,
    // sdpi-checkbox saves a boolean; anything else from an older version reads as its default.
    popup: base.popup === false || base.popup === ("false" as unknown) ? false : true,
    pinWindow: base.pinWindow === true,
    phase: base.phase === "fired" || base.phase === "cleared" ? base.phase : "armed",
    firedAt: typeof base.firedAt === "number" ? base.firedAt : null,
    firedPrice: typeof base.firedPrice === "number" ? base.firedPrice : null,
  };
}

// ---- Watchlist ----

export type WatchlistSettings = {
  /** Symbols as the inspector shows them: "AAPL, MSFT, BTC-USD". */
  symbols?: string;
  /** Seconds between automatic moves to the next symbol; 0 is press only. */
  rotateSec?: number;
  display?: "price" | "change";
  changeAs?: "percent" | "amount";
  pinWindow?: boolean;
  /** How the board orders its rows. Only a view: the list, and the key's rotation, keep their order. */
  boardSort?: "custom" | "change" | "name" | "price";
};

export const WATCHLIST_EDITABLE = ["symbols", "rotateSec", "display", "changeAs"] as const;
export const ROTATE_CHOICES = [0, 5, 10, 30] as const;
/** As many as the board shows without scrolling. */
export const WATCHLIST_MAX = 10;

export function mergeWatchlist(saved: Partial<WatchlistSettings> | undefined): Required<WatchlistSettings> {
  const base = { symbols: "", rotateSec: 0, display: "price", changeAs: "percent", pinWindow: false, boardSort: "custom", ...saved };
  const rotate = Number(base.rotateSec);
  return {
    symbols: parseSymbols(typeof base.symbols === "string" ? base.symbols : "").join(", "),
    rotateSec: (ROTATE_CHOICES as readonly number[]).includes(rotate) ? rotate : 0,
    display: base.display === "change" ? "change" : "price",
    changeAs: base.changeAs === "amount" ? "amount" : "percent",
    pinWindow: base.pinWindow === true,
    boardSort: (["change", "name", "price"] as const).find((s) => s === base.boardSort) ?? "custom",
  };
}

/** "aapl, msft  btc-usd,AAPL" → ["AAPL", "MSFT", "BTC-USD"]: commas or spaces, no repeats, at most {@link WATCHLIST_MAX}. */
export function parseSymbols(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.split(/[,\s]+/)) {
    const symbol = normalise(raw).slice(0, 24);
    if (symbol && /^[A-Z0-9.^=-]+$/.test(symbol)) seen.add(symbol);
    if (seen.size >= WATCHLIST_MAX) break;
  }
  return [...seen];
}

/** Adds a symbol to the end of a watchlist's text, unless it is already there or the list is full. */
export function addSymbol(symbols: string, symbol: string): { symbols: string; added: boolean } {
  const list = parseSymbols(symbols);
  const s = normalise(symbol);
  if (list.includes(s) || list.length >= WATCHLIST_MAX) return { symbols: list.join(", "), added: false };
  return { symbols: [...list, s].join(", "), added: true };
}
