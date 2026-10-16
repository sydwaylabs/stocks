import streamDeck from "@elgato/streamdeck";

import { decodeKey, encodeKey, type StoredKey } from "./lib/finnhub-key.js";
import { getCollectionKey } from "./lib/secret-store.js";

/**
 * The plugin's one Finnhub key: read from global settings once, kept in memory, and written back
 * sealed. Every action asks here, so a key saved from any button's inspector applies to all.
 */

let cached: Promise<string | null> | null = null;
const listeners = new Set<() => void>();

const warn = (message: string) => streamDeck.logger.warn(message);

export function finnhubKey(): Promise<string | null> {
  cached ??= (async () => {
    const stored = await streamDeck.settings.getGlobalSettings<StoredKey>();
    if (!stored.finnhubKey) return null;
    return decodeKey(stored, stored.finnhubKeySealed ? await getCollectionKey(warn) : null);
  })().catch((error: unknown) => {
    warn(`could not read the Finnhub key: ${error instanceof Error ? error.message : String(error)}`);
    cached = null;
    return null;
  });
  return cached;
}

/** Saves (or, with an empty string, removes) the key, and tells every listener. */
export async function saveFinnhubKey(plain: string): Promise<void> {
  const stored = encodeKey(plain, plain.trim() ? await getCollectionKey(warn) : null);
  const current = await streamDeck.settings.getGlobalSettings<StoredKey>();
  await streamDeck.settings.setGlobalSettings({ ...current, ...stored });
  cached = Promise.resolve(plain.trim() || null);
  for (const listener of listeners) listener();
}

export function onFinnhubKeyChanged(listener: () => void): void {
  listeners.add(listener);
}
