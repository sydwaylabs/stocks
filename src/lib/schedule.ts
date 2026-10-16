/**
 * Waiting until a wall-clock instant.
 *
 * `setTimeout(deadline - Date.now())` is wrong for a timer that has to be right, for three
 * separate reasons, and all three have to be defended against at once:
 *
 *  - **Sleep.** A sleeping Mac does not run timers. A ten-minute timeout set before the lid
 *    closes fires late by however long the machine was away.
 *  - **The clamp.** Node fires any delay above 2^31-1 ms (about 24.8 days) immediately.
 *  - **The clock moving.** An NTP correction or a manual change shifts the deadline underneath a
 *    timeout that was measured as an offset.
 *
 * So the wait is broken into chunks and the wall clock is consulted at the end of each one. The
 * final chunk lands exactly on the deadline, so nothing is lost to the chunking.
 */

/** Longest single sleep. Short enough that a clock jump is noticed promptly. */
export const MAX_CHUNK_MS = 60_000;

/** How long to wait next: the whole remainder when it is close, one chunk when it is not. */
export function nextDelay(when: number, now: number, maxChunk = MAX_CHUNK_MS): number {
	const remaining = when - now;
	if (remaining <= 0) return 0;
	return Math.min(remaining, maxChunk);
}

export type Canceller = () => void;

/**
 * Runs `onDue` at `when`, or immediately if that is already past.
 *
 * @returns a canceller that is safe to call more than once, and after the callback has run.
 */
export function scheduleAt(when: number, onDue: () => void, now: () => number = Date.now): Canceller {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let cancelled = false;

	const arm = (): void => {
		if (cancelled) return;
		const delay = nextDelay(when, now());
		if (delay === 0) {
			timer = null;
			onDue();
			return;
		}
		timer = setTimeout(arm, delay);
	};

	arm();

	return () => {
		cancelled = true;
		if (timer !== null) clearTimeout(timer);
		timer = null;
	};
}

export function cancel(canceller: Canceller | null): void {
	canceller?.();
}
