import { formatAmount, formatPct, formatPriceLong } from "./format.js";

/**
 * Price Alert: when a condition is met the key fires, and stays fired until it is pressed. After
 * that it waits for the price to move back past the line by {@link REARM_MARGIN} before it watches
 * again, so a price sitting on the line cannot fire it over and over.
 *
 *   armed ──condition met──▶ fired ──press──▶ cleared ──moved back past the margin──▶ armed
 *
 * Nothing here knows about Stream Deck; the action persists the phase in the key's settings, so
 * a fired alert is still fired after a restart.
 */

export type Condition = "above" | "below" | "up-pct" | "down-pct" | "high-52w" | "low-52w";
export const CONDITIONS: readonly Condition[] = ["above", "below", "up-pct", "down-pct", "high-52w", "low-52w"];

export type Phase = "armed" | "fired" | "cleared";

/** Re-arm once the price is this far back across the line: 0.5% of a price, half a point of a %. */
export const REARM_MARGIN = 0.005;
export const REARM_PCT_POINTS = 0.5;

export type Reading = { price: number; changePct?: number; wk52High?: number; wk52Low?: number; currency?: string };

/** Conditions that need a target the user types; the 52-week ones carry their own. */
export function needsTarget(condition: Condition): boolean {
  return condition !== "high-52w" && condition !== "low-52w";
}

/** Whether the condition holds now. Undefined when the reading lacks what it needs. */
export function isMet(condition: Condition, target: number, r: Reading): boolean | undefined {
  switch (condition) {
    case "above":
      return r.price >= target;
    case "below":
      return r.price <= target;
    case "up-pct":
      return r.changePct === undefined ? undefined : r.changePct >= target;
    case "down-pct":
      return r.changePct === undefined ? undefined : r.changePct <= -target;
    case "high-52w":
      // The 52-week high includes today, so "at the high" means within a whisker of it.
      return r.wk52High === undefined ? undefined : r.price >= r.wk52High * (1 - 1e-4);
    case "low-52w":
      return r.wk52Low === undefined ? undefined : r.price <= r.wk52Low * (1 + 1e-4);
  }
}

/** Whether the price has moved back far enough past the line to watch again. */
export function hasCleared(condition: Condition, target: number, r: Reading): boolean {
  switch (condition) {
    case "above":
      return r.price < target * (1 - REARM_MARGIN);
    case "below":
      return r.price > target * (1 + REARM_MARGIN);
    case "up-pct":
      return r.changePct !== undefined && r.changePct < target - REARM_PCT_POINTS;
    case "down-pct":
      return r.changePct !== undefined && r.changePct > -target + REARM_PCT_POINTS;
    case "high-52w":
      return r.wk52High !== undefined && r.price < r.wk52High * (1 - REARM_MARGIN);
    case "low-52w":
      return r.wk52Low !== undefined && r.price > r.wk52Low * (1 + REARM_MARGIN);
  }
}

/** The next phase after a reading. A press is handled by {@link acknowledge}, not here. */
export function step(phase: Phase, condition: Condition, target: number, r: Reading): Phase {
  if (phase === "armed") return isMet(condition, target, r) ? "fired" : "armed";
  if (phase === "cleared") return hasCleared(condition, target, r) ? "armed" : "cleared";
  return "fired";
}

/** A press: a fired alert is cleared; anything else is unchanged. */
export function acknowledge(phase: Phase): Phase {
  return phase === "fired" ? "cleared" : phase;
}

/** The key's caption for the condition: "Above 350.00", "Up 3%", "52W high". */
export function describeCondition(condition: Condition, target: number): string {
  switch (condition) {
    case "above":
      return `Above ${formatPriceLong(target)}`;
    case "below":
      return `Below ${formatPriceLong(target)}`;
    case "up-pct":
      return `Up ${trimPct(target)}% today`;
    case "down-pct":
      return `Down ${trimPct(target)}% today`;
    case "high-52w":
      return "52W high";
    case "low-52w":
      return "52W low";
  }
}

