import { describe, it, expect } from "vitest";
import { msUntilDue } from "./timers.js";

/**
 * The cases here are the ones that produced real misbehaviour, not the happy path:
 * a key that re-ran on every folder change, and clocks that are not monotonic.
 */
describe("msUntilDue", () => {
  it("returns the floor when there is no last run", () => {
    expect(msUntilDue(null, 60_000, 1_500)).toBe(1_500);
  });

  it("treats an unparseable timestamp as absent, not as the epoch", () => {
    // Date.parse() gives NaN; treating that as 0 would read as wildly overdue and run every time.
    expect(msUntilDue("not a date", 60_000, 1_500)).toBe(1_500);
  });

  it("waits out the remainder of the interval", () => {
    const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString();
    expect(msUntilDue(tenSecondsAgo, 60_000, 1_500)).toBeGreaterThan(49_000);
  });

  it("runs after the floor when already overdue", () => {
    const longAgo = new Date(Date.now() - 120_000).toISOString();
    expect(msUntilDue(longAgo, 60_000, 1_500)).toBe(1_500);
  });

  it("does not park a key for hours on a future timestamp", () => {
    // A clock that has gone backwards, or a timestamp written by a machine ahead of this one.
    const future = new Date(Date.now() + 500_000).toISOString();
    expect(msUntilDue(future, 60_000, 1_500)).toBe(1_500);
  });

  it("never returns less than the floor", () => {
    const almostDue = new Date(Date.now() - 59_900).toISOString();
    expect(msUntilDue(almostDue, 60_000, 1_500)).toBe(1_500);
  });
});
