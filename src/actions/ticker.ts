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

import { finnhubKey, onFinnhubKeyChanged, saveFinnhubKey } from "../key-store.js";
import { keyHint } from "../lib/finnhub-key.js";
import { renderKey, toDataUri, type KeyView } from "../lib/key-image.js";
import * as finnhub from "../lib/providers/finnhub.js";
import { ProviderError } from "../lib/providers/types.js";
import { daysUntil, exchangeDate, normalise, QuoteService, type Snapshot } from "../lib/quotes.js";
import { EDITABLE, mergeWithDefaults, type TickerSettings } from "../lib/settings.js";
import { openStockWindow } from "../stock-window.js";
import { ticker } from "../tick.js";

/**
 * One symbol per key: price, today's change and a sparkline, refreshed on the shared ticker.
 *
 *   empty key, any press   → search window, to pick a symbol
 *   short press            → refresh now
 *   hold                   → detail window (chart, ranges, market cap), with "Change symbol"
 *
 * A refresh only reads public quotes, so a stray tap costs one request and changes nothing — which
 * is why the tap may act here. The hold opens the window, as on every Sydway Labs key.
 */

const LONG_PRESS_MS = 500;
/** The key's "E" badge shows from this many days before an earnings report until the day itself. */
const EARNINGS_BADGE_DAYS = 7;
const FINNHUB_SIGNUP = "https://finnhub.io/register";

const quotes = new QuoteService(finnhubKey);

type PluginMessageEvent = Parameters<NonNullable<SingletonAction<TickerSettings>["onSendToPlugin"]>>[0];

/** Per-key state. One class instance serves every key, so nothing here may be a class field. */
type KeyInstance = {
  action: KeyAction<TickerSettings>;
  settings: Required<TickerSettings>;
  keyDownAt: number | null;
  last: Snapshot | null;
  /** An earnings report is due within the badge window. Needs a Finnhub key. */
  earningsSoon: boolean;
  closeWindow: (() => void) | null;
  /** Bumped whenever the symbol changes, so an answer for the old symbol is not drawn. */
  generation: number;
};

@action({ UUID: "com.sydwaylabs.stocks.ticker" })
export class Ticker extends SingletonAction<TickerSettings> {
  private instances = new Map<string, KeyInstance>();

  constructor() {
    super();
    onFinnhubKeyChanged(() => {
      quotes.invalidate();
      for (const id of this.instances.keys()) void this.refresh(id, { force: true });
    });
  }

  override async onWillAppear(ev: WillAppearEvent<TickerSettings>): Promise<void> {
    if (!ev.action.isKey()) return;
    const saved = ev.payload.settings ?? {};
    const settings = mergeWithDefaults(saved);
    // A new key has no settings; write the defaults once so the inspector shows real values.
    if (!EDITABLE.every((key) => key in saved)) await ev.action.setSettings(settings);

    // willAppear fires on every folder and profile change. Keep what the key already knew, so
    // walking through folders redraws from memory instead of re-fetching.
    const existing = this.instances.get(ev.action.id);
    const instance: KeyInstance = {
      action: ev.action,
      settings,
      keyDownAt: null,
      last: existing && existing.settings.symbol === settings.symbol ? existing.last : null,
      earningsSoon: existing && existing.settings.symbol === settings.symbol ? existing.earningsSoon : false,
      closeWindow: existing?.closeWindow ?? null,
      generation: existing?.generation ?? 0,
    };
    this.instances.set(ev.action.id, instance);
    this.schedule(ev.action.id);

    const fresh = instance.last && Date.now() - instance.last.fetchedAt < intervalMs(settings);
    if (fresh) await this.draw(instance);
    else await this.refresh(ev.action.id);
  }

