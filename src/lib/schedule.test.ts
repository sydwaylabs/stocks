import { describe, it, expect, vi } from "vitest";
import { MAX_CHUNK_MS, nextDelay, scheduleAt } from "./schedule.js";

describe("nextDelay", () => {
	it("waits the whole remainder when the deadline is close", () => {
		expect(nextDelay(1_000_000, 1_000_000 - 5_000)).toBe(5_000);
	});

	it("waits a chunk when the deadline is far off", () => {
		expect(nextDelay(Date.now() + 86_400_000, Date.now())).toBe(MAX_CHUNK_MS);
	});

	it("never exceeds the Node timer clamp, which would fire immediately", () => {
		// 2^31-1 ms is about 24.8 days; a 30-day alarm scheduled in one go fires at once.
		expect(nextDelay(Date.now() + 30 * 86_400_000, Date.now())).toBeLessThan(2 ** 31 - 1);
	});

	it("is due when the deadline has passed", () => {
		expect(nextDelay(1_000, 2_000)).toBe(0);
	});
});

describe("scheduleAt", () => {
	it("fires immediately when the deadline is already past", () => {
		const onDue = vi.fn();
		scheduleAt(Date.now() - 1, onDue);
		expect(onDue).toHaveBeenCalledOnce();
	});

	it("re-checks the clock rather than trusting one long timeout", async () => {
		vi.useFakeTimers();
		try {
			const start = Date.now();
			const onDue = vi.fn();
			scheduleAt(start + 5 * MAX_CHUNK_MS, onDue);

			// Four chunks in: still waiting.
			await vi.advanceTimersByTimeAsync(4 * MAX_CHUNK_MS);
			expect(onDue).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(MAX_CHUNK_MS);
			expect(onDue).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});

	it("fires late rather than never when the machine was asleep", () => {
		// The clock is read through an injected `now`, so a jump can be reproduced: the chunk
		// timer fires having taken far longer than it was set for, and the deadline has passed.
		vi.useFakeTimers();
		try {
			const start = Date.now();
			const onDue = vi.fn();
			let clock = start;
			scheduleAt(start + 10 * MAX_CHUNK_MS, onDue, () => clock);

			clock = start + 6 * 3_600_000; // six hours of sleep during the first chunk
			vi.advanceTimersByTime(MAX_CHUNK_MS);
			expect(onDue).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not fire once cancelled", () => {
		vi.useFakeTimers();
		try {
			const onDue = vi.fn();
			const stop = scheduleAt(Date.now() + 5_000, onDue);
			stop();
			stop(); // cancelling twice is safe
			vi.advanceTimersByTime(60_000);
			expect(onDue).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});
