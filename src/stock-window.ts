import streamDeck from "@elgato/streamdeck";

import { buildDetail, SearchSession, typeLabel } from "./lib/detail-data.js";
import { ProviderError, type SearchResult } from "./lib/providers/types.js";
import type { QuoteService } from "./lib/quotes.js";
import { renderPage, WINDOW_HEIGHT, WINDOW_WIDTH } from "./lib/window-page.js";
import { findHosts, serveWindow, WindowLaunchError, type WindowMessage } from "./window-host.js";

/**
 * Opens the Stocks window for one key: detail for a key with a symbol, search for one without.
 * Resolves when the window closes. The caller keeps the closer from `onOpen` so a key that goes
 * away takes its window with it.
 */

/** A window left alone this long closes. Only interaction re-arms it; the 30s poll does not. */
const IDLE_TIMEOUT_MS = 10 * 60_000;

export type StockWindowOptions = {
  quotes: QuoteService;
  /** The key's symbol now, or "" — read per request, since a pick changes it mid-window. */
  symbol: () => string;
  /** Assigns a picked result to the key. */
  onSelect: (result: SearchResult) => Promise<void>;
  onOpen: (close: () => void) => void;
};

export async function openStockWindow(options: StockWindowOptions): Promise<void> {
  const session = new SearchSession();
  const initialSymbol = options.symbol();
  const mode = initialSymbol ? "detail" : "search";
  const windowTitle = initialSymbol ? `Stocks — ${initialSymbol.slice(0, 16)}` : "Stocks — choose a symbol";

  const onMessage = async (message: WindowMessage): Promise<unknown> => {
    switch (message.type) {
      case "snapshot": {
        const symbol = options.symbol();
        if (!symbol) return { message: "No symbol is set on this key." };
        try {
          return { detail: buildDetail(await options.quotes.detailed(symbol)) };
        } catch (error) {
          return { message: describe(error, symbol) };
        }
      }
      case "search": {
        const query = typeof message.query === "string" ? message.query.slice(0, 80) : "";
        try {
          const results = session.remember((await options.quotes.search(query)).slice(0, 12));
          return { results: results.map((r) => ({ ...r, typeLabel: typeLabel(r.type) })) };
        } catch {
          session.remember([]);
          return { results: [], message: "Search is unavailable right now. You can still type a symbol in the key's settings." };
        }
      }
      case "select": {
        const result = session.pick(message.symbol);
        if (!result) return { ok: false, message: "Pick one of the results shown." };
        await options.onSelect(result);
        return { ok: true };
      }
      default:
        return {};
    }
  };

  const hosts = await findHosts();
  for (const host of hosts) {
    try {
      await serveWindow(host, {
        renderPage: (token) => renderPage(token, { mode, symbol: initialSymbol || undefined, windowTitle }),
        onMessage,
        onOpen: options.onOpen,
        onWarn: (text) => streamDeck.logger.warn(text),
        timeoutMs: IDLE_TIMEOUT_MS,
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        title: windowTitle,
      });
      return;
    } catch (error) {
      if (!(error instanceof WindowLaunchError)) throw error;
      streamDeck.logger.warn(error.message);
    }
  }
  throw new Error("no window host could be launched");
}

export function describe(error: unknown, symbol: string): string {
  if (error instanceof ProviderError) {
    switch (error.kind) {
      case "not-found":
        return `${symbol} was not found. Check the symbol, or search for it.`;
      case "rate-limited":
        return "Too many requests just now. Try again in a minute.";
      default:
        return "Quotes are unavailable right now. Adding a free Finnhub key in the key's settings gives a second source.";
    }
  }
  return "Quotes are unavailable right now.";
}