  override onWillDisappear(ev: WillDisappearEvent<TickerSettings>): void {
    // The redraw tick and the window are meaningless while the key is not drawn. The snapshot is
    // kept, so coming back is instant.
    ticker.clear(tickId(ev.action.id));
    const instance = this.instances.get(ev.action.id);
    instance?.closeWindow?.();
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<TickerSettings>): Promise<void> {
    const instance = this.instances.get(ev.action.id);
    if (!instance) return;
    const next = mergeWithDefaults(ev.payload.settings);
    const symbolChanged = next.symbol !== instance.settings.symbol;
    if (symbolChanged) {
      // Typed in the inspector, so the name search stored belongs to the old symbol.
      if (next.name && next.name === instance.settings.name) {
        next.name = "";
        await ev.action.setSettings(next);
      }
      instance.last = null;
      instance.earningsSoon = false;
      instance.generation++;
    }
    instance.settings = next;
    this.schedule(ev.action.id);
    if (symbolChanged) await this.refresh(ev.action.id, { force: true });
    else await this.draw(instance);
  }

  override onKeyDown(ev: KeyDownEvent<TickerSettings>): void {
    // There is no press-and-hold event; time it here and decide on key up.
    const instance = this.instances.get(ev.action.id);
    if (instance) instance.keyDownAt = Date.now();
  }

  override async onKeyUp(ev: KeyUpEvent<TickerSettings>): Promise<void> {
    const instance = this.instances.get(ev.action.id);
    if (!instance) return;
    const held = Date.now() - (instance.keyDownAt ?? Date.now());
    instance.keyDownAt = null;

    if (!instance.settings.symbol || held >= LONG_PRESS_MS) {
      this.openWindow(ev.action.id);
      return;
    }
    const ok = await this.refresh(ev.action.id, { force: true });
    if (ok) await ev.action.showOk();
    else await ev.action.showAlert();
  }

  override async onSendToPlugin(ev: PluginMessageEvent): Promise<void> {
    const payload = (ev.payload ?? {}) as { event?: string; key?: unknown };
    switch (payload.event) {
      case "search":
        this.openWindow(ev.action.id, "search");
        return;
      case "openSignup":
        await streamDeck.system.openUrl(FINNHUB_SIGNUP);
        return;
      case "getKeyStatus":
        await this.sendKeyStatus();
        return;
      case "setFinnhubKey":
        await this.setFinnhubKey(typeof payload.key === "string" ? payload.key : "");
        return;
    }
  }

  // ---- refreshing and drawing ----

  private schedule(id: string): void {
    const instance = this.instances.get(id);
    if (!instance?.settings.symbol) {
      ticker.clear(tickId(id));
      return;
    }
    ticker.set(tickId(id), intervalMs(instance.settings), () => void this.refresh(id));
  }

