import { describe, expect, it } from "vitest";

import { mergeWithDefaults } from "./settings.js";

describe("mergeWithDefaults", () => {
  it("fills a new key with defaults", () => {
    expect(mergeWithDefaults({})).toEqual({ symbol: "", name: "", intervalMin: 5, display: "price" });
    expect(mergeWithDefaults(undefined).intervalMin).toBe(5);
  });

  it("coerces the interval from a string and clamps it to the choices", () => {
    expect(mergeWithDefaults({ intervalMin: "15" as unknown as number }).intervalMin).toBe(15);
    expect(mergeWithDefaults({ intervalMin: "0" as unknown as number }).intervalMin).toBe(5);
    expect(mergeWithDefaults({ intervalMin: 7 }).intervalMin).toBe(5);
  });

  it("normalises a hand-typed symbol", () => {
    expect(mergeWithDefaults({ symbol: "  brk-b " }).symbol).toBe("BRK-B");
    expect(mergeWithDefaults({ symbol: 42 as unknown as string }).symbol).toBe("");
  });

  it("accepts only known display modes", () => {
    expect(mergeWithDefaults({ display: "change" }).display).toBe("change");
    expect(mergeWithDefaults({ display: "nonsense" as "price" }).display).toBe("price");
  });
});
