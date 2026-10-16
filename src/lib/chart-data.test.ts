import { describe, expect, it } from "vitest";

import { buildChart, priceScale, sessionTicks, spread } from "./chart-data.js";
import type { Series } from "./providers/types.js";

const HOUR = 3600_000;
const MIN = 60_000;
/** New York, EDT. */
const NY = -4 * HOUR;
/** 2026-10-16 09:30 EDT. */
const OPEN = Date.UTC(2026, 9, 16, 13, 30);
const CLOSE = OPEN + 6.5 * HOUR;

function nyDay(bars: number, opts: Partial<Series> = {}): Series {
  return {
    points: Array.from({ length: bars }, (_, i) => 100 + i),
    times: Array.from({ length: bars }, (_, i) => OPEN + i * 5 * MIN),
    session: { start: OPEN, end: CLOSE },
    baseline: 100,
    utcOffset: NY,
    ...opts,
  };
}

/** Local wall-clock hour:minute of an instant at an offset, for readable assertions. */
const hm = (t: number, offset: number) => new Date(t + offset).toISOString().slice(11, 16);

describe("one-day chart", () => {
  it("places a partial day on the session's clock", () => {
    // 09:30 to 11:00: 19 bars, a little under a quarter of the session.
    const chart = buildChart(nyDay(19), "1d");
    expect(chart.points[0].x).toBe(0);
    expect(chart.points.at(-1)!.x).toBeCloseTo(1.5 / 6.5, 5);
    expect(chart.sessionStart).toBe(OPEN);
  });

  it("fills the width once the session is over", () => {
    const chart = buildChart(nyDay(79), "1d");
    expect(chart.points.at(-1)!.x).toBe(1);
  });

  it("measures against the previous close", () => {
    const chart = buildChart(nyDay(3, { baseline: 100 }), "1d");
    expect(chart).toMatchObject({ baseline: 100, change: "+2.00", changePct: "+2.00%", trend: "up" });
  });

  it("falls back to the first and last bar without a session", () => {
    const chart = buildChart(nyDay(19, { session: undefined }), "1d");
    expect(chart.points.at(-1)!.x).toBe(1);
  });
});

describe("session ticks", () => {
  it("labels a New York session at the open, whole hours and the close", () => {
    expect(sessionTicks(OPEN, CLOSE, NY).map((t) => hm(t, NY))).toEqual(["09:30", "12:00", "14:00", "16:00"]);
  });

  it("labels a London session in London hours", () => {
    const BST = HOUR;
    const open = Date.UTC(2026, 9, 16, 7, 0);
    expect(sessionTicks(open, open + 8.5 * HOUR, BST).map((t) => hm(t, BST))).toEqual(["08:00", "12:00", "15:00", "16:30"]);
  });

  it("labels a 24-hour market every six hours", () => {
    const midnight = Date.UTC(2026, 9, 16);
    expect(sessionTicks(midnight, midnight + 24 * HOUR - MIN, 0).map((t) => hm(t, 0))).toEqual(["00:00", "06:00", "12:00", "18:00", "00:00"]);
  });
});

describe("longer ranges", () => {
  /** Five New York sessions of 26 quarter-hour bars, Monday to Friday. */
  function fiveDays(): Series {
    const times: number[] = [];
    for (let d = 0; d < 5; d++) for (let b = 0; b < 26; b++) times.push(OPEN - (4 - d) * 24 * HOUR + b * 15 * MIN);
    return { points: times.map((_, i) => 100 + i), times, baseline: 90, utcOffset: NY };
  }

  it("spaces bars evenly, so nights take no room, and labels each day", () => {
    const chart = buildChart(fiveDays(), "5d");
    expect(chart.points[0].x).toBe(0);
    expect(chart.points.at(-1)!.x).toBe(1);
    expect(chart.ticks.map((t) => t.kind)).toEqual(["day", "day", "day", "day", "day"]);
    expect(chart.ticks.map((t) => Math.round(t.x * 129))).toEqual([0, 26, 52, 78, 104]);
    expect(chart.sessionStart).toBeUndefined();
  });

  it("measures against the close before the range", () => {
    const chart = buildChart(fiveDays(), "5d");
    expect(chart.baseline).toBe(90);
    expect(chart.trend).toBe("up");
  });

  it("labels a year by month, at most five of them", () => {
    const times = Array.from({ length: 250 }, (_, i) => Date.UTC(2025, 9, 17) + i * 1.45 * 24 * HOUR);
    const chart = buildChart({ points: times.map(() => 1), times, baseline: 1, utcOffset: NY }, "1y");
    expect(chart.ticks.length).toBe(5);
    expect(chart.ticks.every((t) => t.kind === "month")).toBe(true);
    expect(chart.trend).toBe("flat");
  });

  it("draws nothing from an empty series", () => {
    expect(buildChart({ points: [], times: [], utcOffset: 0 }, "1mo")).toMatchObject({ points: [], ticks: [] });
  });
});

describe("price scale", () => {
  it("labels round prices inside the data, with headroom around it", () => {
    const s = priceScale([340.46, 347.82, 342]);
    expect(s.yTicks.map((t) => t.label)).toEqual(["342", "344", "346"]);
    expect(s.yMin).toBeLessThan(340.46);
    expect(s.yMax).toBeGreaterThan(347.82);
  });

  it("scales large and small prices", () => {
    expect(priceScale([80735, 82717]).yTicks.map((t) => t.label)).toEqual(["81,000", "81,500", "82,000", "82,500"]);
    expect(priceScale([243, 348]).yTicks.map((t) => t.label)).toEqual(["250", "275", "300", "325"]);
    expect(priceScale([0.0121, 0.0134]).yTicks.map((t) => t.label)).toEqual(["0.0125", "0.0130"]);
  });

  it("keeps every tick between the extremes, three to five of them", () => {
    for (const [lo, hi] of [[1, 2], [99.5, 100.2], [36018, 36462], [5, 500], [0.5, 0.51]]) {
      const s = priceScale([lo, hi]);
      expect(s.yTicks.length, `${lo}–${hi}`).toBeGreaterThanOrEqual(2);
      expect(s.yTicks.length, `${lo}–${hi}`).toBeLessThanOrEqual(5);
      for (const t of s.yTicks) {
        expect(t.v).toBeGreaterThanOrEqual(lo);
        expect(t.v).toBeLessThanOrEqual(hi);
      }
    }
  });

  it("gives a flat line a scale", () => {
    const s = priceScale([100, 100, 100]);
    expect(s.yMax).toBeGreaterThan(s.yMin);
    expect(s.yTicks.length).toBeGreaterThan(0);
  });
});

describe("spread", () => {
  it("keeps everything under the limit, else an even selection from the first", () => {
    expect(spread([1, 2, 3], 5)).toEqual([1, 2, 3]);
    expect(spread([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5)).toEqual([0, 2, 4, 6, 8]);
  });
});
