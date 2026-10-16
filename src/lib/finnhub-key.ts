import { sealValue, unsealValue } from "./secret-store.js";

/**
 * How the optional Finnhub key sits in the plugin's global settings: sealed with the collection
 * key from the login keychain when the native host is there, in the clear (and flagged so) when it
 * is not. One key serves every Stocks button, so it is global, not per action.
 *
 * Sealing protects profile exports, sync folders and backups — not the Mac. See
 * src/lib/secret-store.ts for exactly what it is worth.
 */

export type StoredKey = { finnhubKey?: string; finnhubKeySealed?: boolean };

/** Binds the ciphertext to this one setting, so it cannot be moved elsewhere and still decrypt. */
const AAD = "com.sydwaylabs.stocks/global/finnhubKey";

export function encodeKey(plain: string, collectionKey: Buffer | null): StoredKey {
  const trimmed = plain.trim();
  if (!trimmed) return { finnhubKey: undefined, finnhubKeySealed: undefined };
  return collectionKey
    ? { finnhubKey: sealValue(trimmed, collectionKey, AAD), finnhubKeySealed: true }
    : { finnhubKey: trimmed, finnhubKeySealed: false };
}

/**
 * The plain key, or null when there is none or it cannot be opened — a profile restored on another
 * Mac carries ciphertext whose key stayed behind, which reads as "no key" until it is entered again.
 */
export function decodeKey(stored: StoredKey, collectionKey: Buffer | null): string | null {
  const value = stored.finnhubKey;
  if (typeof value !== "string" || !value) return null;
  if (!stored.finnhubKeySealed) return value;
  if (!collectionKey) return null;
  try {
    return unsealValue(value, collectionKey, AAD);
  } catch {
    return null;
  }
}

/** The last four characters, for "Key saved (…ab12)" — enough to recognise, not to use. */
export function keyHint(plain: string | null): string | null {
  return plain ? `…${plain.slice(-4)}` : null;
}
