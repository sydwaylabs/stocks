import { describe, expect, it } from "vitest";

import { acknowledge, alertView, describeCondition, distance, hasCleared, isMet, needsTarget, rearmLine, step, type Phase } from "./alert.js";

describe("isMet", () => {
  it("compares the price with the target", () => {
    expect(isMet("above", 350, { price: 350 })).toBe(true);
    expect(isMet("above", 350, { price: 349.99 })).toBe(false);
    expect(isMet("below", 300, { price: 299 })).toBe(true);
  });

  it("compares today's move, with the drop given as a positive number", () => {
    expect(isMet("up-pct", 3, { price: 1, changePct: 3.2 })).toBe(true);
    expect(isMet("down-pct", 3, { price: 1, changePct: -3.1 })).toBe(true);
    expect(isMet("down-pct", 3, { price: 1, changePct: -2.9 })).toBe(false);
    expect(isMet("up-pct", 3, { price: 1 })).toBeUndefined();
  });

  it("knows the 52-week extremes", () => {
    expect(isMet("high-52w", 0, { price: 348.15, wk52High: 348.15 })).toBe(true);
    expect(isMet("high-52w", 0, { price: 340, wk52High: 348.15 })).toBe(false);
    expect(isMet("low-52w", 0, { price: 243.42, wk52Low: 243.42 })).toBe(true);
    expect(isMet("low-52w", 0, { price: 300 })).toBeUndefined();
  });
});

describe("the alert's life", () => {
  /** Runs readings through step, pressing where the reading is "press". */
  function run(condition: Parameters<typeof step>[1], target: number, readings: (number | "press")[]): Phase[] {
    let phase: Phase = "armed";
    return readings.map((r) => (phase = r === "press" ? acknowledge(phase) : step(phase, condition, target, { price: r })));
  }

  it("fires, stays fired until pressed, then waits to move back before watching again", () => {
    expect(run("above", 100, [99, 100.5, 101, 99.8, "press", 100.2, 99.6, 99.4, 100])).toEqual([
      "armed", "fired", "fired", "fired", "cleared", "cleared", "cleared", "armed", "fired",
    ]);
  });

  it("does not fire again while the price sits on the line after a press", () => {
    expect(run("below", 100, [99, "press", 100.1, 99.9, 100.2, 99.8])).toEqual([
      "fired", "cleared", "cleared", "cleared", "cleared", "cleared",
    ]);
  });

  it("ignores a press while armed", () => {
    expect(acknowledge("armed")).toBe("armed");
  });

  it("re-arms a % alert once today's move eases off by half a point", () => {
    expect(hasCleared("up-pct", 3, { price: 1, changePct: 2.6 })).toBe(false);
    expect(hasCleared("up-pct", 3, { price: 1, changePct: 2.4 })).toBe(true);
    expect(hasCleared("down-pct", 3, { price: 1, changePct: -2.4 })).toBe(true);
  });
});

describe("words for the key", () => {
  it("describes each condition", () => {
    expect(describeCondition("above", 350)).toBe("Above 350.00");
    expect(describeCondition("down-pct", 2.5)).toBe("Down 2.5% today");
    expect(describeCondition("up-pct", 3)).toBe("Up 3% today");
    expect(describeCondition("high-52w", 0)).toBe("52W high");
  });

  it("says how far there is to go", () => {
    expect(distance("above", 350, { price: 343.46, currency: "USD" })).toBe("$6.54 away");
    expect(distance("below", 300, { price: 343.46, currency: "USD" }, true)).toBe("$43.46 (12.7%) away");
    expect(distance("below", 80000, { price: 81610, currency: "USD" })).toBe("$1,610 away");
    expect(distance("above", 290, { price: 280.01, currency: "CAD" })).toBe("C$9.99 away");
    expect(distance("high-52w", 0, { price: 343.46, wk52High: 348.15 })).toBe("1.4% away");
    expect(distance("up-pct", 3, { price: 1, changePct: 1.2 })).toBe("+1.20% now");
    expect(distance("low-52w", 0, { price: 1 })).toBeUndefined();
  });

  it("says what a cleared alert is waiting for", () => {
    expect(rearmLine("above", 350, { price: 351 })).toBe("Rearm < 348.25");
    expect(rearmLine("down-pct", 3, { price: 1 })).toBe("Rearm > -2.50%");
    expect(rearmLine("high-52w", 0, { price: 1, wk52High: 200 })).toBe("Rearm < 199.00");
  });

  it("knows which conditions need a typed target", () => {
    expect(needsTarget("above")).toBe(true);
    expect(needsTarget("high-52w")).toBe(false);
  });
});

describe("alertView", () => {
  const base = { condition: "above" as const, target: 350, phase: "armed" as const, firedAt: null, firedPrice: null };

  it("says what an armed alert is waiting for", () => {
    expect(alertView(base, { price: 343.46, currency: "USD" })).toMatchObject({ caption: "Above 350.00", status: "Watching — $6.54 (1.9%) away.", needsTarget: true });
  });

  it("asks for a target when there is none", () => {
    expect(alertView({ ...base, target: 0 }, null).status).toMatch(/click the chart/);
    expect(alertView({ ...base, target: 0 }, null).active).toBe(false);
    expect(alertView(base, null).active).toBe(true);
    expect(alertView(base, null).popup).toBe(true);
    expect(alertView({ ...base, popup: false }, null).popup).toBe(false);
    expect(alertView({ ...base, condition: "high-52w", target: 0 }, null).needsTarget).toBe(false);
  });

  it("reports a fired alert and a cleared one", () => {
    const fired = alertView({ ...base, phase: "fired", firedAt: 5, firedPrice: 351.2 }, { price: 351.2 });
    expect(fired).toMatchObject({ phase: "fired", firedAt: 5 });
    expect(fired.status).toMatch(/^Fired at 351\.20/);
    expect(alertView({ ...base, phase: "cleared" }, { price: 351 }).status).toBe("Cleared. Watches again below 348.25");
  });
});
