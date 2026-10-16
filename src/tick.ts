import streamDeck from "@elgato/streamdeck";

import { Ticker } from "./lib/ticker.js";

/**
 * The plugin's one ticker, shared by every action, so everything that moves is woken by the same
 * scheduler (see lib/ticker.ts). Prefix ids by action — `timer:<context>`, `clock:minute` — as they
 * share one namespace.
 */
export const ticker = new Ticker({
	onError: (id, error) =>
		streamDeck.logger.error(`tick ${id} failed: ${error instanceof Error ? error.message : String(error)}`),
});
