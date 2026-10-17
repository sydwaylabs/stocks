import streamDeck from "@elgato/streamdeck";
import { homedir } from "node:os";
import { join } from "node:path";

import { buildChart } from "./lib/chart-data.js";
import { buildBoardCard, buildDetail, SearchSession, typeLabel, type BoardCard } from "./lib/detail-data.js";
import { LogoCache } from "./lib/logo-cache.js";
import { CHART_RANGES, ProviderError, type ChartRange, type SearchResult } from "./lib/providers/types.js";
import { CONDITIONS, type AlertView, type Condition } from "./lib/alert.js";
import type { QuoteService } from "./lib/quotes.js";
import { renderPage, WINDOW_HEIGHT, WINDOW_WIDTH } from "./lib/window-page.js";
import { findHosts, serveWindow, WindowLaunchError, type WindowMessage } from "./window-host.js";

/**
 * Opens the Stocks window for one key: detail for a key with a symbol, search for one without.
 * Resolves when the window closes. The caller keeps the closer from `onOpen` so a key that goes
 * away takes its window with it.
 */

/** One cache for every window and key: ~/Library/Caches is where macOS expects re-creatable files. */
const logos = new LogoCache(join(homedir(), "Library", "Caches", "com.sydwaylabs.stocks", "logos"));

/** A window left alone this long closes. Only interaction re-arms it; the 30s poll does not. */
const IDLE_TIMEOUT_MS = 10 * 60_000;

export type StockWindowOptions = {
  quotes: QuoteService;
  /** The key's symbol now, or "" — read per request, since a pick changes it mid-window. */
  symbol: () => string;
  /**
   * Assigns a picked result to the key, or adds it to a list. May return a line for the window to
   * show ("Added MSFT — 3 of 12"), or a refusal.
   */
  onSelect: (result: SearchResult) => Promise<void | { ok?: boolean; message?: string }>;
  /** Open in search even if the key has a symbol. */
  startIn?: "search";
  /** A board opening straight into its add popover. */
  openAdd?: boolean;
  /** Search adds to a list and stays open, rather than assigning one and closing. */
  adding?: boolean;
  /** Offer "Change symbol" in the detail view (default true). */
  canChange?: boolean;
  /**
   * A watchlist's board: the window opens on a card per symbol, and a card opens that symbol's
   * detail. Without it, the window is about the one symbol the key shows.
   */
  board?: {
    list: () => string[];
    remove: (symbol: string) => Promise<void>;
    /** Makes the key show this symbol. */
    showOnKey: (symbol: string) => Promise<void>;
    /** Saves a new order: the same symbols, rearranged. */
    reorder: (symbols: string[]) => Promise<void>;
    /** The key's "Change as" setting, which the board's pills follow and can switch. */
    changeAs: () => "percent" | "amount";
    setChangeAs: (value: "percent" | "amount") => Promise<void>;
  };
  /**
   * Opened by the plugin, not by a press — an alert firing. Shown without taking key status, so it
   * cannot swallow what someone is typing in another app (references/native-window.md).
   */
  unbidden?: boolean;
  /** The key's pin: a pinned window stays until closed by hand, and remembers it next time. */
  pinned?: { get: () => boolean; set: (on: boolean) => Promise<void> };
  /** A Price Alert's window: its rule, shown and edited beside the chart. */
  alert?: {
    get: () => AlertView;
    set: (condition: Condition, target: number) => Promise<AlertView>;
    clear: () => Promise<AlertView>;
    remove: () => Promise<AlertView>;
    setPopup: (on: boolean) => Promise<AlertView>;
  };
  onOpen: (close: () => void) => void;
};

