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

import { acknowledge, alertView, CONDITIONS, describeCondition, distance, needsTarget, rearmLine, step, type Condition, type Reading } from "../lib/alert.js";
import { renderKey, toDataUri, type KeyView } from "../lib/key-image.js";
import { ProviderError } from "../lib/providers/types.js";
import { normalise } from "../lib/quotes.js";
import { ALERT_EDITABLE, mergeAlert, type AlertSettings } from "../lib/settings.js";
import { handleSharedMessage, LONG_PRESS_MS, onKeyChange, quotes } from "../services.js";
import { openStockWindow } from "../stock-window.js";
import { ticker } from "../tick.js";

/**
 * Price Alert: watches one symbol for a condition — above or below a price, up or down a % today,
 * a new 52-week high or low — and turns the key amber, pulsing, when it is met.
 *
 *   empty key, any press   → search window, to pick a symbol
 *   short press            → clear a fired alert; otherwise refresh now
 *   hold                   → detail window
 *
 * It keeps watching while its folder is closed: an alert that only works while you look at it is
 * not an alert (references/sdk-gotchas.md, "willDisappear is not a shutdown"). The phase is saved
 * in the key's settings, so a fired alert is still fired after a restart. One gap: Stream Deck
 * only tells the plugin about keys it draws, so after a restart an alert in a closed folder starts
 * watching again when that folder is next opened.
 */

/** How often an alert checks. Keys on the same symbol share the request through the quote cache. */
const CHECK_MS = 60_000;
/** The fired pulse: amber for this long, dark for this long. */
const PULSE_MS = 700;
/** A reading older than this is drawn dimmed. */
const STALE_MS = 3 * CHECK_MS;

type PluginMessageEvent = Parameters<NonNullable<SingletonAction<AlertSettings>["onSendToPlugin"]>>[0];

type Instance = {
  action: KeyAction<AlertSettings>;
  settings: Required<AlertSettings>;
  keyDownAt: number | null;
  reading: (Reading & { at: number }) | null;
  /** Whether the key is on screen now; the watch runs either way, drawing only when it is. */
  visible: boolean;
  pulse: boolean;
  closeWindow: (() => void) | null;
  generation: number;
};

@action({ UUID: "com.sydwaylabs.stocks.alert" })
export class PriceAlert extends SingletonAction<AlertSettings> {
  private instances = new Map<string, Instance>();

  constructor() {
    super();
    onKeyChange(() => {
      for (const id of this.instances.keys()) void this.check(id);
    });
  }

  override async onWillAppear(ev: WillAppearEvent<AlertSettings>): Promise<void> {
    if (!ev.action.isKey()) return;
    const saved = ev.payload.settings ?? {};
    const settings = mergeAlert(saved);
    if (!ALERT_EDITABLE.every((key) => key in saved)) await ev.action.setSettings(settings);

    // One record per key for its whole life, updated in place. The window's close handler and the
    // ticks hold on to the record they started with; a fresh one here left them writing to a
    // record nobody read, and a closed window stayed "open" forever, so a hold did nothing.
    const existing = this.instances.get(ev.action.id);
    const same = !!existing && existing.settings.symbol === settings.symbol;
    const instance: Instance = existing ?? {
      action: ev.action, settings, keyDownAt: null, reading: null, visible: true, pulse: true, closeWindow: null, generation: 0,
    };
    Object.assign(instance, { action: ev.action, settings, keyDownAt: null, reading: same ? instance.reading : null, visible: true });
    this.instances.set(ev.action.id, instance);
    this.watch(ev.action.id);
    this.syncPulse(ev.action.id);

    if (instance.reading && Date.now() - instance.reading.at < CHECK_MS) await this.draw(instance);
    else await this.check(ev.action.id);
  }

