import {
  action,
  SingletonAction,
  type KeyDownEvent,
  type KeyUpEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";

import { clearTimer, msUntilDue } from "../lib/timers.js";

/**
 * A minimal action, written to demonstrate the conventions rather than to do anything.
 *
 * Replace the body; keep the shape. Every part of it is here for a reason set out in
 * references/sdk-gotchas.md.
 */

const LONG_PRESS_MS = 500;
/** Floor on scheduled work, so nothing fires while the key is still drawing. */
const MIN_DELAY_MS = 1_500;

type MySettings = {
  lastRunAt?: string | null;
  /** Numeric settings arrive from the Property Inspector as strings. See mergeWithDefaults. */
  intervalMs?: number;
};

const DEFAULTS: Required<MySettings> = { lastRunAt: null, intervalMs: 60_000 };

/**
 * The inspector-message event, derived rather than imported: `JsonValue` is not exported from
 * `@elgato/streamdeck` itself, and `SendToPluginEvent<any, …>` gives up the type checking.
 */
type PluginMessageEvent = Parameters<NonNullable<SingletonAction<MySettings>["onSendToPlugin"]>>[0];

/** Per-key state. One class instance serves every key, so nothing here may be a class field. */
type KeyInstance = {
  keyDownAt: number | null;
  timer: ReturnType<typeof setInterval> | null;
};

@action({ UUID: "com.sydwaylabs.stocks.ticker" })
export class Ticker extends SingletonAction<MySettings> {
  private instances = new Map<string, KeyInstance>();

  override async onWillAppear(ev: WillAppearEvent<MySettings>): Promise<void> {
    // Also narrows the type, so the key-only calls below are available.
    if (!ev.action.isKey()) return;

    this.instances.set(ev.action.id, { keyDownAt: null, timer: null });
    const settings = mergeWithDefaults(ev.payload.settings);

    // willAppear fires on every folder and profile change, so anything expensive is scheduled
    // from the last run rather than from now.
    const dueIn = msUntilDue(settings.lastRunAt, settings.intervalMs, MIN_DELAY_MS);
    void dueIn;

    await ev.action.setImage("imgs/actions/ticker/empty");
  }

  override onWillDisappear(ev: WillDisappearEvent<MySettings>): void {
    // Must undo everything onWillAppear set up, or a timer outlives the key it belongs to.
    const instance = this.instances.get(ev.action.id);
    if (instance) clearTimer(instance.timer);
    this.instances.delete(ev.action.id);
  }

  override onKeyDown(ev: KeyDownEvent<MySettings>): void {
    // There is no press-and-hold event; time it here and decide on key up.
    const instance = this.instances.get(ev.action.id);
    if (instance) instance.keyDownAt = Date.now();
  }

  override async onKeyUp(ev: KeyUpEvent<MySettings>): Promise<void> {
    const instance = this.instances.get(ev.action.id);
    if (!instance) return;

    const held = Date.now() - (instance.keyDownAt ?? Date.now());
    instance.keyDownAt = null;

    // Short press looks, long press acts — the safe way round, and the same on every action.
    if (held >= LONG_PRESS_MS) {
      await this.act(ev);
      return;
    }
    await this.look(ev);
  }

  override async onSendToPlugin(ev: PluginMessageEvent): Promise<void> {
    // Every inspector message carries an `event` discriminator; see references/property-inspector.md.
    if ((ev.payload as { event?: string } | null)?.event !== "reset") return;
    const settings = await ev.action.getSettings();
    await ev.action.setSettings({ ...settings, lastRunAt: null });
    // setSettings() does not fire onDidReceiveSettings, so redraw here.
    if (ev.action.isKey()) await ev.action.setImage("imgs/actions/ticker/empty");
  }

  private async act(ev: KeyUpEvent<MySettings>): Promise<void> {
    await ev.action.setImage("imgs/actions/ticker/filled");
  }

  private async look(ev: KeyUpEvent<MySettings>): Promise<void> {
    // A window opened here must not be awaited: that would hold the handler for as long as
    // someone reads it. See references/native-window.md.
    await ev.action.showOk();
  }
}

/**
 * One place where saved settings are merged and coerced.
 *
 * sdpi-components saves every text field as a string, so `"60000" > 30000` is false and a
 * threshold silently never triggers. The `|| DEFAULT` tail also covers an emptied field, which
 * coerces to 0.
 */
function mergeWithDefaults(saved: Partial<MySettings>): Required<MySettings> {
  const base = { ...DEFAULTS, ...saved };
  return {
    ...base,
    intervalMs: Number(base.intervalMs) || DEFAULTS.intervalMs,
  };
}
