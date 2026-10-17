import { describe, expect, it } from "vitest";

import { addSymbol, mergeAlert, mergeWatchlist, mergeWithDefaults, parseSymbols } from "./settings.js";

describe("mergeWithDefaults", () => {
  it("fills a new key with defaults", () => {
    expect(mergeWithDefaults({})).toEqual({ symbol: "", name: "", intervalMin: 5, display: "price", changeAs: "percent", pinWindow: false });
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
    expect(mergeWithDefaults({ changeAs: "amount" }).changeAs).toBe("amount");
    expect(mergeWithDefaults({ changeAs: "nonsense" as "amount" }).changeAs).toBe("percent");
  });
});

describe("mergeAlert", () => {
  it("defaults a new key to an unset 'above' alert, armed", () => {
    expect(mergeAlert({})).toMatchObject({ symbol: "", condition: "above", target: 0, phase: "armed", firedAt: null });
  });

  it("reads a typed target, forgiving $, % and commas", () => {
    expect(mergeAlert({ target: "1,250.50" as unknown as number }).target).toBe(1250.5);
    expect(mergeAlert({ target: "$350" as unknown as number }).target).toBe(350);
    expect(mergeAlert({ target: "3%" as unknown as number }).target).toBe(3);
    expect(mergeAlert({ target: "-5" as unknown as number }).target).toBe(0);
    expect(mergeAlert({ target: "abc" as unknown as number }).target).toBe(0);
  });

  it("pops up on firing unless turned off", () => {
    expect(mergeAlert({}).popup).toBe(true);
    expect(mergeAlert({ popup: false }).popup).toBe(false);
    expect(mergeAlert({ popup: "false" as unknown as boolean }).popup).toBe(false);
  });

  it("keeps only known conditions and phases", () => {
    expect(mergeAlert({ condition: "sideways" as "above" }).condition).toBe("above");
    expect(mergeAlert({ phase: "fired" }).phase).toBe("fired");
    expect(mergeAlert({ phase: "exploded" as "armed" }).phase).toBe("armed");
  });
});

describe("watchlist settings", () => {
  it("parses symbols with commas or spaces, without repeats, up to twelve", () => {
    expect(parseSymbols("aapl, msft  btc-usd,AAPL")).toEqual(["AAPL", "MSFT", "BTC-USD"]);
    expect(parseSymbols("^gsptse RY.TO EURUSD=X")).toEqual(["^GSPTSE", "RY.TO", "EURUSD=X"]);
    expect(parseSymbols("a b c d e f g h i j k l m n")).toHaveLength(12);
    expect(parseSymbols("<script> ;")).toEqual([]);
  });

  it("normalises the stored text and clamps rotation to the choices", () => {
    expect(mergeWatchlist({ symbols: "aapl msft", rotateSec: "10" as unknown as number })).toEqual({
      symbols: "AAPL, MSFT", rotateSec: 10, display: "price", changeAs: "percent", pinWindow: false,
    });
    expect(mergeWatchlist({ rotateSec: 7 }).rotateSec).toBe(0);
  });

  it("adds a symbol once, and not past the limit", () => {
    expect(addSymbol("AAPL", "msft")).toEqual({ symbols: "AAPL, MSFT", added: true });
    expect(addSymbol("AAPL, MSFT", "AAPL")).toEqual({ symbols: "AAPL, MSFT", added: false });
    expect(addSymbol("A B C D E F G H I J K L", "Z").added).toBe(false);
  });
});
