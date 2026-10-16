import { formatChange, formatPct, trendOf, type Trend } from "./format.js";
import type { ChartRange, Series } from "./providers/types.js";

/**
 * Lays a series out for the window's chart: where each point and axis label sits across the
 * width (0–1), and what the line is measured against. Times stay epoch ms; the page formats them,
 * because WebKit reads the Mac's own zone data and Node's is frozen at its build.
 *
 * - **1D** is placed on the session's clock, so at 11:00 the line fills the first quarter and
 *   grows through the day, and a finished session fills the width.
 * - **Longer ranges** are placed by bar, not by clock, so nights and weekends take no room — the
 *   way every price chart draws them.
 */

export type TickKind = "time" | "day" | "date" | "month";

export type ChartData = {
  range: ChartRange;
  points: { x: number; v: number }[];
  /** The previous close (1D) or the close before the range began: the dashed line. */
  baseline?: number;
  ticks: { x: number; t: number; kind: TickKind }[];
  /** The price scale: the plotted span, and round values inside it to label and rule. */
  yMin: number;
  yMax: number;
  yTicks: { v: number; label: string }[];
  /** The session shown, for "Today" or "Fri Oct 16". 1D only. */
  sessionStart?: number;
  sessionEnd?: number;
  change: string;
  changePct: string;
  trend: Trend;
};

const HOUR = 3600_000;
/** Labels nearer an edge than this collide with the edge labels. */
const EDGE_GAP = 0.12;
const MAX_TICKS = 5;

export function buildChart(series: Series, range: ChartRange): ChartData {
  const { points, times, baseline } = series;
  const n = points.length;
  const last = points[n - 1];
  const change = baseline !== undefined && last !== undefined ? last - baseline : undefined;
  const changePct = change !== undefined && baseline ? (change / baseline) * 100 : undefined;
  const base = {
    range, baseline, change: formatChange(change), changePct: formatPct(changePct), trend: trendOf(change),
    ...priceScale(baseline !== undefined ? [...points, baseline] : points),
  };
  if (n === 0) return { ...base, points: [], ticks: [] };

  if (range === "1d") {
    const start = series.session?.start ?? times[0];
    const end = series.session?.end ?? times[n - 1];
    const span = end - start || 1;
    const at = (t: number) => clamp((t - start) / span);
    return {
      ...base,
      points: points.map((v, i) => ({ x: at(times[i]), v })),
      ticks: sessionTicks(start, end, series.utcOffset).map((t) => ({ x: at(t), t, kind: "time" as const })),
      sessionStart: start,
      sessionEnd: end,
    };
  }

  const at = (i: number) => (n === 1 ? 0.5 : i / (n - 1));
  const kind: TickKind = range === "5d" ? "day" : range === "1mo" ? "date" : "month";
  const boundaries = kind === "month" ? firstOfEach(times, series.utcOffset, monthKey) : firstOfEach(times, series.utcOffset, dayKey);
  return {
    ...base,
    points: points.map((v, i) => ({ x: at(i), v })),
    ticks: spread(boundaries, MAX_TICKS).map((i) => ({ x: at(i), t: times[i], kind })),
  };
}

/**
 * The span to plot — the data plus a little headroom, so the line never touches the frame — and
 * three to five round prices inside it: steps of 1, 2, 2.5 or 5 times a power of ten.
 */
export function priceScale(values: number[]): Pick<ChartData, "yMin" | "yMax" | "yTicks"> {
  if (values.length === 0) return { yMin: 0, yMax: 1, yTicks: [] };
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  // A flat line still needs a scale: open it up around the value.
  if (hi - lo < Math.abs(hi) * 1e-6 || hi === lo) {
    const pad = Math.abs(hi) * 0.01 || 1;
    lo -= pad;
    hi += pad;
  }
  const headroom = (hi - lo) * 0.06;
  const yMin = lo - headroom;
  const yMax = hi + headroom;

  const rough = (hi - lo) / 3;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => (hi - lo) / s < 5) ?? 10 * power;
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9) + (step / power === 2.5 ? 1 : 0));
  const format = new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  const yTicks: ChartData["yTicks"] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) {
    const rounded = Number(v.toFixed(decimals + 2));
    yTicks.push({ v: rounded, label: format.format(rounded) });
  }
  return { yMin, yMax, yTicks };
}

/**
 * The open, the close, and whole hours between them — every hour if the session is short, every
 * few for a 24-hour market — leaving room beside the two ends. Hours are the exchange's own, so a
 * 09:30 open gets 12:00 rather than 11:47.
 */
export function sessionTicks(start: number, end: number, utcOffset: number): number[] {
  const span = end - start;
  const step = [HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR].find((s) => span / s <= 4) ?? 6 * HOUR;
  const first = Math.ceil((start + utcOffset) / step) * step - utcOffset;
  const inner: number[] = [];
  for (let t = first; t < end; t += step) {
    const x = (t - start) / span;
    if (x >= EDGE_GAP && x <= 1 - EDGE_GAP) inner.push(t);
  }
  // A short session with several whole hours: keep the middle one so labels do not crowd.
  const middle = inner.length > 3 ? spread(inner.map((_, i) => i), 3).map((i) => inner[i]) : inner;
  // Yahoo ends a 24-hour market's day at 23:59; label it as the hour it means.
  const shownEnd = (end + utcOffset) % HOUR >= HOUR - 60_000 ? end + (HOUR - ((end + utcOffset) % HOUR)) : end;
  return [start, ...middle, shownEnd];
}

const dayKey = (local: Date) => local.toISOString().slice(0, 10);
const monthKey = (local: Date) => local.toISOString().slice(0, 7);

/** Indices of the first bar of each exchange-local day (or month). */
function firstOfEach(times: number[], utcOffset: number, key: (local: Date) => string): number[] {
  const out: number[] = [];
  let previous = "";
  times.forEach((t, i) => {
    const k = key(new Date(t + utcOffset));
    if (k !== previous) out.push(i);
    previous = k;
  });
  return out;
}

/** At most `max` of `items`, evenly spread and always including the first. */
export function spread<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = items.length / max;
  return Array.from({ length: max }, (_, k) => items[Math.floor(k * step)]);
}

function clamp(x: number): number {
  return Math.min(1, Math.max(0, x));
}