export async function openStockWindow(options: StockWindowOptions): Promise<void> {
  const session = new SearchSession();
  // Grows as the window shows company websites; serveWindow opens only exact entries.
  const links: string[] = [];
  // Finnhub's logo URL per symbol this window has shown. The page asks for /asset/logo by symbol,
  // and only a symbol in here — the one on screen — is answered.
  const logoUrls = new Map<string, string>();
  const initialSymbol = options.symbol();
  const board = options.board;
  const mode = board && options.startIn !== "search" ? "board"
    : initialSymbol && options.startIn !== "search" ? "detail" : "search";
  const windowTitle = board ? "Stocks — watchlist"
    : options.adding ? "Stocks — add to watchlist"
    : mode === "detail" ? `Stocks — ${initialSymbol.slice(0, 16)}` : "Stocks — choose a symbol";
  // On a board, the detail view shows whichever card was opened, which only a symbol on the list
  // can be. Elsewhere it is always the key's own symbol.
  let viewing = initialSymbol;
  const shown = (): string => (board ? (board.list().includes(viewing) ? viewing : "") : options.symbol());

  const onMessage = async (message: WindowMessage): Promise<unknown> => {
    switch (message.type) {
      case "board": {
        if (!board) return {};
        const list = board.list();
        // A press of refresh asks past the cache; the minute's poll does not.
        const force = message.force === true;
        const cards = await Promise.all(list.map(async (symbol): Promise<BoardCard> => {
          try {
            const [snap, logo] = await Promise.all([options.quotes.snapshot(symbol, { force }), options.quotes.logo(symbol)]);
            const card = buildBoardCard(snap);
            if (logo) {
              logoUrls.set(card.symbol, logo);
              card.logo = `/asset/logo?symbol=${encodeURIComponent(card.symbol)}`;
            }
            return card;
          } catch (error) {
            const notFound = error instanceof ProviderError && error.kind === "not-found";
            return { symbol, name: symbol, trend: "flat", points: [], error: notFound ? "Not found" : "No data" };
          }
        }));
        return { cards, onKey: options.symbol(), max: 12, changeAs: board.changeAs() };
      }
      case "focus": {
        if (!board || typeof message.symbol !== "string" || !board.list().includes(message.symbol)) return { ok: false };
        viewing = message.symbol;
        return { ok: true };
      }
      case "pin":
        if (!options.pinned || typeof message.on !== "boolean") return {};
        await options.pinned.set(message.on);
        return { pinned: options.pinned.get() };
      case "alert":
        return options.alert ? { alert: options.alert.get() } : {};
      case "setAlert": {
        if (!options.alert) return {};
        const condition = message.condition as Condition;
        const target = Number(message.target);
        if (!CONDITIONS.includes(condition) || !Number.isFinite(target) || target < 0 || target > 1e9) {
          return { message: "That target is not a number the alert can use." };
        }
        return { alert: await options.alert.set(condition, target) };
      }
      case "setPopup":
        if (!options.alert || typeof message.on !== "boolean") return {};
        return { alert: await options.alert.setPopup(message.on) };
      case "removeAlert":
        return options.alert ? { alert: await options.alert.remove() } : {};
      case "clearAlert":
        return options.alert ? { alert: await options.alert.clear() } : {};
      case "changeAs": {
        if (!board || (message.value !== "percent" && message.value !== "amount")) return { ok: false };
        await board.setChangeAs(message.value);
        return { ok: true };
      }
      case "reorder": {
        if (!board || !Array.isArray(message.symbols)) return { ok: false };
        const next = message.symbols.filter((s): s is string => typeof s === "string");
        const current = board.list();
        // Only a rearrangement of exactly what is there: nothing added, dropped or doubled.
        const same = next.length === current.length && [...next].sort().join("\n") === [...current].sort().join("\n");
        if (!same) return { ok: false };
        await board.reorder(next);
        return { ok: true };
      }
      case "showOnKey": {
        if (!board || typeof message.symbol !== "string" || !board.list().includes(message.symbol)) return { ok: false };
        await board.showOnKey(message.symbol);
        return { ok: true };
      }
      case "remove": {
        if (!board || typeof message.symbol !== "string" || !board.list().includes(message.symbol)) return { ok: false };
        await board.remove(message.symbol);
        return { ok: true };
      }
      case "snapshot": {
        const symbol = shown();
        if (!symbol) return { message: "No symbol is set on this key." };
        try {
          if (message.force === true) await options.quotes.snapshot(symbol, { force: true });
          const detail = buildDetail(await options.quotes.detailed(symbol));
          if (detail.website && !links.includes(detail.website)) links.push(detail.website);
          if (detail.logo) {
            logoUrls.set(detail.symbol, detail.logo);
            // The page loads it from the plugin, which keeps it on disk; never from the internet.
            detail.logo = `/asset/logo?symbol=${encodeURIComponent(detail.symbol)}`;
          }
          return { detail };
        } catch (error) {
          return { message: describe(error, symbol) };
        }
      }
      case "chart": {
        const symbol = shown();
        const range = message.range as ChartRange;
        if (!symbol || !CHART_RANGES.includes(range)) return { message: "No chart for that." };
        try {
          return { chart: buildChart(await options.quotes.chart(symbol, range, { force: message.force === true }), range) };
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
        const outcome = await options.onSelect(result);
        return { ok: outcome?.ok ?? true, message: outcome?.message };
      }
      default:
        return {};
    }
  };

  const hosts = await findHosts();
  for (const host of hosts) {
    try {
      await serveWindow(host, {
        renderPage: (token) => renderPage(token, {
          mode,
          symbol: initialSymbol || undefined,
          windowTitle,
          adding: options.adding,
          canChange: options.canChange,
          alert: !!options.alert,
          openAdd: options.openAdd,
          pinned: options.pinned?.get() ?? false,
        }),
        keepOpen: () => options.pinned?.get() ?? false,
        hostArgs: options.unbidden ? ["--no-focus"] : undefined,
        onMessage,
        onOpen: options.onOpen,
        onWarn: (text) => streamDeck.logger.warn(text),
        timeoutMs: IDLE_TIMEOUT_MS,
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        title: windowTitle,
        links,
        serveAsset: async (name, params) => {
          const symbol = params.get("symbol") ?? "";
          const url = logoUrls.get(symbol);
          // Only a symbol on screen: the one shown, or any row of a board.
          const onScreen = board ? board.list().includes(symbol) : symbol === shown().toUpperCase();
          if (name !== "logo" || !url || !onScreen) return null;
          return logos.get(symbol, url);
        },
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
