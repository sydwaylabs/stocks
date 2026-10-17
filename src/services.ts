import streamDeck from "@elgato/streamdeck";

import { finnhubKey, onFinnhubKeyChanged, saveFinnhubKey } from "./key-store.js";
import { keyHint } from "./lib/finnhub-key.js";
import * as finnhub from "./lib/providers/finnhub.js";
import { ProviderError } from "./lib/providers/types.js";
import { QuoteService } from "./lib/quotes.js";

/**
 * What every Stocks action shares: one quote service — so a Ticker, an Alert and a Watchlist on
 * the same symbol cost one request — and the inspector's Finnhub key section, which each action's
 * inspector carries and which all of them answer the same way.
 */

export const quotes = new QuoteService(finnhubKey);

/** Press-and-hold threshold, the same on every action (references/sdk-gotchas.md). */
export const LONG_PRESS_MS = 500;

const FINNHUB_SIGNUP = "https://finnhub.io/register";
const keyListeners = new Set<() => void>();

onFinnhubKeyChanged(() => {
  quotes.invalidate();
  for (const listener of keyListeners) listener();
});

/** Each action re-fetches its keys when the Finnhub key changes. */
export function onKeyChange(listener: () => void): void {
  keyListeners.add(listener);
}

/**
 * Answers the inspector messages every action's inspector can send about the Finnhub key.
 * Returns false for anything else, so the action handles its own.
 */
export async function handleSharedMessage(payload: { event?: string; key?: unknown }): Promise<boolean> {
  switch (payload.event) {
    case "openSignup":
      await streamDeck.system.openUrl(FINNHUB_SIGNUP);
      return true;
    case "getKeyStatus":
      await sendKeyStatus();
      return true;
    case "setFinnhubKey":
      await setFinnhubKey(typeof payload.key === "string" ? payload.key : "");
      return true;
    default:
      return false;
  }
}

async function sendKeyStatus(message?: string, ok?: boolean): Promise<void> {
  const key = await finnhubKey();
  await streamDeck.ui.sendToPropertyInspector({ event: "keyStatus", hasKey: !!key, hint: keyHint(key), message: message ?? null, ok: ok ?? null });
}

async function setFinnhubKey(raw: string): Promise<void> {
  const key = raw.trim();
  if (key) {
    try {
      await finnhub.fetchQuote("AAPL", key);
    } catch (error) {
      if (error instanceof ProviderError && error.kind === "unauthorized") {
        await sendKeyStatus("Finnhub did not accept that key. Nothing was saved.", false);
        return;
      }
      // Anything else (a network blip, a rate limit) says nothing about the key; save it.
    }
  }
  await saveFinnhubKey(key);
  await sendKeyStatus(key ? "Key saved. Quotes now come from Finnhub where it covers the symbol." : "Key removed. Quotes come from Yahoo.", true);
}
