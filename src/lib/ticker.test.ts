import { describe, expect, it } from "vitest";

import type { Canceller } from "./schedule.js";
import { TICK_LATENESS_MS, Ticker, nextBoundary } from "./ticker.js";

/** A clock and a scheduler the test drives: `advance` runs whatever falls due, in order. */
function harness(start = 1_000_000) {
	let now = start;
	let pending: { when: number; run: () => void } | null = null;
	let wakes = 0;
	const ticker = new Ticker({
		now: () => now,
		schedule: (when, run): Canceller => {
			wakes++;
			const entry = { when, run };
			pending = entry;
			return () => {
				if (pending === entry) pending = null;
			};
		},
	});
	const advance = (ms: number) => {
		const end = now + ms;
		while (pending && pending.when <= end) {
			const due = pending;
			pending = null;
			now = due.when;
			due.run();
		}
		now = end;
	};
	return { ticker, advance, wakes: () => wakes, pending: () => pending, time: () => now };
}

describe("nextBoundary", () => {
	it("finds the next whole period after now, from a phase", () => {
		expect(nextBoundary(1_250, 1_000)).toBe(2_000);
		expect(nextBoundary(2_000, 1_000)).toBe(3_000);
		// A countdown whose deadline sits at .600 turns over at .600.
		expect(nextBoundary(1_250, 1_000, 5_600)).toBe(1_600);
		expect(nextBoundary(1_700, 1_000, -400)).toBe(2_600);
		// The clock's minute: the turn of the next one, on the wall clock.
		const T = Date.UTC(2026, 9, 9, 16, 7, 12);
		expect(nextBoundary(T, 60_000)).toBe(Date.UTC(2026, 9, 9, 16, 8));
		expect(nextBoundary(Date.UTC(2026, 9, 9, 16, 8), 60_000)).toBe(Date.UTC(2026, 9, 9, 16, 9));
	});
});

describe("the ticker", () => {
	it("ticks just past each boundary, and nowhere in between", () => {
		const h = harness(1_000_250);
		const ticks: number[] = [];
		h.ticker.set("a", 1_000, (now) => ticks.push(now));
		h.advance(3_000);
		expect(ticks).toEqual([1_001_000, 1_002_000, 1_003_000].map((t) => t + TICK_LATENESS_MS));
	});

	it("keeps each subscriber to its own phase", () => {
		const h = harness(1_000_000);
		const seen: string[] = [];
		h.ticker.set("wall", 1_000, () => seen.push("wall"));
		h.ticker.set("countdown", 1_000, () => seen.push("countdown"), 600);
		h.advance(2_000 + TICK_LATENESS_MS);
		expect(seen).toEqual(["countdown", "wall", "countdown", "wall"]);
	});

	it("wakes once for subscribers on the same boundary", () => {
		const h = harness(1_000_000);
		let a = 0;
		let b = 0;
		h.ticker.set("a", 1_000, () => a++);
		h.ticker.set("b", 1_000, () => b++);
		const before = h.wakes();
		h.advance(1_000 + TICK_LATENESS_MS);
		expect([a, b]).toEqual([1, 1]);
		expect(h.wakes() - before).toBe(1);
	});

	it("does nothing at all with nobody subscribed", () => {
		const h = harness();
		h.ticker.set("a", 1_000, () => undefined);
		h.ticker.clear("a");
		expect(h.pending()).toBeNull();
	});

	it("goes on ticking the others when one throws", () => {
		const h = harness(1_000_000);
		let fine = 0;
		h.ticker.set("bad", 1_000, () => {
			throw new Error("draw failed");
		});
		h.ticker.set("good", 1_000, () => fine++);
		h.advance(3_000 + TICK_LATENESS_MS);
		expect(fine).toBe(3);
	});

	it("does not call one cleared by another in the same tick", () => {
		const h = harness(1_000_000);
		let late = 0;
		h.ticker.set("first", 1_000, () => h.ticker.clear("second"));
		h.ticker.set("second", 1_000, () => late++);
		h.advance(1_500);
		expect(late).toBe(0);
	});

	it("keeps its boundaries when set again with the same period and phase", () => {
		const h = harness(1_000_000);
		const ticks: number[] = [];
		h.ticker.set("a", 1_000, () => ticks.push(1));
		h.advance(400);
		h.ticker.set("a", 1_000, () => ticks.push(2));
		h.advance(700);
		expect(ticks).toEqual([2]);
	});
});