  override onWillDisappear(ev: WillDisappearEvent<AlertSettings>): void {
    // Stop drawing and close the window — but keep watching. The pulse is only a picture.
    const instance = this.instances.get(ev.action.id);
    if (!instance) return;
    instance.visible = false;
    ticker.clear(pulseId(ev.action.id));
    instance.closeWindow?.();
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<AlertSettings>): Promise<void> {
    const instance = this.instances.get(ev.action.id);
    if (!instance) return;
    const next = mergeAlert(ev.payload.settings);
    const prev = instance.settings;
    const symbolChanged = next.symbol !== prev.symbol;
    const ruleChanged = symbolChanged || next.condition !== prev.condition || next.target !== prev.target;
    if (ruleChanged) {
      // A new rule starts watching afresh, whatever the old one had done.
      Object.assign(next, { phase: "armed", firedAt: null, firedPrice: null });
      if (symbolChanged && next.name === prev.name) next.name = "";
      await ev.action.setSettings(next);
    }
    if (symbolChanged) {
      instance.reading = null;
      instance.generation++;
    }
    instance.settings = next;
    this.watch(ev.action.id);
    this.syncPulse(ev.action.id);
    if (ruleChanged) await this.check(ev.action.id, { force: symbolChanged });
    else await this.draw(instance);
  }

  override onKeyDown(ev: KeyDownEvent<AlertSettings>): void {
    const instance = this.instances.get(ev.action.id);
    if (instance) instance.keyDownAt = Date.now();
  }

  override async onKeyUp(ev: KeyUpEvent<AlertSettings>): Promise<void> {
    const instance = this.instances.get(ev.action.id);
    if (!instance) return;
    const held = Date.now() - (instance.keyDownAt ?? Date.now());
    instance.keyDownAt = null;

    if (!instance.settings.symbol || held >= LONG_PRESS_MS) {
      this.openWindow(ev.action.id);
      return;
    }
    if (instance.settings.phase === "fired") {
      await this.setPhase(instance, acknowledge("fired"));
      this.syncPulse(ev.action.id);
      await this.draw(instance);
      await ev.action.showOk();
      return;
    }
    const ok = await this.check(ev.action.id, { force: true });
    if (ok) await ev.action.showOk();
    else await ev.action.showAlert();
  }

  override async onSendToPlugin(ev: PluginMessageEvent): Promise<void> {
    const payload = (ev.payload ?? {}) as { event?: string; key?: unknown };
    if (payload.event === "search") this.openWindow(ev.action.id, "search");
    else await handleSharedMessage(payload);
  }

  // ---- watching ----

  private watch(id: string): void {
    const instance = this.instances.get(id);
    if (!instance?.settings.symbol) ticker.clear(watchId(id));
    else ticker.set(watchId(id), CHECK_MS, () => void this.check(id));
  }