  /** Fetches and draws. Resolves true when the key now shows a current quote. */
  private async refresh(id: string, options: { force?: boolean } = {}): Promise<boolean> {
    const instance = this.instances.get(id);
    if (!instance) return false;
    const { symbol } = instance.settings;
    if (!symbol) {
      await this.draw(instance);
      return false;
    }
    if (!instance.last) await this.paint(instance, { kind: "loading", symbol });

    const generation = instance.generation;
    try {
      const snap = await quotes.snapshot(symbol, options);
      if (instance.generation !== generation) return false;
      instance.last = snap;
      await this.draw(instance);
      await this.updateEarnings(instance, generation);
      return true;
    } catch (error) {
      if (instance.generation !== generation) return false;
      const kind = error instanceof ProviderError ? error.kind : "unavailable";
      streamDeck.logger.warn(`${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      if (kind === "not-found") {
        instance.last = null;
        await this.paint(instance, { kind: "error", symbol, message: "Not found", hint: "Hold to change" });
      } else if (instance.last) {
        // Keep the last good numbers; draw() dims them once they are too old to trust.
        await this.draw(instance);
      } else {
        const hasKey = !!(await finnhubKey());
        await this.paint(instance, { kind: "error", symbol, message: "No data", hint: hasKey ? "Retrying" : "Add a free key" });
      }
      return false;
    }
  }

  /** Redraws only when the badge changes; the earnings date is cached for hours. */
  private async updateEarnings(instance: KeyInstance, generation: number): Promise<void> {
    const earnings = await quotes.earnings(instance.settings.symbol);
    if (instance.generation !== generation) return;
    const days = earnings ? daysUntil(earnings.date, exchangeDate(Date.now())) : -1;
    const soon = days >= 0 && days <= EARNINGS_BADGE_DAYS;
    if (soon === instance.earningsSoon) return;
    instance.earningsSoon = soon;
    await this.draw(instance);
  }

  private async draw(instance: KeyInstance): Promise<void> {
    const { settings, last } = instance;
    if (!settings.symbol) {
      await this.paint(instance, { kind: "empty" });
      return;
    }
    if (!last) {
      await this.paint(instance, { kind: "loading", symbol: settings.symbol });
      return;
    }
    await this.paint(instance, {
      kind: "quote",
      symbol: settings.symbol,
      price: last.quote.price,
      change: last.quote.change,
      changePct: last.quote.changePct,
      points: last.series?.points,
      prevClose: last.quote.prevClose,
      currency: last.quote.currency,
      display: settings.display,
      changeAs: settings.changeAs,
      earningsSoon: instance.earningsSoon,
      // Twice the interval: one missed refresh is a blip, two means the numbers are old.
      stale: Date.now() - last.fetchedAt > 2 * intervalMs(settings),
    });
  }

  private async paint(instance: KeyInstance, view: KeyView): Promise<void> {
    await instance.action.setImage(toDataUri(renderKey(view)));
  }

  // ---- the window ----

  private openWindow(id: string, startIn?: "search"): void {
    const instance = this.instances.get(id);
    if (!instance) return;
    // Claimed before the first await, or a second press opens a second window.
    if (instance.closeWindow) return;
    instance.closeWindow = () => { /* replaced once the window is up */ };

    void openStockWindow({
      quotes,
      symbol: () => (startIn === "search" ? "" : instance.settings.symbol),
      onSelect: async (result) => {
        startIn = undefined;
        await this.assign(id, result.symbol, result.name);
      },
      onOpen: (close) => { instance.closeWindow = close; },
    })
      .catch(async (error: unknown) => {
        streamDeck.logger.error(`window failed: ${error instanceof Error ? error.message : String(error)}`);
        await instance.action.showAlert();
      })
      .finally(() => { instance.closeWindow = null; });
  }

  private async assign(id: string, symbol: string, name: string): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) return;
    instance.settings = { ...instance.settings, symbol: normalise(symbol), name };
    instance.last = null;
    instance.earningsSoon = false;
    instance.generation++;
    await instance.action.setSettings(instance.settings);
    // setSettings() does not fire onDidReceiveSettings, so reschedule and redraw here.
    this.schedule(id);
    void this.refresh(id, { force: true });
  }

  // ---- the Finnhub key ----

  private async sendKeyStatus(message?: string, ok?: boolean): Promise<void> {
    const key = await finnhubKey();
    await streamDeck.ui.sendToPropertyInspector({ event: "keyStatus", hasKey: !!key, hint: keyHint(key), message: message ?? null, ok: ok ?? null });
  }

  private async setFinnhubKey(raw: string): Promise<void> {
    const key = raw.trim();
    if (key) {
      try {
        await finnhub.fetchQuote("AAPL", key);
      } catch (error) {
        if (error instanceof ProviderError && error.kind === "unauthorized") {
          await this.sendKeyStatus("Finnhub did not accept that key. Nothing was saved.", false);
          return;
        }
        // Anything else (a network blip, a rate limit) says nothing about the key; save it.
      }
    }
    await saveFinnhubKey(key);
    await this.sendKeyStatus(key ? "Key saved. Quotes now come from Finnhub where it covers the symbol." : "Key removed. Quotes come from Yahoo.", true);
  }
}

function tickId(id: string): string {
  return `quote:${id}`;
}

function intervalMs(settings: Required<TickerSettings>): number {
  return settings.intervalMin * 60_000;
}

