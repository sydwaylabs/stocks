import { scheduleAt, type Canceller } from "./schedule.js";

/**
 * One scheduler for everything on the deck that moves.
 *
 * Every surface that shows time redraws from here, at the moment what it shows changes, and
 * nothing else wakes up. A subscriber says how often its picture changes — a second, a minute, the
 * completion blink's 700ms — and *when* in that period: a countdown's digits turn over when its own
 * remaining time crosses a whole second, which is set by when it started, not by the wall clock. So
 * each subscriber carries a phase, and is woken just past its own boundaries.
 *
 * It replaces an interval per key — 250ms, polling four times a second to catch a change that
 * happens once — which drew up to a quarter second late and still woke for idle keys. Something
 * with nothing moving (an idle timer, a stopped stopwatch, a clock between minutes) simply is not
 * subscribed.
 *
 * What it is not for: exact deadlines. A completion fires on its own timer, at its own instant —
 * a tick only redraws. And a held key's cue, which animates at sixty milliseconds for the half
 * second it lasts, keeps its own interval.
 *
 * Waiting goes through `scheduleAt`, which re-aims at wall-clock instants in chunks, so a Mac that
 * sleeps through a boundary wakes to the right one rather than a minute late.
 *
 * Nothing here knows about Stream Deck. Make one instance for the whole plugin (see the pattern's
 * `tick.ts`), so every action shares the one wake-up.
 */

export type OnTick = (now: number) => void;

/** How far past a boundary to wake: a little, so the value being drawn has certainly turned over. */
export const TICK_LATENESS_MS = 15;

/** The first boundary after `now` of a period that starts at `phase` (both in epoch ms). */
export function nextBoundary(now: number, periodMs: number, phase = 0): number {
	const offset = ((phase % periodMs) + periodMs) % periodMs;
	return offset + (Math.floor((now - offset) / periodMs) + 1) * periodMs;
}

type Subscriber = { periodMs: number; phase: number; onTick: OnTick; due: number };

export class Ticker {
	private readonly subscribers = new Map<string, Subscriber>();
	private wake: Canceller | null = null;
	private wakeAt = Number.POSITIVE_INFINITY;

	constructor(
		private readonly options: {
			now?: () => number;
			schedule?: (when: number, onDue: () => void) => Canceller;
			onError?: (id: string, error: unknown) => void;
		} = {}
	) {}

	private now(): number {
		return (this.options.now ?? Date.now)();
	}

	/**
	 * Ticks `onTick` at every boundary of `periodMs` from `phase`, until cleared. Setting an id again
	 * replaces it — with a new period or phase if they changed, or only a new callback if not.
	 */
	set(id: string, periodMs: number, onTick: OnTick, phase = 0): void {
		const existing = this.subscribers.get(id);
		if (existing && existing.periodMs === periodMs && existing.phase === phase) {
			existing.onTick = onTick;
			return;
		}
		this.subscribers.set(id, { periodMs, phase, onTick, due: nextBoundary(this.now(), periodMs, phase) });
		this.arm();
	}

	clear(id: string): void {
		if (this.subscribers.delete(id)) this.arm();
	}

	has(id: string): boolean {
		return this.subscribers.has(id);
	}

	/** Aims the one wake-up at the earliest boundary anybody is waiting for. */
	private arm(): void {
		let earliest = Number.POSITIVE_INFINITY;
		for (const subscriber of this.subscribers.values()) earliest = Math.min(earliest, subscriber.due);
		if (earliest === this.wakeAt && this.wake !== null) return;
		this.wake?.();
		this.wake = null;
		this.wakeAt = earliest;
		if (earliest === Number.POSITIVE_INFINITY) return;
		const schedule = this.options.schedule ?? scheduleAt;
		this.wake = schedule(earliest + TICK_LATENESS_MS, () => this.fire());
	}

	private fire(): void {
		this.wake = null;
		this.wakeAt = Number.POSITIVE_INFINITY;
		const now = this.now();
		try {
			// A copy: a tick may subscribe or clear, its own id or another's.
			for (const [id, subscriber] of [...this.subscribers]) {
				// Cleared or replaced by an earlier tick in this same pass.
				if (this.subscribers.get(id) !== subscriber || subscriber.due > now) continue;
				subscriber.due = nextBoundary(now, subscriber.periodMs, subscriber.phase);
				try {
					subscriber.onTick(now);
				} catch (error: unknown) {
					// One subscriber failing must not stop the others, or the next tick.
					this.options.onError?.(id, error);
				}
			}
		} finally {
			this.arm();
		}
	}
}
