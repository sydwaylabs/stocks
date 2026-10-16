import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { decodeKey, encodeKey, keyHint } from "./finnhub-key.js";

describe("finnhub key storage", () => {
  const collection = randomBytes(32);

  it("round-trips through a sealed value", () => {
    const stored = encodeKey("  abc123secret  ", collection);
    expect(stored.finnhubKeySealed).toBe(true);
    expect(stored.finnhubKey).not.toContain("abc123secret");
    expect(decodeKey(stored, collection)).toBe("abc123secret");
  });

  it("stores in the clear, flagged, without a collection key", () => {
    const stored = encodeKey("abc", null);
    expect(stored).toEqual({ finnhubKey: "abc", finnhubKeySealed: false });
    expect(decodeKey(stored, null)).toBe("abc");
  });

  it("reads a sealed value it cannot open as no key", () => {
    const stored = encodeKey("abc", collection);
    expect(decodeKey(stored, randomBytes(32))).toBeNull();
    expect(decodeKey(stored, null)).toBeNull();
    expect(decodeKey({ finnhubKey: "garbage", finnhubKeySealed: true }, collection)).toBeNull();
  });

  it("clears on an empty entry", () => {
    expect(decodeKey(encodeKey("   ", collection), collection)).toBeNull();
    expect(decodeKey({}, collection)).toBeNull();
  });

  it("hints with the last four characters", () => {
    expect(keyHint("abcdef1234")).toBe("…1234");
    expect(keyHint(null)).toBeNull();
  });
});