  /** Reads the price, steps the alert, draws. Resolves true when it has a current reading. */
  private async check(id: string, options: { force?: boolean } = {}): Promise<boolean> {
    const instance = this.instances.get(id);
    if (!instance) return false;
    const { symbol, condition, target } = instance.settings;
    if (!symbol) {
      await this.draw(instance);
      return false;
    }
    const generation = instance.generation;
    try {
      const snap = await quotes.snapshot(symbol, options);
      if (instance.generation !== generation) return false;
      instance.reading = {
        price: snap.quote.price,
        changePct: snap.quote.changePct,
        wk52High: snap.details.wk52High,
        wk52Low: snap.details.wk52Low,
        at: Date.now(),
      };
      if (!needsTarget(condition) || target > 0) {
        const next = step(instance.settings.phase, condition, target, instance.reading);
        if (next !== instance.settings.phase) {
          if (next === "fired") streamDeck.logger.info(`alert ${symbol}: ${describeCondition(condition, target)} at ${snap.quote.price}`);
          await this.setPhase(instance, next);
          this.syncPulse(id);
          // Folder open or not: the window is how an alert is seen when the key is out of view.
          if (next === "fired" && instance.settings.popup) this.openWindow(id, undefined, { unbidden: true });
        }
      }
      await this.draw(instance);
      return true;
    } catch (error) {
      if (instance.generation !== generation) return false;
      streamDeck.logger.warn(`alert ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof ProviderError && error.kind === "not-found") {
        instance.reading = null;
        await this.paint(instance, { kind: "error", symbol, message: "Not found", hint: "Hold to change" });
      } else {
        await this.draw(instance);
      }
      return false;
    }
  }

  /** A new rule from the window: saved, watched afresh, checked at once. */
  private async setRule(id: string, condition: Condition, target: number): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance || !CONDITIONS.includes(condition)) return;
    const clean = needsTarget(condition) && Number.isFinite(target) && target > 0 ? target : 0;
    instance.settings = { ...instance.settings, condition, target: clean, phase: "armed", firedAt: null, firedPrice: null };
    // setSettings() does not come back as onDidReceiveSettings, so watch and draw here.
    await instance.action.setSettings(instance.settings);
    this.syncPulse(id);
    await this.check(id);
  }

  private async setPhase(instance: Instance, phase: Required<AlertSettings>["phase"]): Promise<void> {
    const fired = phase === "fired";
    instance.settings = {
      ...instance.settings,
      phase,
      firedAt: fired ? Date.now() : instance.settings.firedAt,
      firedPrice: fired ? instance.reading?.price ?? null : instance.settings.firedPrice,
    };
    // setSettings() does not come back as onDidReceiveSettings, so the instance is already current.
    await instance.action.setSettings(instance.settings);
  }

  /** The pulse runs only while the alert is fired and its key is on screen. */
  private syncPulse(id: string): void {
    const instance = this.instances.get(id);
    if (!instance || instance.settings.phase !== "fired" || !instance.visible) {
      ticker.clear(pulseId(id));
      return;
    }
    ticker.set(pulseId(id), PULSE_MS, () => {
      instance.pulse = !instance.pulse;
      void this.draw(instance);
    });
  }

  // ---- drawing ----

  private async draw(instance: Instance): Promise<void> {
    if (!instance.visible) return;
    const { symbol, condition, target, phase } = instance.settings;
    if (!symbol) {
      await this.paint(instance, { kind: "empty" });
      return;
    }
    if (needsTarget(condition) && target <= 0) {
      await this.paint(instance, {
        kind: "alert", symbol, price: instance.reading?.price, caption: "Set a target", detail: "in the settings", state: "setup",
      });
      return;
    }
    const r = instance.reading;
    if (!r) {
      await this.paint(instance, { kind: "loading", symbol });
      return;
    }
    const caption = describeCondition(condition, target);
    await this.paint(instance, {
      kind: "alert",
      symbol,
      price: r.price,
      caption,
      detail: phase === "cleared" ? rearmLine(condition, target, r) : distance(condition, target, r),
      state: phase,
      pulse: instance.pulse,
      stale: Date.now() - r.at > STALE_MS,
    });
  }

  private async paint(instance: Instance, view: KeyView): Promise<void> {
    if (instance.visible) await instance.action.setImage(toDataUri(renderKey(view)));
  }

  // ---- the window ----

  private openWindow(id: string, startIn?: "search", options: { unbidden?: boolean } = {}): void {
    const instance = this.instances.get(id);
    if (!instance || instance.closeWindow) return;
    instance.closeWindow = () => { /* replaced once the window is up */ };
    void openStockWindow({
      quotes,
      symbol: () => instance.settings.symbol,
      startIn,
      unbidden: options.unbidden,
      // The window edits the same rule as the inspector: set it, clear a fired one, read it back.
      alert: {
        get: () => alertView(instance.settings, instance.reading),
        set: async (condition, target) => {
          await this.setRule(id, condition, target);
          return alertView(instance.settings, instance.reading);
        },
        clear: async () => {
          if (instance.settings.phase === "fired") {
            await this.setPhase(instance, acknowledge("fired"));
            this.syncPulse(id);
            await this.draw(instance);
          }
          return alertView(instance.settings, instance.reading);
        },
      },
      onSelect: async (result) => {
        startIn = undefined;
        instance.settings = {
          ...instance.settings, symbol: normalise(result.symbol), name: result.name, phase: "armed", firedAt: null, firedPrice: null,
        };
        instance.reading = null;
        instance.generation++;
        await instance.action.setSettings(instance.settings);
        this.watch(id);
        this.syncPulse(id);
        void this.check(id, { force: true });
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

const watchId = (id: string) => `alert:${id}`;
const pulseId = (id: string) => `pulse:${id}`;
