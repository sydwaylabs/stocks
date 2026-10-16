/**
 * Number formatting for the key and the window. Fixed `en-US` grouping: the key has room for about
 * eight characters, and a locale that groups with spaces or uses a comma decimal would change the
 * width the sizes were chosen for. Uses `Intl` only for grouping, never for time zones.
 */

const grouped = (digits: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** A price that fits on a key: always at most eight characters for any realistic quote. */
export function formatPrice(price: number): string {
  const abs = Math.abs(price);
  if (abs >= 1e6) return compact(price);
  if (abs >= 1e4) return grouped(0).format(price);
  if (abs >= 1e3) return grouped(1).format(price);
  if (abs >= 1) return grouped(2).format(price);
  if (abs === 0) return "0.00";
  // Sub-unit prices (penny stocks, small coins) keep three significant figures.
  return price.toPrecision(3);
}

/** The full price for the window, where there is room for every decimal the source gave. */
export function formatPriceLong(price: number): string {
  const abs = Math.abs(price);
  if (abs >= 1) return grouped(2).format(price);
  return price.toPrecision(4);
}

/** `+1.23%` / `-0.45%`. ASCII minus: the key's renderer has no guaranteed U+2212. */
export function formatPct(pct: number | undefined): string {
  if (pct === undefined) return "";
  const rounded = Math.abs(pct) >= 100 ? pct.toFixed(0) : pct.toFixed(2);
  return `${pct > 0 ? "+" : ""}${rounded === "-0.00" ? "0.00" : rounded}%`;
}

export function formatChange(change: number | undefined): string {
  if (change === undefined) return "";
  const abs = Math.abs(change);
  // Cents for anything priced in whole units; a sub-cent move only on a sub-cent instrument.
  const text = abs >= 0.01 || abs === 0 ? grouped(2).format(abs) : abs.toPrecision(2);
  return `${change > 0 ? "+" : change < 0 ? "-" : ""}${text}`;
}

/** 3.12T, 845.2B, 12.0M, 950K — market cap and volume. */
export function compact(value: number): string {
  const abs = Math.abs(value);
  const units: [number, string][] = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [size, unit] of units) {
    if (abs >= size) return `${(value / size).toFixed(abs / size >= 100 ? 0 : abs / size >= 10 ? 1 : 2)}${unit}`;
  }
  return grouped(0).format(value);
}

export type Trend = "up" | "down" | "flat";

export function trendOf(change: number | undefined): Trend {
  if (change === undefined || change === 0) return "flat";
  return change > 0 ? "up" : "down";
}
