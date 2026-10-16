/**
 * Per-key timers.
 *
 * One class instance serves every key on the deck, so nothing here may be a module-level
 * singleton bound to "the" timer — everything is keyed by the action id.
 */

/**
 * How long until a key is next due, given when it last ran.
 *
 * `willAppear` fires far more often than people expect: every folder opened or closed, every
 * profile switch, every redraw. Scheduling work from it directly means walking in and out of a
 * folder five times does the work five extra times — wasted requests, and five slots gone from a
 * rolling history that was meant to cover days.
 *
 * So the schedule is anchored to the last run rather than to the moment the key appeared.
 *
 * @param minDelayMs Floor on the answer, so nothing fires while the plugin is still starting and
 * the key has not finished drawing. ~1500ms is comfortable.
 */
export function msUntilDue(
  lastRunAt: string | null,
  intervalMs: number,
  minDelayMs: number
): number {
  if (!lastRunAt) return minDelayMs;
  const last = Date.parse(lastRunAt);
  // An unparseable timestamp is treated as absent rather than as the epoch, which would read as
  // wildly overdue and fire immediately every time.
  if (!Number.isFinite(last)) return minDelayMs;
  // A clock that has gone backwards, or a timestamp from the future, must not park a key for
  // hours: anything that is not a sane elapsed time falls back to running now.
  const elapsed = Date.now() - last;
  if (elapsed < 0 || elapsed >= intervalMs) return minDelayMs;
  return Math.max(minDelayMs, intervalMs - elapsed);
}

export function startTimer(intervalMs: number, callback: () => void): ReturnType<typeof setInterval> {
  return setInterval(callback, intervalMs);
}

export function clearTimer(timer: ReturnType<typeof setInterval> | null): void {
  if (timer !== null) clearInterval(timer);
}
