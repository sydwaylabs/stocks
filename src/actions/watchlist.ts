import streamDeck, {
  action,
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyAction,
  type KeyDownEvent,
  type KeyUpEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";

import { renderKey, toDataUri, type KeyView } from "../lib/key-image.js";
import { ProviderError } from "../lib/providers/types.js";
import { addSymbol, mergeWatchlist, parseSymbols, WATCHLIST_EDITABLE, WATCHLIST_MAX, type WatchlistSettings } from "../lib/settings.js";
import type { Snapshot } from "../lib/quotes.js";
import { handleSharedMessage, LONG_PRESS_MS, onKeyChange, quotes } from "../services.js";
import { openStockWindow } from "../stock-window.js";
import { ticker } from "../tick.js";

/**
 * Watchlist: several symbols on one key, a dot for each across the top.
 *
 *   empty key, any press   → search window that adds to the list and stays open
 *   short press            → next symbol (and pauses auto-rotation for a minute)
 *   hold                   → the board: a card per symbol, each opening its detail
 *
 * The list is edited in the key's settings — typed, or added through search. Rotation, when it is
 * on, only runs while the key is on screen; a quote is fetched when its symbol comes round and
 * what it has is older than {@link FRESH_MS}, so a list of twelve does not mean twelve requests.
 */

/** A symbol's quote is reused for this long before it is asked for again. */
const FRESH_MS = 2 * 60_000;
/** A press pauses auto-rotation for this long, so the symbol you stepped to stays put. */
const PRESS_PAUSE_MS = 60_000;
/** Redraw at least this often, so the showing symbol stays current when rotation is off. */
const REFRESH_MS = 5 * 60_000;

type PluginMessageEvent = Parameters<NonNullable<SingletonAction<WatchlistSettings>["onSendToPlugin"]>>[0];

type Instance = {
  action: KeyAction<WatchlistSettings>;
  settings: Required<WatchlistSettings>;
  list: string[];
  index: number;
  keyDownAt: number | null;
  pausedUntil: number;
  snaps: Map<string, Snapshot>;
  closeWindow: (() => void) | null;
};

@action({ UUID: "com.sydwaylabs.stocks.watchlist" })
export class Watchlist extends SingletonAction<WatchlistSettings> {
  private instances = new Map<string, Instance>();

  constructor() {
    super();
    onKeyChange(() => {
      for (const instance of this.instances.values()) {
        instance.snaps.clear();
        void this.show(instance);
      }
    });
  }

  override async onWillAppear(ev: WillAppearEvent<WatchlistSettings>): Promise<void> {
    if (!ev.action.isKey()) return;
    const saved = ev.payload.settings ?? {};
    const settings = mergeWatchlist(saved);
    if (!WATCHLIST_EDITABLE.every((key) => key in saved)) await ev.action.setSettings(settings);

    // One record per key for its whole life, updated in place. The window's close handler and the
    // ticks hold on to the record they started with; a fresh one here left them writing to a
    // record nobody read, and a closed window stayed "open" forever, so a hold did nothing.
    const existing = this.instances.get(ev.action.id);
    const list = parseSymbols(settings.symbols);
    const instance: Instance = existing ?? {
      action: ev.action, settings, list, index: 0, keyDownAt: null, pausedUntil: 0, snaps: new Map(), closeWindow: null,
    };
    Object.assign(instance, {
      action: ev.action,
      settings,
      list,
      index: Math.min(instance.index, Math.max(0, list.length - 1)),
      keyDownAt: null,
    });
    this.instances.set(ev.action.id, instance);
    this.schedule(ev.action.id);
    await this.show(instance);
  }

  override onWillDisappear(ev: WillDisappearEvent<WatchlistSettings>): void {
    // Nothing to keep running: rotation and refresh are only for a key someone can see.
    ticker.clear(rotateId(ev.action.id));
    ticker.clear(refreshId(ev.action.id));
    this.instances.get(ev.action.id)?.closeWindow?.();
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<WatchlistSettings>): Promise<void> {
    const instance = this.instances.get(ev.action.id);
    if (!instance) return;
    this.apply(instance, mergeWatchlist(ev.payload.settings));
    this.schedule(ev.action.id);
    await this.show(instance);
  }

  override onKeyDown(ev: KeyDownEvent<WatchlistSettings>): void {
    const instance = this.instances.get(ev.action.id);
    if (instance) instance.keyDownAt = Date.now();
  }

  override async onKeyUp(ev: KeyUpEvent<WatchlistSettings>): Promise<void> {
    const instance = this.instances.get(ev.action.id);
    if (!instance) return;
    const held = Date.now() - (instance.keyDownAt ?? Date.now());
    instance.keyDownAt = null;

    if (instance.list.length === 0) {
      this.openWindow(ev.action.id, "add");
      return;
    }
    if (held >= LONG_PRESS_MS) {
      this.openWindow(ev.action.id, "detail");
      return;
    }
    instance.pausedUntil = Date.now() + PRESS_PAUSE_MS;
    await this.move(instance, 1);
  }

  override async onSendToPlugin(ev: PluginMessageEvent): Promise<void> {
    const payload = (ev.payload ?? {}) as { event?: string; key?: unknown };
    if (payload.event === "search") this.openWindow(ev.action.id, "add");
    else await handleSharedMessage(payload);
  }

  // ---- the list ----

  /** Takes new settings, keeping the same symbol on show if it is still in the list. */
  private apply(instance: Instance, settings: Required<WatchlistSettings>): void {
    const current = instance.list[instance.index];
    instance.settings = settings;
    instance.list = parseSymbols(settings.symbols);
    const kept = current ? instance.list.indexOf(current) : -1;
    instance.index = kept >= 0 ? kept : Math.min(instance.index, Math.max(0, instance.list.length - 1));
  }

  private schedule(id: string): void {
    const instance = this.instances.get(id);
    if (!instance || instance.list.length === 0) {
      ticker.clear(rotateId(id));
      ticker.clear(refreshId(id));
      return;
    }
    ticker.set(refreshId(id), REFRESH_MS, () => void this.show(instance, { force: true }));
    if (instance.settings.rotateSec > 0 && instance.list.length > 1) {
      ticker.set(rotateId(id), instance.settings.rotateSec * 1000, () => {
        if (Date.now() >= instance.pausedUntil) void this.move(instance, 1);
      });
    } else {
      ticker.clear(rotateId(id));
    }
  }

  private async move(instance: Instance, by: number): Promise<void> {
    if (instance.list.length === 0) return;
    instance.index = (instance.index + by + instance.list.length) % instance.list.length;
    await this.show(instance);
  }

  /** Draws the symbol showing, fetching its quote first if what we have is old. */
  private async show(instance: Instance, options: { force?: boolean } = {}): Promise<void> {
    const symbol = instance.list[instance.index];
    if (!symbol) {
      await this.paint(instance, { kind: "empty", caption: "add symbols" });
      return;
    }
    const dots = { count: instance.list.length, active: instance.index };
    const cached = instance.snaps.get(symbol);
    if (cached) await this.draw(instance, symbol, cached);
    else await this.paint(instance, { kind: "loading", symbol, dots });
    if (!options.force && cached && Date.now() - cached.fetchedAt < FRESH_MS) return;

    try {
      const snap = await quotes.snapshot(symbol, options);
      instance.snaps.set(symbol, snap);
      // Draw only if this symbol is still the one showing; a press may have moved on.
      if (instance.list[instance.index] === symbol) await this.draw(instance, symbol, snap);
    } catch (error) {
      streamDeck.logger.warn(`watchlist ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      if (instance.list[instance.index] !== symbol || cached) return;
      const notFound = error instanceof ProviderError && error.kind === "not-found";
      await this.paint(instance, { kind: "error", symbol, message: notFound ? "Not found" : "No data", hint: notFound ? "Check settings" : "Retrying", dots });
    }
  }

  private async draw(instance: Instance, symbol: string, snap: Snapshot): Promise<void> {
    await this.paint(instance, {
      kind: "quote",
      symbol,
      price: snap.quote.price,
      change: snap.quote.change,
      changePct: snap.quote.changePct,
      points: snap.series?.points,
      prevClose: snap.quote.prevClose,
      currency: snap.quote.currency,
      display: instance.settings.display,
      changeAs: instance.settings.changeAs,
      stale: Date.now() - snap.fetchedAt > 2 * REFRESH_MS,
      dots: { count: instance.list.length, active: instance.index },
    });
  }

  private async paint(instance: Instance, view: KeyView): Promise<void> {
    await instance.action.setImage(toDataUri(renderKey(view)));
  }

  // ---- the window ----

  private openWindow(id: string, mode: "add" | "detail"): void {
    const instance = this.instances.get(id);
    if (!instance || instance.closeWindow) return;
    instance.closeWindow = () => { /* replaced once the window is up */ };
    void openStockWindow({
      quotes,
      symbol: () => instance.list[instance.index] ?? "",
      startIn: mode === "add" ? "search" : undefined,
      // Search from the board adds too, so the window adds in either case.
      adding: true,
      canChange: false,
      board: mode === "detail" ? {
        list: () => instance.list,
        remove: async (symbol) => {
          const symbols = instance.list.filter((s) => s !== symbol).join(", ");
          this.apply(instance, { ...instance.settings, symbols });
          await instance.action.setSettings(instance.settings);
          this.schedule(id);
          await this.show(instance);
        },
        changeAs: () => instance.settings.changeAs,
        setChangeAs: async (value) => {
          // The key's own setting, so the key and the board always show the move the same way.
          instance.settings = { ...instance.settings, changeAs: value };
          await instance.action.setSettings(instance.settings);
          await this.show(instance);
        },
        reorder: async (symbols) => {
          // apply() keeps the key on the symbol it was showing, wherever that has moved to.
          this.apply(instance, { ...instance.settings, symbols: symbols.join(", ") });
          await instance.action.setSettings(instance.settings);
          await this.show(instance);
        },
        showOnKey: async (symbol) => {
          const at = instance.list.indexOf(symbol);
          if (at < 0) return;
          instance.index = at;
          // Hold it there a while, as a press does, so rotation does not move straight off it.
          instance.pausedUntil = Date.now() + PRESS_PAUSE_MS;
          await this.show(instance);
        },
      } : undefined,
      onSelect: async (result) => {
        const { symbols, added } = addSymbol(instance.settings.symbols, result.symbol);
        if (!added) {
          const full = parseSymbols(symbols).length >= WATCHLIST_MAX;
          return { ok: false, message: full ? `The list is full (${WATCHLIST_MAX}).` : `${result.symbol} is already on the list.` };
        }
        this.apply(instance, { ...instance.settings, symbols });
        await instance.action.setSettings(instance.settings);
        this.schedule(id);
        void this.show(instance);
        return { message: `Added ${result.symbol} — ${instance.list.length} of ${WATCHLIST_MAX}` };
      },
      onOpen: (close) => { instance.closeWindow = close; },
    })
      .catch(async (error: unknown) => {
        streamDeck.logger.error(`window failed: ${error instanceof Error ? error.message : String(error)}`);
        await instance.action.showAlert();
      })
      .finally(() => { instance.closeWindow = null; });
  }
}

const rotateId = (id: string) => `rotate:${id}`;
const refreshId = (id: string) => `watchlist:${id}`;