/**
 * How far there is still to go, for an armed key. A price target is a sum of money, so its distance
 * is too: "$6.54 away". The 52-week lines were not chosen in money, so they stay in percent, and a
 * % alert shows today's move. `long` adds the percentage to a price distance, for the window:
 * "$6.54 (1.9%) away". Undefined when the reading cannot say.
 */
export function distance(condition: Condition, target: number, r: Reading, long = false): string | undefined {
  const pct = (line: number) => `${Math.abs(((line - r.price) / r.price) * 100).toFixed(1)}%`;
  const awayFrom = (line: number | undefined) => (line === undefined || line === 0 ? undefined : `${pct(line)} away`);
  switch (condition) {
    case "above":
    case "below": {
      if (!target) return undefined;
      const money = formatAmount(target - r.price, r.currency);
      return long ? `${money} (${pct(target)}) away` : `${money} away`;
    }
    case "high-52w":
      return awayFrom(r.wk52High);
    case "low-52w":
      return awayFrom(r.wk52Low);
    case "up-pct":
    case "down-pct":
      return r.changePct === undefined ? undefined : `${formatPct(r.changePct)} now`;
  }
}

/**
 * What a cleared alert is waiting for before it watches again, short enough for a key:
 * "Rearm < 348.25". The window spells it out.
 */
export function rearmLine(condition: Condition, target: number, r: Reading): string {
  switch (condition) {
    case "above":
      return `Rearm < ${formatPriceLong(target * (1 - REARM_MARGIN))}`;
    case "below":
      return `Rearm > ${formatPriceLong(target * (1 + REARM_MARGIN))}`;
    case "up-pct":
      return `Rearm < ${formatPct(target - REARM_PCT_POINTS)}`;
    case "down-pct":
      return `Rearm > ${formatPct(-target + REARM_PCT_POINTS)}`;
    case "high-52w":
      return r.wk52High === undefined ? "Rearms soon" : `Rearm < ${formatPriceLong(r.wk52High * (1 - REARM_MARGIN))}`;
    case "low-52w":
      return r.wk52Low === undefined ? "Rearms soon" : `Rearm > ${formatPriceLong(r.wk52Low * (1 + REARM_MARGIN))}`;
  }
}

function trimPct(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** The alert as the window shows and edits it. */
export type AlertView = {
  condition: Condition;
  target: number;
  phase: Phase;
  needsTarget: boolean;
  /** "Above 350.00" — what the key shows. */
  caption: string;
  /** One line under it, spelled out: "Watching — 1.9% away", "Fired at 351.20", "Rearms below 348.25". */
  status: string;
  /** For "Fired at … on …"; the page formats the time. */
  firedAt: number | null;
  /** There is a rule to watch (and so one to remove). */
  active: boolean;
  /** Open the window when it fires. */
  popup: boolean;
};

export function alertView(
  s: { condition: Condition; target: number; phase: Phase; firedAt: number | null; firedPrice: number | null; popup?: boolean },
  r: Reading | null
): AlertView {
  const unset = needsTarget(s.condition) && s.target <= 0;
  let status: string;
  if (unset) status = "No alert set. Choose a condition and target, or click the chart to pick a price.";
  else if (s.phase === "fired") status = s.firedPrice !== null ? `Fired at ${formatPriceLong(s.firedPrice)}. Press the key, or Clear, to clear it.` : "Fired. Press the key, or Clear, to clear it.";
  else if (s.phase === "cleared") status = `Cleared. ${r ? rearmLine(s.condition, s.target, r).replace(/^Rearm < /, "Watches again below ").replace(/^Rearm > /, "Watches again above ") : "Watches again once the price moves back."}`;
  else status = `Watching${r ? ` — ${distance(s.condition, s.target, r, true) ?? "waiting for a price"}` : ""}.`;
  return {
    condition: s.condition,
    target: s.target,
    phase: s.phase,
    needsTarget: needsTarget(s.condition),
    caption: unset ? "Set a target" : describeCondition(s.condition, s.target),
    status,
    firedAt: s.phase === "fired" ? s.firedAt : null,
    active: !unset,
    popup: s.popup !== false,
  };
}
