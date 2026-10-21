import { TIP_CSS, TIP_SCRIPT } from "./page-tip.js";
import { WATCHLIST_MAX } from "./settings.js";
import { SYMBOL_ICONS } from "./sf-symbols.js";

/**
 * The Stocks window: one page with two views.
 *
 * - **detail** — a monitor. Polls a snapshot every 30 seconds; polling does not count as activity.
 * - **search** — a chooser. Results come from the plugin, never from the page calling out, and the
 *   plugin accepts a pick only for a symbol it has just returned.
 *
 * A key with no symbol opens straight into search, and picking closes the window. A key with a
 * symbol opens into detail, whose "Change symbol" switches to search and back.
 *
 * The page script below is plain ES2020 inside a template literal: **no backticks in it**, or the
 * window opens blank (references/page-conventions.md). The test parses every script block.
 */

export type WindowInit = {
  mode: "detail" | "search" | "board";
  symbol?: string;
  windowTitle: string;
  /** Search adds to a list and stays open for the next, instead of assigning one and closing. */
  adding?: boolean;
  /** Offer "Change symbol" in the detail view. Off for a watchlist, whose list is edited elsewhere. */
  canChange?: boolean;
  /** A Price Alert's window: show its rule beside the chart, editable, and let the chart pick a price. */
  alert?: boolean;
  /** A board that opens with its add popover already open — an empty watchlist's press. */
  openAdd?: boolean;
  /** A board that opens on its list alone; a row's click still opens the panel. */
  listOnly?: boolean;
  /** The window is pinned open (stays until closed by hand). */
  pinned?: boolean;
};

export const WINDOW_WIDTH = 640;
export const WINDOW_HEIGHT = 630;
/**
 * A board's details open beside the list: the list gives up some of its width to the panel, and
 * the window widens, about its centre, for the rest.
 */
export const BOARD_LIST_WIDTH = 560;
export const PANEL_WIDTH = 550;
export const BOARD_WIDE_WIDTH = BOARD_LIST_WIDTH + PANEL_WIDTH;
/** A board's list and panel: a stock's full panel (507 measured), so most never grow it. */
export const BOARD_VIEW_HEIGHT = 510;
/** The board's window as launched: that, plus the bar (49) and footer (30) as drawn. */
export const BOARD_WINDOW_HEIGHT = BOARD_VIEW_HEIGHT + 79;

/** JSON that is safe inside a script block: `</script>` in data cannot end it. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function renderPage(token: string, init: WindowInit): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Stocks</title>
<style>
:root {
  color-scheme: dark;
  --bg: #333333;
  --header: rgba(51,51,51,.92);
  --line: rgba(255,255,255,.08);
  --fg: #f4f4f6;
  --fg-dim: #8b8b93;
  --fg-faint: #62626b;
  --card: #262626;
  --card-line: #515151;
  --hover: rgba(255,255,255,.04);
  --kbd: rgba(255,255,255,.09);
  --accent: #29bd50;
  --on-accent: #04240e;
  --series: #6d9eeb;
  --good: #29bd50;
  --slow: #fab219;
  --fail: #d03b3b;
  --down: #ef4b4b;
}
html { background: var(--bg); }
body { margin: 0; font: 13px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; color: var(--fg); visibility: hidden; height: 100vh; display: flex; flex-direction: column; }
html.ready body { visibility: visible; }
.bar { display: flex; align-items: center; gap: 7px; padding: 10px 14px; border-bottom: 1px solid var(--line); background: var(--header); }
.brand { font-size: 13px; font-weight: 600; white-space: nowrap; }
.bar-divider { width: 1px; height: 16px; flex: 0 0 auto; margin: 0 3px; background: var(--card-line); }
.chip { font-size: 11px; color: var(--fg-dim); background: var(--kbd); padding: 2px 7px; border-radius: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.spacer { flex: 1; }
/* The window is fitted to the detail view, so nothing should need to scroll; if a short screen
   clamps it, content still scrolls, just without a bar. */
main { flex: 1; overflow: auto; padding: 14px; scrollbar-width: none; }
main::-webkit-scrollbar { display: none; }
footer { padding: 8px 14px; border-top: 1px solid var(--line); color: var(--fg-faint); font-size: 11px; display: flex; gap: 12px; }
kbd { background: var(--kbd); border-radius: 4px; padding: 0 5px; font: inherit; color: var(--fg-dim); }
button { font: inherit; color: var(--fg); background: var(--card); border: 1px solid var(--card-line); border-radius: 6px; padding: 4px 10px; cursor: default; }
button:focus-visible, input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
[hidden] { display: none !important; }

/* detail */
.name-row { display: flex; align-items: center; gap: 8px; margin: 0 0 2px; min-width: 0; }
/* The header leads with the company's mark, app-icon sized: its logo when Finnhub has one,
   otherwise its initial on a neutral tile, so every symbol gets the same header. */
.hero { display: flex; align-items: center; gap: 16px; }
.hero-text { flex: 1; min-width: 0; }
.mark { position: relative; width: 76px; height: 76px; flex: 0 0 auto; border-radius: 18px; overflow: hidden;
  background: linear-gradient(160deg, #4a4a50, #2c2c30); box-shadow: 0 0 0 1px rgba(255,255,255,.08) inset, 0 4px 14px rgba(0,0,0,.35); }
.mark img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.mono { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 34px; font-weight: 700; color: var(--fg); letter-spacing: -0.02em; }
.name { color: var(--fg-dim); margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.company { color: var(--fg-faint); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.price-row { display: flex; align-items: baseline; gap: 10px; }
.price { font-size: 32px; font-weight: 650; font-variant-numeric: tabular-nums; }
.ccy { color: var(--fg-dim); font-size: 13px; }
/* Only the figures carry the up/down colour; the period beside them is a plain label. */
.move { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
.move-label { color: var(--fg-dim); font-weight: 400; margin-left: 4px; }
/* Pre-market or after-hours, on the move's own line so the hero keeps its height; the label and
   price quiet, only the move in colour, as with today's. */
.move-ext { margin-left: 14px; white-space: nowrap; }
.move-ext .ext-label { color: var(--fg-dim); font-weight: 400; margin-right: 5px; }
.move-ext .ext-price { color: var(--fg); margin-right: 5px; }
.up { color: var(--good); } .down { color: var(--down); } .flat { color: var(--fg-dim); }
.chart-head { display: flex; align-items: center; justify-content: space-between; margin: 12px 0 6px; }
.seg { display: inline-flex; background: var(--card); border: 1px solid var(--card-line); border-radius: 7px; padding: 2px; gap: 2px; }
.seg button { border: none; background: none; padding: 2px 9px; border-radius: 5px; font-size: 12px; color: var(--fg-dim); }
.seg button:hover { color: var(--fg); }
/* Not the house green: on this screen green means "up", and a green 6M would read as a 6-month
   gain. The selected range is a neutral pill instead (a deliberate departure, see CLAUDE.md). */
.seg button.on { background: #5a5a5f; color: var(--fg); font-weight: 600; }
.seg button:focus-visible { outline: 2px solid var(--fg-dim); outline-offset: 0; }
.chart-caption { color: var(--fg-dim); font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
/* One framed card: the plot, then the price scale in a strip down its right edge, inside the
   frame. The time axis sits under the card, as wide as the plot. */
.chart-card { display: grid; grid-template-columns: 1fr auto; background: var(--card); border: 1px solid var(--card-line); border-radius: 8px; overflow: hidden; }
.chart { position: relative; height: 150px; overflow: hidden; cursor: crosshair; }
/* Hover: a rule at the nearest bar, a dot on the line, and a readout that stays inside the plot. */
.xhair { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--fg-faint); pointer-events: none; }
.dot { position: absolute; width: 9px; height: 9px; margin: -6px 0 0 -6px; border-radius: 50%; border: 2px solid var(--card); pointer-events: none; }
.readout { position: absolute; top: 6px; padding: 4px 8px; border-radius: 6px; background: #1e1e1e; border: 1px solid var(--card-line); box-shadow: var(--shadow-lift, 0 6px 18px rgba(0,0,0,.45)); pointer-events: none; white-space: nowrap; font-variant-numeric: tabular-nums; }
.readout-price { font-weight: 650; font-size: 13px; }
.readout-meta { color: var(--fg-dim); font-size: 11px; }
.yaxis { position: relative; min-width: 24px; box-sizing: content-box; padding: 0 9px 0 8px; border-left: 1px solid var(--line); }
.ytick { position: absolute; left: 8px; transform: translateY(-50%); color: var(--fg-faint); font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.chart svg { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
/* A new range or symbol fades in, quickly enough that the chart reads at once — a sweep that drew
   the line in was tried and held back the newest prices. The grid stays put underneath, and the
   30-second refresh does not animate at all. */
@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
.chart svg.reveal, .axis.fade, .yaxis.fade { animation: fade-in 150ms ease-out; }
@media (prefers-reduced-motion: reduce) {
  .chart svg.reveal, .axis.fade, .yaxis.fade { animation: none; }
}
.axis { position: relative; height: 16px; margin: 4px 1px 0; }
.tick { position: absolute; top: 0; transform: translateX(-50%); color: var(--fg-faint); font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.tick.start { transform: none; }
.tick.end { transform: translateX(-100%); }
.chart-empty { height: 100%; display: flex; align-items: center; justify-content: center; color: var(--fg-faint); }
/* Stats in pairs, filled left to right. */
.stats { display: grid; grid-template-columns: 1fr 1fr; column-gap: 28px; margin-top: 12px; }
.stat { display: flex; justify-content: space-between; gap: 10px; padding: 6px 0; border-top: 1px solid var(--line); font-variant-numeric: tabular-nums; line-height: 18px; min-width: 0; }
.stat dt { color: var(--fg-dim); white-space: nowrap; }
/* A label that explains itself on a click says so with a faint dotted underline. */
.stat dt[data-explain] { text-decoration: underline dotted rgba(255,255,255,.32); text-underline-offset: 3px; cursor: pointer; }
.stat dd { margin: 0; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta { color: var(--fg-faint); font-size: 11px; margin-top: 10px; }
.note { color: var(--slow); font-size: 12px; margin-top: 8px; }
.notice { color: var(--fg-dim); padding: 30px 10px; text-align: center; }
.added { color: var(--good); font-size: 12px; margin: 8px 2px 0; min-height: 16px; }

/* board: a watchlist as rows, one opening in place to the full chart and stats — so the other
   symbols stay in view and comparing is moving down the list, not going in and out of a page. */
/* Ten rows, and the Add slot under nine, fit the board's height, so the list never scrolls. */
.wl { display: flex; flex-direction: column; gap: 5px; }
.wrow { position: relative; background: var(--card); border: 1px solid var(--card-line); border-radius: 10px;
  transition: border-color .1s ease, transform 140ms ease; }
/* Dragging, after Timekeeper's cards: the row lifts and follows the pointer, the others slide aside. */
.wrow.lifted { transition: none; z-index: 3; box-shadow: var(--shadow-lift, 0 6px 18px rgba(0,0,0,.45)); border-color: #6a6a70; }
.wrow.lifted.settling { transition: transform 150ms cubic-bezier(.2, .7, .3, 1); }
body.dragging-row, body.dragging-row * { cursor: grabbing !important; user-select: none; }
.wrow:hover, .wrow.cursor { border-color: #6a6a70; }
/* The symbol in the panel, marked in the list beside it. */
.wrow.sel { border-color: #8a8a90; background: #303033; }
.whead { display: grid; grid-template-columns: 28px minmax(0, 1fr) 56px 104px 88px; align-items: center; column-gap: 14px;
  height: 42px; padding: 0 14px; cursor: pointer; }
.wmark { position: relative; width: 28px; height: 28px; border-radius: 7px; overflow: hidden; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(160deg, #4a4a50, #2c2c30); font-size: 14px; font-weight: 700; color: var(--fg);
  box-shadow: 0 0 0 1px rgba(255,255,255,.08) inset; }
/* The logo over the initial, so a slow or failed image still leaves a mark — as the large tile does. */
.wmark img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.wwho { min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 2px; line-height: 16px; }
.wsym { font-size: 13.5px; font-weight: 600; white-space: nowrap; display: flex; align-items: center; gap: 6px; }
.wname { font-size: 11.5px; color: var(--fg-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* Which row the key is showing: a fact, in white, beside the symbol — not the up-green. */
.onkey { flex: none; font-size: 9px; font-weight: 600; color: var(--fg); background: var(--kbd); border-radius: 4px; padding: 1px 5px; letter-spacing: .03em; }
.wspark { display: block; }
.wprice { text-align: right; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wprice .unit { font-size: 10.5px; font-weight: 500; color: var(--fg-dim); margin-left: 3px; }
/* The move as a pill, coloured by direction — the one place colour sits in a closed row. */
/* Every pill the column's full width, the figure right-aligned in it, so the column reads as one
   and the digits line up down the board whatever their length. */
.wmove { justify-self: stretch; box-sizing: border-box; text-align: right; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums;
  padding: 3px 7px; border-radius: 6px; background: #4a4a50; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* Solid fills carrying the direction, white figures on them — as Stocks does. Muted a step from the
   line colours so the column does not shout over the prices beside it. */
.wmove.up { background: #1f9a42; color: #fff; }
.wmove.down { background: #c9403f; color: #fff; }
/* Clicking a pill switches every row between % and the amount, as Stocks on iPhone does. */
.wmove { cursor: pointer; border: 1px solid transparent; position: relative; }
.wmove:hover { border-color: rgba(255,255,255,.18); }

.werr { grid-column: 3 / -1; justify-self: end; color: var(--slow); font-size: 12.5px; }
/* Where the next symbol goes: the one empty slot under a list with room. */
.wslot { display: flex; align-items: center; gap: 14px; height: 44px; padding: 0 14px; box-sizing: border-box;
  border: 1px dashed #47474c; border-radius: 10px; color: var(--fg-faint); font-size: 12.5px; cursor: pointer; }
.wslot:hover { border-color: #6a6a70; color: var(--fg-dim); }
.wslot b { width: 28px; height: 28px; box-sizing: border-box; border-radius: 7px; border: 1px dashed #55555a;
  display: grid; place-items: center; font-size: 17px; font-weight: 400; }

/* A board: the list and, beside it, the detail view as a panel. The window widens for the panel
   and keeps one height whatever the list's length, so neither opening it nor adding a symbol
   moves anything; a short list leaves room under it. */
/* Clipped, not squeezed: while the window widens or narrows, the panel is cut off at its edge. */
.split { flex: 1; min-height: 0; display: flex; overflow: hidden; }
.split > main { min-width: 0; }
#board { padding-top: 10px; padding-bottom: 10px; }
.split.side #board { flex: 0 0 ${BOARD_LIST_WIDTH}px; box-sizing: border-box; }
/* No slide-in of its own: the window's widening is the motion, and a CSS animation in a window
   not yet on screen does not advance — the panel would open stuck at its first frame, invisible. */
.split.side #detail { flex: 0 0 ${PANEL_WIDTH}px; box-sizing: border-box; background: #2d2d2d;
  border-left: 1px solid #4a4a50; }
.side .hero { gap: 12px; }
/* The mark spans the hero's three lines, from the symbol's cap to the move's last line. */
.side .mark { width: 56px; height: 56px; border-radius: 13px; box-shadow: 0 0 0 1px rgba(255,255,255,.08) inset; }
.side .mono { font-size: 24px; }
/* The symbol never gives way; a long company line beside it is what gets cut short. */
.side .name { color: var(--fg); font-weight: 650; font-size: 14px; flex: none; overflow: visible; }
.side .price-row { gap: 8px; }
.side .price { font-size: 22px; }
.side .move { font-size: 13px; }
.side .chart-head { margin-top: 14px; }
/* News and website: one group of icon buttons in the corner, level with the logo's top. */
.hero-acts { display: flex; gap: 6px; align-self: flex-start; margin-left: auto; }
.wacts { display: flex; gap: 8px; justify-content: flex-end; align-items: center; margin-top: 10px; }
/* The panel's last line sits on its bottom edge, so Show on key and Remove stay put while ↑↓ step
   through symbols with more or fewer figures. A column only while shown: display would otherwise
   beat the hidden attribute. Nothing in it shrinks — a tall panel scrolls, as before. */
.split.side #detail:not([hidden]) { display: flex; flex-direction: column; }
.split.side #detail > * { flex-shrink: 0; }
.side .wacts { margin-top: auto; padding-top: 10px; }
.wacts button { font-size: 12px; padding: 0 10px; height: 28px; box-sizing: border-box; border-radius: 7px; }
.wacts .iconbtn { padding: 0; }
/* Icon buttons after Timekeeper's: 28px, with their own tooltip, since the native host does not show
   the title attribute. Remove is solid red from the start — it should look like what it does — and
   only lightens a touch under the pointer. (Timekeeper's outlined-until-hover Remove is to follow.) */
.iconbtn { flex: 0 0 auto; width: 28px; height: 28px; padding: 0; display: inline-grid; place-items: center; position: relative;
  color: var(--fg-dim); background: transparent; border: 1px solid var(--card-line); border-radius: 7px; }
.iconbtn:hover { background: var(--kbd); color: var(--fg); }
.iconbtn.remove { color: #fff; background: var(--fail); border-color: var(--fail); }
.iconbtn.remove:hover { color: #fff; background: #dc4a4a; border-color: #dc4a4a; }

/* In the panel, the stats sit four across and label-over-value, so a full set is three short lines. */
.side .stats { grid-template-columns: repeat(4, minmax(0, 1fr)); column-gap: 16px; margin-top: 10px; }
.side .stat { flex-direction: column; justify-content: flex-start; gap: 1px; padding: 6px 0; }
.side .stat dt { font-size: 11px; }
.side .stat dd { text-align: left; font-size: 12.5px; }
/* A short set — an index, a coin, a stock without Finnhub's extras — has room to spare: two across,
   label and value on one line, as the Ticker's window shows them. */
.side .stats.roomy { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 28px; }
.side .stats.roomy .stat { flex-direction: row; justify-content: space-between; gap: 10px; }
.side .stats.roomy .stat dt { font-size: inherit; }
.side .stats.roomy .stat dd { text-align: right; font-size: inherit; }
/* The source line shares the row's last line with its buttons: on the left, quiet, and clipped
   rather than wrapped if a long one meets them. */
.wacts .meta { margin: 0 auto 0 0; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.board-empty { color: var(--fg-dim); text-align: center; padding: 40px 10px; }

/* A Price Alert's rule, beside its chart: a plain card like the rest, with amber only in its title
   (and the whole card tinted when it has fired). */
.abox { margin-top: 12px; background: var(--card); border: 1px solid var(--card-line);
  border-radius: 8px; padding: 9px 12px 10px; }
.abox.fired { background: rgba(250,178,25,.10); border-color: #fab219; }
.abox-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; min-width: 0; }
.abox-title { font-size: 12px; font-weight: 650; color: #fab219; letter-spacing: .02em; }
.abox-status { font-size: 12px; color: var(--fg-dim); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.abox-status.err { color: var(--fail); }
.abox-form { display: flex; gap: 8px; align-items: center; }
/* A preference, not part of the rule: saved on the click, no Set alert needed. The system's own
   checkbox, in the alert's amber. */
.abox-opt { display: inline-flex; align-items: center; gap: 6px; flex: none; font-size: 12px; color: var(--fg-dim); cursor: pointer; user-select: none; white-space: nowrap; }
.abox-opt input { margin: 0; accent-color: #fab219; cursor: pointer; }
/* The condition and the target only — not every input in the box, or the checkbox catches it. */
.abox select, .abox #a-target { font: inherit; font-size: 13px; color: var(--fg); background: #1d1d1d; border: 1px solid var(--card-line);
  border-radius: 7px; height: 30px; box-sizing: border-box; padding: 0 8px; }
.abox select { flex: 0 0 auto; }
.abox #a-target { width: 110px; font-variant-numeric: tabular-nums; }
.abox .spacer { flex: 1; }
.abox button { height: 30px; border-radius: 7px; padding: 0 12px; font-size: 12.5px; }
.abox button.iconbtn { width: 30px; padding: 0; }
.abox button.amber { background: #fab219; border-color: #fab219; color: #1f1600; font-weight: 650; }
.abox button.amber:hover { background: #ffc23a; border-color: #ffc23a; }
.abox button.amber:disabled { background: transparent; border-color: var(--card-line); color: var(--fg-faint); }
/* The target on the chart, and, in an alert's window, the level under the pointer, to click. */
.aline-label { position: absolute; left: 6px; transform: translateY(-50%); font-size: 10.5px; font-weight: 650; color: #1f1600;
  background: #fab219; border-radius: 4px; padding: 0 5px; pointer-events: none; white-space: nowrap; }
.aline-label.edge { transform: none; }
.yguide { position: absolute; left: 0; right: 0; height: 0; border-top: 1px dashed rgba(250,178,25,.55); pointer-events: none; }
.yguide span { position: absolute; right: 6px; top: -9px; font-size: 10.5px; color: #fab219; background: var(--card); padding: 0 4px; border-radius: 3px; }

/* Adding to a watchlist, as Timekeeper's world clock adds a place: a popover from the + button,
   over the board, which stays where it is and fills in behind it. */
.popover { position: absolute; z-index: 30; right: 14px; width: 320px; background: #2b2b2b; border: 1px solid var(--card-line);
  border-radius: 10px; padding: 10px 12px 12px; box-shadow: 0 10px 28px rgba(0,0,0,.5); }
.popover::before, .popover::after { content: ""; position: absolute; right: var(--arrow, 14px); width: 0; height: 0;
  border: 7px solid transparent; border-top: 0; }
.popover::before { top: -8px; border-bottom: 8px solid var(--card-line); }
.popover::after { top: -7px; border-bottom: 8px solid #2b2b2b; }
.popover .title { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--fg-faint); margin-bottom: 8px; }
.popover input { width: 100%; box-sizing: border-box; font: inherit; font-size: 13px; color: var(--fg); background: #1d1d1d;
  border: 1px solid var(--card-line); border-radius: 7px; height: 30px; padding: 0 9px; }
.pop-results { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
.pop-result { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 7px; cursor: pointer; border: 1px solid transparent; min-width: 0; }
.pop-result:hover { background: var(--hover); }
.pop-result.on { background: var(--kbd); border-color: var(--card-line); }
.pop-result .s { font-size: 12.5px; font-weight: 600; flex: none; }
.pop-result .n { font-size: 12px; color: var(--fg-dim); flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pop-result .x { font-size: 10.5px; color: var(--fg-faint); flex: none; }
.pop-note { font-size: 11.5px; color: var(--fg-faint); margin: 8px 2px 0; min-height: 15px; }
.pop-note.good { color: var(--good); }
.pop-note.bad { color: var(--slow); }
.iconbtn.on { background: var(--kbd); color: var(--fg); }
/* Pinned: pressed in, in white rather than Quick Clips' green, which here would read as "up". */
#pin.on, #details.on { background: #4a4a50; border-color: #6a6a70; color: #fff; }
/* News: the add popover's frame, a few headlines, each opening in the browser. */
.popover.news { width: 380px; padding: 6px; }
.news-item { display: flex; gap: 10px; align-items: flex-start; width: 100%; box-sizing: border-box; text-align: left; font: inherit; padding: 6px 8px;
  border: 0; border-radius: 6px; background: none; color: var(--fg); cursor: pointer; }
.news-item:hover { background: var(--hover); }
/* The story's picture, over the publisher's initial: a missing or slow picture still leaves a mark,
   as a company's logo does. */
.news-thumb { position: relative; flex: none; width: 40px; height: 40px; border-radius: 7px; overflow: hidden; margin-top: 1px;
  display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 700; color: var(--fg-dim);
  background: linear-gradient(160deg, #4a4a50, #2c2c30); box-shadow: 0 0 0 1px rgba(255,255,255,.08) inset; }
.news-thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.news-text { min-width: 0; }
.news-item .t { font-size: 12.5px; line-height: 16px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.news-item .w { font-size: 11px; color: var(--fg-faint); margin-top: 2px; }
.news-note { font-size: 12px; color: var(--fg-faint); padding: 6px 8px; }
@keyframes spin { to { transform: rotate(360deg); } }
#refresh.spinning svg { animation: spin .8s linear infinite; }
@media (prefers-reduced-motion: reduce) { #refresh.spinning svg { animation: none; opacity: .5; } }
.bar .iconbtn + .iconbtn, .bar .iconbtn + button { margin-left: 2px; }

/* One tooltip for the page (patterns/page-tip): the native host shows no title attribute, and a
   tip on the element itself is clipped by the scrolling board. Hints are sentences, so they wrap. */
${TIP_CSS}
.page-tip { white-space: normal; max-width: 260px; }

/* search */
.search-box { width: 100%; box-sizing: border-box; font: inherit; font-size: 15px; color: var(--fg); background: var(--card); border: 1px solid var(--card-line); border-radius: 8px; padding: 9px 11px; }
.results { list-style: none; margin: 10px 0 0; padding: 0; }
.result { display: flex; align-items: center; gap: 10px; padding: 7px 9px; border-radius: 7px; min-height: 34px; }
.result:hover { background: var(--hover); }
.result.sel { background: var(--accent); color: var(--on-accent); }
.result.sel .r-name, .result.sel .r-ex { color: var(--on-accent); }
.result.sel .badge { background: rgba(0,0,0,.15); color: var(--on-accent); }
.r-main { flex: 1; min-width: 0; }
.r-sym { font-weight: 650; line-height: 17px; }
.r-name { color: var(--fg-dim); font-size: 12px; line-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.r-side { text-align: right; flex: 0 0 auto; }
.badge { font-size: 10px; padding: 1px 6px; border-radius: 4px; background: var(--kbd); color: var(--fg-dim); text-transform: uppercase; letter-spacing: .03em; }
.r-ex { color: var(--fg-faint); font-size: 11px; line-height: 16px; }
</style>
</head>
<body>
<div class="bar" id="bar">
  <span class="brand">Stocks</span>
  <span class="bar-divider"></span>
  <span class="chip" id="chip"></span>
  <span class="spacer"></span>
  <!-- In the corner where + is on the board: one place, its job set by the view. -->
  <!-- Refresh and pin, on the views that show prices; then the view's own button. -->
  <button id="refresh" class="iconbtn" aria-label="Refresh" data-hint="Refresh now" hidden></button>
  <button id="pin" class="iconbtn" aria-label="Pin open" aria-pressed="false" data-hint="Keep this window open" hidden></button>
  <button id="details" class="iconbtn" aria-label="Details" aria-pressed="true" hidden></button>
  <button id="back" class="iconbtn" aria-label="Back to watchlist" data-hint="Back to watchlist" hidden></button>
  <!-- Neutral, not Timekeeper's green Add: on this screen green means a price went up. -->
  <button id="add" class="iconbtn" aria-label="Add symbol" data-hint="Add symbol" hidden></button>
  <!-- The same place, button and popover on every window: + adds to a watchlist, ⇄ changes a key's symbol. -->
  <button id="change" class="iconbtn" aria-label="Change symbol" data-hint="Change symbol" hidden></button>
</div>

<div class="split" id="split">
<main id="board" hidden><div class="wl" id="cards"></div></main>
<div class="popover news" id="news-sheet" role="dialog" aria-label="News" hidden></div>
<div class="popover" id="add-sheet" role="dialog" aria-label="Add symbol" hidden>
  <div class="title" id="pop-title">Add symbol</div>
  <input id="add-q" type="text" placeholder="Company, fund, ETF or crypto" autocomplete="off" spellcheck="false" aria-label="Search">
  <ul class="pop-results" id="add-results" role="listbox"></ul>
  <p class="pop-note" id="add-note"></p>
</div>

<main id="detail" hidden>
  <div class="hero">
    <div class="mark" aria-hidden="true"><span class="mono" id="d-mono"></span><img id="d-logo" alt="" hidden></div>
    <div class="hero-text">
      <div class="name-row">
        <p class="name" id="d-name"></p>
        <span class="company" id="d-company"></span>
      </div>
      <div class="price-row"><span class="price" id="d-price"></span><span class="ccy" id="d-ccy"></span></div>
      <div class="move" id="d-move"></div>
    </div>
    <div class="hero-acts">
      <button id="d-news" class="iconbtn" aria-label="News" aria-haspopup="dialog" data-hint="News" hidden></button>
      <button id="d-web" class="iconbtn" aria-label="Company website" data-hint="Company website" hidden></button>
    </div>
  </div>
  <!-- The chart, stats and source line. On a watchlist board this whole block moves into the
       open row; elsewhere it stays here under the price. -->
  <section class="abox" id="d-alert" hidden>
    <div class="abox-head">
      <span class="abox-title">ALERT</span>
      <span class="abox-status" id="a-status"></span>
    </div>
    <div class="abox-form">
      <select id="a-cond" aria-label="Alert when">
        <option value="above">Price rises to</option>
        <option value="below">Price falls to</option>
        <option value="up-pct">Up today by %</option>
        <option value="down-pct">Down today by %</option>
        <option value="high-52w">New 52-week high</option>
        <option value="low-52w">New 52-week low</option>
      </select>
      <input id="a-target" inputmode="decimal" autocomplete="off" spellcheck="false" aria-label="Target">
      <label class="abox-opt" data-hint="Open this window when the alert fires, as well as lighting the key"><input type="checkbox" id="a-popup"> Pop up when it fires</label>
      <span class="spacer"></span>
      <button id="a-remove" class="iconbtn remove" aria-label="Remove alert" data-hint="Remove alert" hidden></button>
      <button id="a-clear" hidden>Clear</button>
      <button id="a-set" class="amber">Set alert</button>
    </div>
  </section>
  <div id="d-body">
  <div class="chart-head">
    <div class="seg" id="ranges" role="tablist" aria-label="Chart range">
      <button data-range="1d" class="on" role="tab">1D</button><button data-range="5d" role="tab">5D</button><button data-range="1mo" role="tab">1M</button><button data-range="6mo" role="tab">6M</button><button data-range="ytd" role="tab">YTD</button><button data-range="1y" role="tab">1Y</button>
    </div>
    <span class="chart-caption" id="chart-caption"></span>
  </div>
  <div class="chart-card">
    <div class="chart" id="d-chart"></div>
    <div class="yaxis" id="d-yaxis"></div>
  </div>
  <div class="axis" id="d-axis"></div>
  <dl class="stats" id="d-rows"></dl>
  <p class="note" id="d-note" hidden></p>
  <p class="meta" id="d-meta"></p>
  </div>
</main>
</div>
<main id="d-error" class="notice" hidden></main>

<main id="search" hidden>
  <input class="search-box" id="q" type="text" placeholder="Search a company, fund, ETF or crypto" autocomplete="off" spellcheck="false" aria-label="Search">
  <ul class="results" id="results" role="listbox"></ul>
  <p class="added" id="s-added"></p>
  <p class="notice" id="s-notice" hidden></p>
</main>

<footer id="footer"></footer>

<script>
var TOKEN = ${scriptJson(token)};
var INIT = ${scriptJson(init)};
var SF = ${scriptJson(SYMBOL_ICONS)};
function post(type, extra) {
  var body = Object.assign({ type: type }, extra || {});
  return fetch("/message?t=" + encodeURIComponent(TOKEN), { method: "POST", body: JSON.stringify(body) })
    .then(function (r) { return r.json(); });
}
window.addEventListener("error", function (e) { post("error", { message: String(e.message) }); });
window.addEventListener("unhandledrejection", function (e) { post("error", { message: String(e.reason) }); });
</script>
<script>
(function () {
  document.title = INIT.windowTitle;
  var mode = INIT.mode;
  var openedForSearch = INIT.mode === "search";
  /* A watchlist's window: it opens on the board, and the other views lead back to it. */
  var onBoard = INIT.mode === "board";
  var symbol = INIT.symbol || "";
  var results = [];
  var selected = 0;
  var query = "";
  var searchSeq = 0;
  var debounce = 0;
  var poll = 0;
  var lastPing = 0;
  var website = "";
  /* View state lives here, not in the DOM: the 30-second poll rebuilds the detail view. */
  var range = "1d";
  var chart1d = null;
  var rangeCharts = {};
  /* What is drawn now, and where the pointer is over it (0–1), so a redraw keeps the crosshair. */
  var shown = null;
  var hoverAt = null;
  var hoverY = null;
  var drawnKey = "";
  /* Today's move, from the quote; shown under the price while the 1D chart is up. */
  var today = null;
  var fitTimer = 0;

  var $ = function (id) { return document.getElementById(id); };

  /* Real interaction keeps the window alive; the 30s poll deliberately does not. */
  function activity() {
    var now = Date.now();
    if (now - lastPing < 5000) return;
    lastPing = now;
    post("ping");
  }
  ["keydown", "pointerdown", "input", "wheel"].forEach(function (t) { document.addEventListener(t, activity, true); });

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function setFooter(items) {
    var f = $("footer");
    f.replaceChildren();
    items.forEach(function (pair) {
      var s = el("span");
      s.append(el("kbd", "", pair[0]), " " + pair[1]);
      f.append(s);
    });
  }

  /*
   * Fits the window to what it shows (references/page-conventions.md, "Fitting the window"). The
   * detail view is sized to its content, which varies with what the source gave. Search keeps the
   * full height, so the window does not jump about as results arrive. A zero timeout, not
   * requestAnimationFrame: a window not on screen yet gets no frames.
   */
  function fit() {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(function () {
      var height = ${WINDOW_HEIGHT};
      var width = 0;
      if (mode === "board") {
        height = $("bar").offsetHeight + boardHeight() + $("footer").offsetHeight;
        width = openSym ? ${BOARD_WIDE_WIDTH} : ${BOARD_LIST_WIDTH};
      } else if (mode === "detail") {
        var view = $("detail").hidden ? $("d-error") : $("detail");
        view.style.flex = "none";
        height = $("bar").offsetHeight + view.scrollHeight + $("footer").offsetHeight;
        view.style.flex = "";
      }
      /* An open popover floats over the board; the window grows only if it would run off the bottom. */
      ["add-sheet", "news-sheet"].forEach(function (id) {
        var pop = $(id);
        if (!pop.hidden) height = Math.max(height, pop.offsetTop + pop.offsetHeight + 12);
      });
      /* A board grows and shrinks from its right edge, so the list holds still and the panel slides
         out beside it, and back. */
      var size = width ? { height: height, width: width, anchor: "left" } : { height: height };
      if (window.__nativeHost) {
        try { window.webkit.messageHandlers.resize.postMessage(size); } catch (e) { /* older host */ }
      } else {
        try { window.resizeTo(width ? width + (outerWidth - innerWidth) : outerWidth, height + (outerHeight - innerHeight)); } catch (e) { /* not allowed */ }
      }
    }, 0);
  }

  /*
   * A board keeps one height: at least BOARD_MIN — a stock's full panel — and whatever taller
   * panel it has had to show since it opened. It never shrinks back, so stepping from a stock to an
   * index, with fewer figures, does not move the window; a longer list scrolls.
   */
  var BOARD_MIN = ${BOARD_VIEW_HEIGHT};
  var boardTall = BOARD_MIN;
  function boardHeight() {
    var d = $("detail");
    if (openSym && !d.hidden) {
      d.style.alignSelf = "flex-start";
      boardTall = Math.max(boardTall, d.offsetHeight);
      d.style.alignSelf = "";
    }
    return boardTall;
  }

  function show(next) {
    mode = next;
    closeNews();
    $("detail").hidden = true;
    $("d-error").hidden = true;
    $("board").hidden = next !== "board";
    $("split").classList.remove("side");
    $("search").hidden = next !== "search";
    $("change").hidden = next !== "detail" || INIT.canChange === false;
    /* A board's views lead back to it; its own view offers Add. */
    $("back").hidden = !onBoard || next === "board";
    $("refresh").hidden = next === "search";
    $("pin").hidden = next === "search";
    $("add").hidden = !onBoard || next !== "board";
    $("details").hidden = !onBoard || next !== "board";
    clearInterval(poll);
    if (next === "board") {
      setFooter(boardFooter());
      if (openSym) showPanel();
      loadBoard();
      poll = setInterval(function () { loadBoard(); if (openSym) loadDetail(); }, 30000);
    } else if (next === "search") {
      $("chip").textContent = INIT.adding ? "Add to watchlist" : symbol ? "Change " + symbol : "Choose a symbol";
      setFooter([["↑↓", "choose"], ["↵", INIT.adding ? "add" : "pick"], ["esc", onBoard || !openedForSearch ? "back" : INIT.adding ? "done" : "close"]]);
      var q = $("q");
      q.value = query;
      q.focus();
      q.select();
      renderResults();
      fit();
    } else {
      $("chip").textContent = symbol;
      setFooter(INIT.canChange === false
        ? [["1–6", "range"], ["r", "refresh"], ["esc", onBoard ? "back" : "close"]]
        : [["1–6", "range"], ["r", "refresh"], ["p", "pin"], ["s", "change symbol"], ["esc", "close"]]);
      loadDetail();
      poll = setInterval(loadDetail, 30000);
    }
  }

  /* ---- refresh and pin ---- */

  /* What is being looked at, past the caches, for someone who wants the latest price now; the icon
     turns while it works. */
  var refreshing = false;
  function refreshNow() {
    if (refreshing || mode === "search") return;
    refreshing = true;
    var btn = $("refresh");
    btn.classList.add("spinning");
    rangeCharts = {};
    var jobs = [];
    if (mode === "board") {
      /* The list as it is (it is never more than a poll old); only the panel's symbol is forced. */
      jobs.push(loadBoard());
      if (openSym) jobs.push(loadDetail(true));
    } else {
      jobs.push(loadDetail(true));
    }
    if ((mode === "detail" || openSym) && range !== "1d") selectRange(range, true);
    var started = Date.now();
    Promise.all(jobs).catch(function () {}).then(function () {
      /* At least one turn, so a fast answer still reads as having happened. */
      setTimeout(function () { refreshing = false; btn.classList.remove("spinning"); }, Math.max(0, 600 - (Date.now() - started)));
    });
  }

  var pinned = !!INIT.pinned;
  /* The board remembers whether its panel was showing, as the key's "Hold opens" setting: shown by
     the details button or a row's click, hidden by the button or Esc — so Esc, Esc opens the next
     board on its list. The button is pressed in, like the pin, while the panel shows. (Remembering
     Esc was once dropped, when nothing showed the state or brought the panel back; the button
     does both now. The user's call.) */
  var withDetails = !INIT.listOnly;

  function paintDetails() {
    var b = $("details");
    b.classList.toggle("on", withDetails);
    b.setAttribute("aria-pressed", withDetails ? "true" : "false");
    b.dataset.hint = withDetails ? "Hide details" : "Show details";
  }

  function toggleDetails() {
    if (openSym) closePanel();
    else if (boardCards[cursor]) panelTo(boardCards[cursor].symbol);
  }

  /* Saved only when it changes, so stepping through rows with the panel out costs nothing. */
  function rememberPanel(on) {
    if (on === withDetails) return;
    withDetails = on;
    paintDetails();
    post("boardOpens", { details: on });
  }

  function paintPin() {
    var b = $("pin");
    b.classList.toggle("on", pinned);
    b.setAttribute("aria-pressed", pinned ? "true" : "false");
    b.dataset.hint = pinned ? "Pinned: stays open until you close it" : "Keep this window open";
  }
  function togglePin() {
    if (mode === "search") return;
    pinned = !pinned;
    paintPin();
    post("pin", { on: pinned }).then(function (reply) {
      if (reply && typeof reply.pinned === "boolean" && reply.pinned !== pinned) { pinned = reply.pinned; paintPin(); }
    });
  }

  /* Lucide rotate-cw (ISC). */
  function refreshIcon() {
    var svg = svgEl("svg", { viewBox: "0 0 24 24", width: 15, height: 15, fill: "none", stroke: "currentColor",
      "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
    svg.append(svgEl("path", { d: "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" }), svgEl("path", { d: "M21 3v5h-5" }));
    return svg;
  }

  /* Lucide pin (ISC), as Quick Clips' "keep this window open". */
  function pinIcon() {
    var svg = svgEl("svg", { viewBox: "0 0 24 24", width: 15, height: 15, fill: "none", stroke: "currentColor",
      "stroke-width": 1.8, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
    svg.append(svgEl("path", { d: "M12 17v5" }), svgEl("path", { d: "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" }));
    return svg;
  }

  function boardFooter() {
    return [["↑↓", "move"], ["⌥↑↓", "reorder"], ["↵", "open"], ["c", "% / $"], ["1–6", "range"], ["a", "add"], ["esc", "close"]];
  }

  /* ---- news ---- */

  /* Bumped on every open and close, so a reply for a popover since closed, or for a symbol since
     stepped past, is dropped. */
  var newsSeq = 0;

  function toggleNews() {
    var pop = $("news-sheet");
    if (!pop.hidden) { closeNews(); return; }
    closeAdd();
    var seq = ++newsSeq;
    pop.replaceChildren(el("div", "news-note", "Loading…"));
    var b = $("d-news").getBoundingClientRect();
    pop.style.top = (b.bottom + 9) + "px";
    pop.style.right = Math.max(8, window.innerWidth - b.right) + "px";
    pop.style.setProperty("--arrow", Math.max(8, b.width / 2 - 7) + "px");
    pop.hidden = false;
    $("d-news").classList.add("on");
    $("d-news").setAttribute("aria-expanded", "true");
    fit();
    post("news").then(function (reply) {
      if (seq !== newsSeq) return;
      var items = (reply && reply.news) || [];
      pop.replaceChildren();
      items.forEach(function (n) {
        var item = el("button", "news-item");
        var thumb = el("span", "news-thumb", (n.publisher || n.title).charAt(0).toUpperCase());
        if (n.thumb) {
          var img = el("img");
          img.alt = "";
          img.hidden = true;
          img.onload = function () { img.hidden = false; };
          img.src = n.thumb + "&t=" + encodeURIComponent(TOKEN);
          thumb.append(img);
        }
        var text = el("span", "news-text");
        text.append(el("div", "t", n.title), el("div", "w", [n.publisher, ago(n.publishedAt)].filter(Boolean).join(" · ")));
        item.append(thumb, text);
        /* The plugin opens it only if it is a link it just sent. */
        item.addEventListener("click", function () { post("openLink", { url: n.url }); closeNews(); });
        pop.append(item);
      });
      if (!items.length) pop.append(el("div", "news-note", (reply && reply.message) || "No recent news."));
      fit();
    }, function () {
      if (seq === newsSeq) pop.replaceChildren(el("div", "news-note", "News is unavailable right now."));
    });
  }

  function closeNews() {
    newsSeq++;
    if ($("news-sheet").hidden) return;
    $("news-sheet").hidden = true;
    $("d-news").classList.remove("on");
    $("d-news").setAttribute("aria-expanded", "false");
    fit();
  }

  document.addEventListener("pointerdown", function (e) {
    if ($("news-sheet").hidden) return;
    if ($("news-sheet").contains(e.target) || $("d-news").contains(e.target)) return;
    closeNews();
  });

  /* "4m ago", "3h ago", "2d ago": a headline's age. */
  function ago(ms) {
    var m = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (m < 60) return m + "m ago";
    if (m < 48 * 60) return Math.round(m / 60) + "h ago";
    return Math.round(m / 1440) + "d ago";
  }

  /* ---- board ---- */

  /*
   * A watchlist's rows, and beside them the detail view as a panel for one of them — the same view
   * a Ticker's window shows, so the chart, its ranges and hover work exactly as they do there. Rows
   * are kept by symbol and updated in place, so the minute's refresh does not rebuild the list
   * under the pointer.
   */
  var boardCards = [];
  var boardOnKey = "";
  /* The key's "Change as": the pills follow it, and a click on any pill switches it for all. */
  var changeAs = "percent";
  var openSym = "";
  var cursor = 0;
  var rowEls = {};
  var boardOrder = "";
  var firstBoard = true;
  var boardMax = ${WATCHLIST_MAX};

  function loadBoard() {
    return post("board").then(function (reply) {
      if (mode !== "board") return;
      boardCards = (reply && reply.cards) || [];
      boardOnKey = (reply && reply.onKey) || "";
      if (reply && reply.changeAs) changeAs = reply.changeAs;
      boardMax = (reply && reply.max) || ${WATCHLIST_MAX};
      $("chip").textContent = "Watchlist · " + boardCards.length + " of " + boardMax;
      /* The panel opens on the symbol the key is showing — what you were just looking at — unless
         the board opened to add, or the key is set to open on the list alone. The cursor starts
         on the key's row either way. */
      if (firstBoard) {
        firstBoard = false;
        cursor = Math.max(0, boardCards.findIndex(function (c) { return c.symbol === boardOnKey; }));
        renderBoard();
        if (INIT.openAdd) setTimeout(function () { toggleAdd(true, "add"); }, 0);
        else if (boardCards[cursor] && !INIT.listOnly) panelTo(boardCards[cursor].symbol);
        return;
      }
      renderBoard();
    }).catch(function () {
      if (mode === "board") $("cards").replaceChildren(el("p", "board-empty", "The plugin is not responding."));
    });
  }

  function sparkSvg(c) {
    var W = 56, H = 26;
    var svg = svgEl("svg", { class: "wspark", width: W, height: H, viewBox: "0 0 " + W + " " + H, "aria-hidden": "true" });
    if (!c.points || c.points.length < 2) return svg;
    var values = c.prevClose != null ? c.points.concat([c.prevClose]) : c.points;
    var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values), span = hi - lo || 1;
    var y = function (v) { return 2 + (1 - (v - lo) / span) * (H - 4); };
    var colour = c.trend === "down" ? "#ef4b4b" : c.trend === "up" ? "#29bd50" : "#8b8b93";
    if (c.prevClose != null) svg.append(svgEl("line", { x1: 0, x2: W, y1: y(c.prevClose), y2: y(c.prevClose), stroke: "#4a4a4a", "stroke-dasharray": "2 3" }));
    var pts = c.points.map(function (v, i) { return (i / (c.points.length - 1) * W).toFixed(1) + "," + y(v).toFixed(1); }).join(" ");
    svg.append(svgEl("polyline", { points: pts, fill: "none", stroke: colour, "stroke-width": 1.5, "stroke-linejoin": "round" }));
    return svg;
  }

  /* The closed row's line: mark, symbol and name, the day's line, price, move. */
  function fillHead(head, c) {
    var who = el("div", "wwho");
    var sym = el("div", "wsym", c.symbol);
    if (c.symbol === boardOnKey && boardCards.length > 1) sym.append(el("span", "onkey", "ON KEY"));
    who.append(sym);
    if (c.name && c.name !== c.symbol) who.append(el("div", "wname", c.name));
    var mark = el("div", "wmark", initialOf(c.name, c.symbol));
    var src = c.logo ? c.logo + "&t=" + encodeURIComponent(TOKEN) : "";
    /* The refresh rebuilds the row's line; keep a logo already showing rather than reload it. */
    var prev = head.querySelector(".wmark img");
    if (src && prev && prev.getAttribute("src") === src && !prev.hidden) {
      mark.append(prev);
    } else if (src) {
      var img = document.createElement("img");
      img.alt = "";
      img.hidden = true;
      img.onload = function () { img.hidden = false; };
      img.onerror = function () { img.remove(); };
      img.src = src;
      mark.append(img);
    }
    var parts = [mark, who];
    if (c.error) {
      parts.push(el("div", "werr", c.error));
    } else {
      var price = el("div", "wprice", c.price);
      if (c.currency) price.append(el("span", "unit", c.currency));
      var pill = el("div", "wmove " + c.trend, changeAs === "amount" ? (c.changeAmount || c.change || "") : (c.changePct || c.change || ""));
      pill.dataset.hint = changeAs === "amount" ? "Show as %" : "Show as amount";
      pill.setAttribute("role", "button");
      pill.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      pill.addEventListener("click", function (e) { e.stopPropagation(); toggleChangeAs(); });
      parts.push(sparkSvg(c), price, pill);
    }
    head.replaceChildren.apply(head, parts);
  }

  function renderBoard() {
    var list = $("cards");
    var order = boardCards.map(function (c) { return c.symbol; }).join(",");
    if (!boardCards.length) {
      rowEls = {};
      boardOrder = "";
      closePanel();
      list.replaceChildren(el("p", "board-empty", "No symbols yet. Add some to fill the board."));
      fit();
      return;
    }
    /* Same symbols in the same order: refresh each row's line in place. */
    if (order === boardOrder) {
      boardCards.forEach(function (c) { fillHead(rowEls[c.symbol].head, c); });
      markCursor();
      return;
    }
    boardOrder = order;
    rowEls = {};
    list.replaceChildren();
    boardCards.forEach(function (c) {
      var row = el("div", "wrow");
      var head = el("div", "whead");
      head.setAttribute("role", "button");
      /* By symbol, not by the card object: a refresh replaces the objects but keeps the row. */
      var at = function () { return boardCards.findIndex(function (x) { return x.symbol === c.symbol; }); };
      head.addEventListener("pointerdown", function (e) { var i = at(); if (i >= 0) beginDrag(e, i); });
      head.addEventListener("click", function () {
        if (swallowClick) return;
        var i = at();
        if (i < 0) return;
        cursor = i;
        panelTo(c.symbol);
      });
      fillHead(head, c);
      row.append(head);
      list.append(row);
      rowEls[c.symbol] = { row: row, head: head };
    });
    if (boardCards.length < boardMax) {
      var slot = el("div", "wslot");
      slot.setAttribute("role", "button");
      slot.append(el("b", "", "+"), "Add symbol");
      slot.addEventListener("click", function (e) { e.stopPropagation(); toggleAdd(true, "add"); });
      list.append(slot);
    }
    /* The symbol in the panel went (removed elsewhere): show the one now in its place. */
    if (openSym && !rowEls[openSym]) {
      var next = boardCards[Math.min(cursor, boardCards.length - 1)];
      panelTo(next.symbol);
    }
    if (cursor >= boardCards.length) cursor = boardCards.length - 1;
    markCursor();
    fit();
  }

  function markCursor() {
    boardCards.forEach(function (c, i) {
      var r = rowEls[c.symbol];
      if (!r) return;
      r.row.classList.toggle("cursor", i === cursor);
      r.row.classList.toggle("sel", c.symbol === openSym);
      r.head.setAttribute("aria-current", String(c.symbol === openSym));
    });
  }

  /* The panel's last line: the source, quiet, then what can be done with this symbol. */
  function panelActions() {
    var acts = $("wacts");
    if (!acts) {
      acts = el("div", "wacts");
      acts.id = "wacts";
      acts.append($("d-meta"));
      var onKey = el("button", "", "Show on key");
      onKey.id = "w-onkey";
      onKey.addEventListener("click", function () {
        var sym = openSym;
        post("showOnKey", { symbol: sym }).then(function () { boardOnKey = sym; renderBoardHeads(); onKey.hidden = true; });
      });
      var remove = el("button", "iconbtn remove");
      remove.id = "w-remove";
      remove.dataset.hint = "Remove from watchlist";
      remove.append(trashIcon());
      remove.addEventListener("click", removeShown);
      acts.append(onKey, remove);
      $("detail").append(acts);
    }
    $("w-onkey").hidden = openSym === boardOnKey;
    $("w-remove").setAttribute("aria-label", "Remove " + openSym);
  }

  /* Removing the symbol on show moves the panel to the one that takes its place, so a tidy-up is
     a run of clicks on one button. */
  function removeShown() {
    var sym = openSym;
    var at = boardCards.findIndex(function (c) { return c.symbol === sym; });
    post("remove", { symbol: sym }).then(function () {
      var rest = boardCards.filter(function (c) { return c.symbol !== sym; });
      if (rest.length) { cursor = Math.min(at, rest.length - 1); panelTo(rest[cursor].symbol); }
      loadBoard();
    });
  }

  /* Lucide chevron-left (ISC). */
  function chevronLeftIcon() {
    var svg = svgEl("svg", { viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", stroke: "currentColor",
      "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
    svg.append(svgEl("path", { d: "m15 18-6-6 6-6" }));
    return svg;
  }

  /* Lucide arrow-left-right (ISC): swap this symbol for another. */
  function swapIcon() {
    var svg = svgEl("svg", { viewBox: "0 0 24 24", width: 15, height: 15, fill: "none", stroke: "currentColor",
      "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
    svg.append(svgEl("path", { d: "M8 3 4 7l4 4" }), svgEl("path", { d: "M4 7h16" }), svgEl("path", { d: "m16 21 4-4-4-4" }), svgEl("path", { d: "M20 17H4" }));
    return svg;
  }

  /* Lucide plus (ISC). */
  function plusIcon() {
    var svg = svgEl("svg", { viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", stroke: "currentColor",
      "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
    svg.append(svgEl("path", { d: "M12 5v14M5 12h14" }));
    return svg;
  }

  /* Lucide trash-2 (ISC), the icon Timekeeper's Remove uses; built as elements, not markup. */
  function trashIcon() {
    var svg = svgEl("svg", { viewBox: "0 0 24 24", width: 14, height: 14, fill: "none", stroke: "currentColor",
      "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
    svg.append(
      svgEl("path", { d: "M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }),
      svgEl("path", { d: "M10 11v6M14 11v6" })
    );
    return svg;
  }

  function toggleChangeAs() {
    changeAs = changeAs === "amount" ? "percent" : "amount";
    renderBoardHeads();
    post("changeAs", { value: changeAs });
  }

  function renderBoardHeads() {
    boardCards.forEach(function (c) { if (rowEls[c.symbol]) fillHead(rowEls[c.symbol].head, c); });
  }

  /* Shows the panel for whatever is in it: the list narrows to its own width beside it. */
  function showPanel() {
    $("split").classList.add("side");
    $("detail").classList.add("side");
    $("detail").hidden = false;
  }

  /*
   * Puts a symbol in the panel, opening it if it was closed. Stepping quickly through the list
   * sends a focus per step; only the last one's figures are drawn (loadDetail checks the symbol).
   */
  function panelTo(sym) {
    var card = boardCards.find(function (c) { return c.symbol === sym; });
    if (!card) return;
    var wasOpen = !!openSym;
    if (sym === openSym && wasOpen) return;
    openSym = sym;
    symbol = sym;
    rangeCharts = {};
    chart1d = null;
    drawnKey = "";
    /* Clear the last symbol's figures so they never show under this one's name. */
    $("d-name").textContent = sym;
    $("d-company").textContent = "";
    $("d-price").textContent = "";
    $("d-ccy").textContent = "";
    $("d-move").replaceChildren();
    $("d-mono").textContent = initialOf(card.name, sym);
    $("d-logo").hidden = true;
    $("d-web").hidden = true;
    $("d-news").hidden = true;
    closeNews();
    $("d-rows").replaceChildren();
    $("d-meta").textContent = "";
    chartNotice(card.error ? card.error : "Loading…");
    showPanel();
    rememberPanel(true);
    panelActions();
    markCursor();
    fit();
    post("focus", { symbol: sym }).then(function (reply) {
      if (!reply || !reply.ok || openSym !== sym || mode !== "board") return;
      if (range !== "1d") selectRange(range);
      loadDetail();
    });
  }

  /*
   * Closes the panel for this visit; the window narrows back to the list. Not remembered: the board
   * always opens on the key's symbol, and remembering a close (Esc closes the panel before the
   * window) left keys opening without it.
   */
  /* The window's animated narrowing, with a margin: the panel is drawn until it is over. */
  var PANEL_SLIDE_MS = 350;

  function closePanel() {
    if (!openSym) return;
    openSym = "";
    closeNews();
    rememberPanel(false);
    markCursor();
    fit();
    /* Still drawn while the window narrows over it, so it slides away rather than vanishing and
       leaving an empty strip to close. Reopened in the meantime, it stays. */
    setTimeout(function () {
      if (openSym) return;
      $("split").classList.remove("side");
      $("detail").classList.remove("side");
      $("detail").hidden = true;
    }, PANEL_SLIDE_MS);
  }

  /* ---- adding, in a popover over the board ---- */

  var addResults = [];
  var addSel = 0;
  var addSeq = 0;
  var addTimer = 0;

  function addOpen() { return !$("add-sheet").hidden; }

  /* One popover, two jobs: on a board it adds and stays open; on a Ticker or Alert it changes the
     symbol and closes. Hung from whichever button opened it. */
  var popAnchor = "add";
  function popChanging() { return popAnchor === "change"; }

  function toggleAdd(forceOpen, anchor) {
    var pop = $("add-sheet");
    var opening = forceOpen || pop.hidden;
    if (anchor) popAnchor = anchor;
    if (opening) closeNews();
    pop.hidden = !opening;
    $(popAnchor).classList.toggle("on", opening);
    if (opening) {
      $("pop-title").textContent = popChanging() ? "Change symbol" : "Add symbol";
      /* Hang it from its button, the arrow pointing at the middle of it. */
      var b = $(popAnchor).getBoundingClientRect();
      pop.style.top = (b.bottom + 9) + "px";
      pop.style.right = Math.max(8, window.innerWidth - b.right) + "px";
      pop.style.setProperty("--arrow", Math.max(8, b.width / 2 - 7) + "px");
      $("add-note").textContent = "";
      $("add-note").className = "pop-note";
      var q = $("add-q");
      q.value = "";
      addResults = [];
      renderAddResults();
      q.focus();
    }
    fit();
  }

  function closeAdd() { if (addOpen()) toggleAdd(false); }

  function runAddSearch() {
    var q = $("add-q").value.trim();
    var seq = ++addSeq;
    if (!q) { addResults = []; renderAddResults(); return; }
    post("search", { query: q }).then(function (reply) {
      if (seq !== addSeq) return;
      addResults = ((reply && reply.results) || []).slice(0, 8);
      addSel = 0;
      renderAddResults(reply && reply.message);
    });
  }

  function renderAddResults(message) {
    var list = $("add-results");
    list.replaceChildren();
    addResults.forEach(function (r, i) {
      var li = el("li", "pop-result" + (i === addSel ? " on" : ""));
      li.setAttribute("role", "option");
      li.append(el("span", "s", r.symbol), el("span", "n", r.name), el("span", "x", [r.typeLabel || r.type, r.exchange].filter(Boolean).join(" · ")));
      li.addEventListener("click", function () { addPick(i); });
      list.append(li);
    });
    if (message) { $("add-note").textContent = message; $("add-note").className = "pop-note bad"; }
    fit();
  }

  function addPick(i) {
    var r = addResults[i];
    if (!r) return;
    post("select", { symbol: r.symbol }).then(function (reply) {
      var note = $("add-note");
      if (!reply || !reply.ok) {
        note.textContent = (reply && reply.message) || "Could not add that.";
        note.className = "pop-note bad";
        return;
      }
      /* Changing: the window follows the new symbol, and the popover's job is done. */
      if (popChanging()) {
        closeAdd();
        symbol = r.symbol;
        rangeCharts = {};
        chart1d = null;
        drawnKey = "";
        show("detail");
        return;
      }
      note.textContent = reply.message || ("Added " + r.symbol);
      note.className = "pop-note good";
      $("add-q").value = "";
      addResults = [];
      renderAddResults();
      $("add-q").focus();
      loadBoard();
    });
  }

  $("add-q").addEventListener("input", function () {
    clearTimeout(addTimer);
    addTimer = setTimeout(runAddSearch, 250);
  });
  /* The popover's keys are its own: the board's shortcuts stay out of the search box. */
  $("add-q").addEventListener("keydown", function (e) {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); closeAdd(); return; }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && addResults.length) {
      e.preventDefault();
      addSel = (addSel + (e.key === "ArrowDown" ? 1 : addResults.length - 1)) % addResults.length;
      renderAddResults();
    } else if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(addTimer);
      addPick(addSel);
    }
  });
  /* A click anywhere else closes it, as a macOS popover does. */
  document.addEventListener("pointerdown", function (e) {
    if (!addOpen()) return;
    if ($("add-sheet").contains(e.target) || $(popAnchor).contains(e.target)) return;
    closeAdd();
  });

  /* ---- reordering: drag a row, or ⌥↑ / ⌥↓ on the highlighted one ---- */

  var DRAG_THRESHOLD = 5;
  var drag = null;
  /* A press that became a drag must not also count as the click that opens the row. */
  var swallowClick = false;

  function rowList() { return boardCards.map(function (c) { return rowEls[c.symbol].row; }); }

  function beginDrag(e, i) {
    if (e.button !== 0 || boardCards.length < 2) return;
    drag = { from: i, target: i, startY: e.clientY, lastY: e.clientY, active: false, row: rowEls[boardCards[i].symbol].row };
  }

  /* Where row i sits if the dragged row lands on target: everything between shifts one slot. */
  function slotFor(i, target) {
    if (target > drag.from && i > drag.from && i <= target) return i - 1;
    if (target < drag.from && i >= target && i < drag.from) return i + 1;
    return i;
  }

  function dragUpdate() {
    var dy = drag.lastY - drag.startY;
    var y = drag.slots[drag.from] + dy, best = drag.from, bestDistance = Infinity;
    drag.slots.forEach(function (slot, i) {
      var d = Math.abs(slot - y);
      if (d < bestDistance) { bestDistance = d; best = i; }
    });
    drag.target = best;
    rowList().forEach(function (r, i) {
      if (i === drag.from) { r.style.transform = "translateY(" + dy + "px)"; return; }
      var shift = drag.slots[slotFor(i, best)] - drag.slots[i];
      r.style.transform = shift ? "translateY(" + shift + "px)" : "";
    });
  }

  document.addEventListener("pointermove", function (e) {
    if (!drag) return;
    drag.lastY = e.clientY;
    if (!drag.active) {
      if (Math.abs(e.clientY - drag.startY) < DRAG_THRESHOLD) return;
      drag.active = true;
      drag.slots = rowList().map(function (r) { var b = r.getBoundingClientRect(); return b.top + b.height / 2; });
      drag.row.classList.add("lifted");
      document.body.classList.add("dragging-row");
    }
    dragUpdate();
  });

  document.addEventListener("pointerup", function () {
    if (!drag) return;
    var finished = drag;
    drag = null;
    document.body.classList.remove("dragging-row");
    if (!finished.active) return;
    swallowClick = true;
    setTimeout(function () { swallowClick = false; }, 0);
    var settled = false, row = finished.row;
    function land() {
      if (settled) return;
      settled = true;
      rowList().forEach(function (r) { r.style.transform = ""; r.classList.remove("lifted", "settling"); });
      if (finished.target !== finished.from) moveRow(finished.from, finished.target);
    }
    row.classList.add("settling");
    row.style.transform = "translateY(" + (finished.slots[finished.target] - finished.slots[finished.from]) + "px)";
    row.addEventListener("transitionend", land, { once: true });
    setTimeout(land, 240);
  });

  /* Applies a move at once, so the board does not wait on the plugin, then saves it. */
  function moveRow(from, to) {
    var moving = boardCards.splice(from, 1)[0];
    boardCards.splice(to, 0, moving);
    cursor = to;
    renderBoard();
    post("reorder", { symbols: boardCards.map(function (c) { return c.symbol; }) }).then(function (reply) {
      if (!reply || !reply.ok) loadBoard();
    });
  }

  /* ---- detail ---- */

  function loadDetail(force) {
    var forSym = openSym;
    return post("snapshot", { force: force === true }).then(function (reply) {
      if (mode !== "detail" && !(mode === "board" && openSym)) return;
      /* A step through the board moved on while this was on its way. */
      if (mode === "board" && openSym !== forSym) return;
      if (reply && reply.detail) { renderDetail(reply.detail); loadAlert(); }
      else showDetailError((reply && reply.message) || "No quote available.");
    }).catch(function () { showDetailError("The plugin is not responding."); });
  }

  /* "Apple Inc." → "A", "S&P/TSX Composite index" → "S", "^GSPTSE" → "G". */
  function initialOf(name, sym) {
    var m = String(name || sym || "").match(/[A-Za-z0-9]/);
    return m ? m[0].toUpperCase() : "·";
  }

  function showDetailError(message) {
    /* In the panel, say it where the chart would be, and keep the board. */
    if (mode === "board") { chartNotice(message); return; }
    $("detail").hidden = true;
    var box = $("d-error");
    box.hidden = false;
    box.textContent = message;
    fit();
  }

  function renderDetail(d) {
    $("d-error").hidden = true;
    /* On a board the detail view is the panel, shown only while it has a symbol. */
    $("detail").hidden = mode === "board" && !openSym;
    symbol = d.symbol;
    if (!onBoard) {
      $("chip").textContent = d.exchange ? d.symbol + " · " + d.exchange : d.symbol;
      document.title = INIT.windowTitle.split(" — ")[0] + " — " + d.symbol;
    }
    $("d-name").textContent = d.name;
    $("d-price").textContent = d.price;
    $("d-ccy").textContent = d.currency || "";
    today = d;
    renderMove();
    chart1d = d.chart || null;
    if (range === "1d") renderChart(chart1d);

    var rows = $("d-rows");
    rows.replaceChildren();
    /* Four across only when there are enough figures to fill it. */
    rows.className = d.rows.length <= ROOMY_MAX ? "stats roomy" : "stats";
    d.rows.forEach(function (r) {
      var item = el("div", "stat");
      var label = el("dt", "", r.label);
      if (r.hint) label.dataset.explain = r.hint;
      item.append(label, el("dd", "", r.value));
      rows.append(item);
    });

    /* The initial sits under the logo, so a logo that fails or is slow still leaves a mark. */
    $("d-mono").textContent = initialOf(d.name, d.symbol);
    var logo = $("d-logo");
    /* A local address from the plugin's cache; the token gates it like every other route. */
    var logoSrc = d.logo ? d.logo + "&t=" + encodeURIComponent(TOKEN) : "";
    if (logoSrc && logo.getAttribute("src") !== logoSrc) { logo.hidden = true; logo.setAttribute("src", logoSrc); }
    if (!d.logo) { logo.hidden = true; logo.removeAttribute("src"); }
    logo.onload = function () { logo.hidden = false; };
    logo.onerror = function () { logo.hidden = true; };
    website = d.website || "";
    $("d-company").textContent = d.company ? "· " + d.company : "";
    /* In a board's panel the symbol leads, as it does in the list beside it; the name follows. */
    if (onBoard) {
      $("d-name").textContent = d.symbol;
      $("d-company").textContent = [d.name !== d.symbol ? d.name : "", d.company || ""].filter(Boolean).join(" · ");
    }
    $("d-web").hidden = !website;
    $("d-news").hidden = false;

    var note = $("d-note");
    note.hidden = !d.note;
    note.textContent = d.note || "";

    var when = d.marketTime ? new Date(d.marketTime) : null;
    var meta = "Source: " + d.source;
    if (when) meta += " · last trade " + when.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    meta += " · updated " + new Date(d.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    $("d-meta").textContent = meta;
    fit();
  }

  var NS = "http://www.w3.org/2000/svg";
  /* An SF Symbol from sf-symbols.ts, filled, on its own ink box: \`height\` sets the size. */
  function sfIcon(name, height) {
    var s = SF[name], w = Number(s.viewBox.split(" ")[2]);
    var svg = svgEl("svg", { viewBox: s.viewBox, height: height, width: (height * w / 24).toFixed(2), fill: "currentColor", "aria-hidden": "true" });
    svg.append(svgEl("path", { d: s.d }));
    return svg;
  }

  function svgEl(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach(function (k) { e.setAttribute(k, String(attrs[k])); });
    return e;
  }

  var ROOMY_MAX = 6;
  var RANGE_NAMES = { "1d": "today", "5d": "past 5 days", "1mo": "past month", "6mo": "past 6 months", ytd: "year to date", "1y": "past year" };

  function sameLocalDay(a, b) {
    var x = new Date(a), y = new Date(b);
    return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
  }

  /* Axis labels in this Mac's own time zone: WebKit reads the system's zone data. */
  function tickLabel(t) {
    var d = new Date(t.t);
    if (t.kind === "time") return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (t.kind === "day") return d.toLocaleDateString([], { weekday: "short" });
    if (t.kind === "date") return d.toLocaleDateString([], { month: "short", day: "numeric" });
    /* January carries the year instead, so a year-long chart reads across New Year. */
    return d.getMonth() === 0 ? String(d.getFullYear()) : d.toLocaleDateString([], { month: "short" });
  }

  function selectRange(next, force) {
    range = next;
    Array.prototype.forEach.call($("ranges").children, function (b) {
      var on = b.getAttribute("data-range") === next;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
    });
    if (next === "1d") { renderChart(chart1d); return; }
    if (rangeCharts[next]) { renderChart(rangeCharts[next]); return; }
    chartNotice("Loading…");
    var forSymbol = symbol;
    post("chart", { range: next, force: force === true }).then(function (reply) {
      if (forSymbol !== symbol) return;
      if (reply && reply.chart) rangeCharts[next] = reply.chart;
      if (range !== next) return;
      if (reply && reply.chart) renderChart(reply.chart);
      else chartNotice((reply && reply.message) || "No chart for this range.");
    }).catch(function () { if (range === next) chartNotice("The plugin is not responding."); });
  }

  /*
   * The figure under the price follows the chart: today's move on 1D, the move across the range
   * otherwise — so the number, the line's colour and the dashed line always tell one story.
   */
  function renderMove() {
    var move = $("d-move");
    var c = range === "1d" ? null : shown;
    var src = c && c.range === range ? c : today;
    if (!src) { move.textContent = ""; return; }
    move.className = "move";
    var label = src === today ? "today" : RANGE_NAMES[range];
    var figures = [src.change, src.changePct ? "(" + src.changePct + ")" : ""].join(" ").trim();
    move.replaceChildren(el("span", src.trend, figures), el("span", "move-label", label));
    var x = today && today.extended;
    if (x) {
      var ext = el("span", "move-ext");
      ext.append(el("span", "ext-label", x.label), el("span", "ext-price", x.price), el("span", x.trend, x.changePct));
      move.append(ext);
    }
  }

  function chartNotice(text) {
    shown = null;
    $("d-chart").replaceChildren(el("div", "chart-empty", text));
    $("d-axis").replaceChildren();
    $("d-yaxis").replaceChildren();
    var caption = $("chart-caption");
    caption.className = "chart-caption";
    caption.textContent = "";
  }

  function renderChart(c) {
    if (!c || c.points.length < 2) { chartNotice("No chart data"); return; }
    shown = c;
    renderMove();
    /* Animate only when what is shown changed — a new range or symbol, or the first draw —
       never when the poll redraws the same chart with a minute more data. */
    var key = symbol + "|" + c.range;
    var animate = key !== drawnKey;
    drawnKey = key;
    drawChart($("d-chart"), c, animate);
    ["d-axis", "d-yaxis"].forEach(function (id) {
      var n = $(id);
      n.classList.remove("fade");
      if (animate) { void n.offsetWidth; n.classList.add("fade"); }
    });
    if (hoverAt !== null) hover(hoverAt);

    var yaxis = $("d-yaxis");
    yaxis.replaceChildren();
    var widest = 0;
    c.yTicks.forEach(function (t) {
      var label = el("span", "ytick", t.label);
      label.style.top = ((1 - (t.v - c.yMin) / (c.yMax - c.yMin)) * 100).toFixed(2) + "%";
      yaxis.append(label);
      widest = Math.max(widest, label.offsetWidth);
    });
    /* The labels are positioned, so the column cannot size itself: fit it to the widest. */
    yaxis.style.width = Math.ceil(widest) + "px";
    /* The time axis spans the plot only: stop it where the scale's strip begins. */
    $("d-axis").style.marginRight = (yaxis.offsetWidth + 1) + "px";

    var axis = $("d-axis");
    axis.replaceChildren();
    c.ticks.forEach(function (t) {
      var label = el("span", "tick", tickLabel(t));
      label.style.left = (t.x * 100).toFixed(2) + "%";
      if (t.x < 0.02) label.classList.add("start");
      else if (t.x > 0.98) label.classList.add("end");
      axis.append(label);
    });

    var caption = $("chart-caption");
    if (c.range === "1d") {
      caption.className = "chart-caption";
      /* "Today" while the session runs or if it ended today here; otherwise the day it was —
         a 24-hour market's day can start the evening before, so judge by the end. */
      var now = Date.now();
      var end = c.sessionEnd || c.sessionStart;
      var current = !end || now <= end || sameLocalDay(end - 60000, now);
      caption.textContent = current ? "Today"
        : new Date(end - 60000).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    } else {
      /* The move over the range is under the price now; the caption says which dates it spans. */
      caption.className = "chart-caption";
      var from = new Date(c.points[0].t), to = new Date(c.points[c.points.length - 1].t);
      var opts = from.getFullYear() === to.getFullYear() ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" };
      caption.textContent = from.toLocaleDateString([], opts) + " – " + to.toLocaleDateString([], opts);
    }
  }

  /* ---- a Price Alert's rule ---- */

  var alertDirty = false;
  var alertNow = null;

  function loadAlert() {
    if (!INIT.alert) return;
    post("alert").then(function (reply) { if (reply && reply.alert) renderAlert(reply.alert); });
  }

  function fmtLevel(v) {
    return Math.abs(v) >= 1 ? v.toFixed(2) : String(Number(v.toPrecision(4)));
  }

  function renderAlert(a) {
    alertNow = a;
    var box = $("d-alert");
    box.hidden = false;
    box.classList.toggle("fired", a.phase === "fired");
    var status = $("a-status");
    status.className = "abox-status";
    status.textContent = a.status;
    $("a-clear").hidden = a.phase !== "fired";
    $("a-remove").hidden = !a.active;
    $("a-popup").checked = a.popup !== false;
    /* What someone is typing is theirs until they set it; a refresh only updates the status. */
    if (!alertDirty) {
      $("a-cond").value = a.condition;
      $("a-target").value = a.target > 0 ? fmtLevel(a.target) : "";
    }
    syncAlertForm();
    fit();
  }

  function syncAlertForm() {
    var cond = $("a-cond").value;
    var input = $("a-target");
    var priced = cond === "above" || cond === "below";
    input.hidden = cond === "high-52w" || cond === "low-52w";
    input.placeholder = priced ? "Price" : "Percent";
    $("a-set").disabled = !alertDirty;
    /* An edit not yet set says so, rather than the saved rule's status sitting beside it. */
    var status = $("a-status");
    if (alertDirty && status.className.indexOf("err") < 0) status.textContent = "Not saved yet. Press Set alert, or Return.";
    else if (!alertDirty && alertNow && status.className.indexOf("err") < 0) status.textContent = alertNow.status;
    if (shown) { drawChart($("d-chart"), shown, false); if (hoverAt !== null) hover(hoverAt); }
  }

  function targetValue() {
    var n = Number(String($("a-target").value).replace(/[,$%\\s]/g, ""));
    return isFinite(n) && n > 0 ? n : 0;
  }

  /* The target as a line on the chart, for the price conditions; past the edge, a tag at the edge. */
  function drawTargetLine(box, c) {
    var cond = $("a-cond").value;
    if (cond !== "above" && cond !== "below") return;
    var v = targetValue();
    if (!v) return;
    var f = 1 - (v - c.yMin) / ((c.yMax - c.yMin) || 1);
    var label = el("span", "aline-label", (cond === "above" ? "Rises to " : "Falls to ") + fmtLevel(v));
    if (f < 0 || f > 1) {
      label.classList.add("edge");
      label.textContent += f < 0 ? "  ↑" : "  ↓";
      label.style.top = f < 0 ? "4px" : (box.clientHeight - 20) + "px";
      box.append(label);
      return;
    }
    var line = el("div", "yguide");
    line.style.borderTop = "1.5px dashed #fab219";
    line.style.top = (f * 100).toFixed(2) + "%";
    label.style.top = (f * 100).toFixed(2) + "%";
    box.append(line, label);
  }

  /* The price at a height on the chart, rounded to what the scale can tell apart. */
  function levelAt(fy) {
    var c = shown;
    var v = c.yMax - fy * (c.yMax - c.yMin);
    var step = c.yTicks.length > 1 ? Math.abs(c.yTicks[1].v - c.yTicks[0].v) / 20 : Math.abs(v) / 1000;
    var p = Math.pow(10, Math.floor(Math.log10(step || 0.01)));
    return Math.round(v / p) * p;
  }

  /* The level under the pointer, ready to click. */
  function guide(fy) {
    var box = $("d-chart");
    var g = box.querySelector(".yguide.hover") || box.appendChild(el("div", "yguide hover"));
    g.style.top = (fy * 100).toFixed(2) + "%";
    g.replaceChildren(el("span", "", "Alert at " + fmtLevel(levelAt(fy))));
  }

  /* A picked level becomes the target: above the current price it is "rises to", below "falls to". */
  function pickLevel(v) {
    var now = shown.points[shown.points.length - 1].v;
    $("a-cond").value = v >= now ? "above" : "below";
    $("a-target").value = fmtLevel(v);
    alertDirty = true;
    syncAlertForm();
    $("a-set").focus();
  }

  function setAlert() {
    var cond = $("a-cond").value;
    var needs = cond !== "high-52w" && cond !== "low-52w";
    var t = targetValue();
    var status = $("a-status");
    if (needs && !t) {
      status.textContent = "Enter a target first, or click the chart to pick one.";
      status.className = "abox-status err";
      $("a-target").focus();
      return;
    }
    post("setAlert", { condition: cond, target: needs ? t : 0 }).then(function (reply) {
      if (reply && reply.alert) { alertDirty = false; renderAlert(reply.alert); }
      else if (reply && reply.message) { status.textContent = reply.message; status.className = "abox-status err"; }
    });
  }

  if (INIT.alert) {
    $("a-cond").addEventListener("change", function () { alertDirty = true; syncAlertForm(); });
    $("a-target").addEventListener("input", function () { alertDirty = true; syncAlertForm(); });
    $("a-target").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); setAlert(); } });
    $("a-set").addEventListener("click", setAlert);
    $("a-popup").addEventListener("change", function () {
      post("setPopup", { on: $("a-popup").checked }).then(function (reply) {
        if (reply && reply.alert) { alertNow = reply.alert; }
      });
    });
    $("a-remove").append(trashIcon());
    $("a-remove").addEventListener("click", function () {
      post("removeAlert").then(function (reply) {
        if (!reply || !reply.alert) return;
        alertDirty = false;
        renderAlert(reply.alert);
      });
    });
    $("a-clear").addEventListener("click", function () {
      post("clearAlert").then(function (reply) { if (reply && reply.alert) renderAlert(reply.alert); });
    });
  }

  /* ---- hover ---- */

  /* The bar nearest a position across the plot. Points are in x order, so a binary search. */
  function nearest(points, f) {
    var lo = 0, hi = points.length - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (points[mid].x < f) lo = mid; else hi = mid;
    }
    return f - points[lo].x <= points[hi].x - f ? points[lo] : points[hi];
  }

  function formatPrice(v) {
    return Math.abs(v) >= 1
      ? v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : v.toPrecision(4);
  }

  function readoutTime(t, r) {
    var d = new Date(t);
    var time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (r === "1d") return time;
    if (r === "5d") return d.toLocaleDateString([], { weekday: "short" }) + " " + time;
    if (r === "1mo") return d.toLocaleDateString([], { month: "short", day: "numeric" }) + ", " + time;
    return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  }

  function hover(f) {
    var box = $("d-chart");
    var c = shown;
    if (!c) return;
    var p = nearest(c.points, f);
    var w = box.clientWidth, h = box.clientHeight;
    var px = p.x * w;
    var py = (1 - (p.v - c.yMin) / (c.yMax - c.yMin || 1)) * h;
    /* The dot is part of the line, so it takes the line's colour; whether this point is above
       or below the dashed line is the readout's job, in its own green or red. */
    var colour = c.trend === "down" ? "#ef4b4b" : c.trend === "up" ? "#29bd50" : "#8b8b93";

    var line = box.querySelector(".xhair") || box.appendChild(el("div", "xhair"));
    var dot = box.querySelector(".dot") || box.appendChild(el("div", "dot"));
    var tip = box.querySelector(".readout") || box.appendChild(el("div", "readout"));
    line.style.left = px.toFixed(1) + "px";
    dot.style.left = px.toFixed(1) + "px";
    dot.style.top = py.toFixed(1) + "px";
    dot.style.background = colour;

    var meta = el("div", "readout-meta", readoutTime(p.t, c.range));
    if (c.baseline) {
      var pct = (p.v - c.baseline) / c.baseline * 100;
      meta.append(" · ", el("span", pct > 0 ? "up" : pct < 0 ? "down" : "flat", (pct > 0 ? "+" : "") + pct.toFixed(2) + "%"));
    }
    tip.replaceChildren(el("div", "readout-price", formatPrice(p.v)), meta);
    /* Beside the rule, on whichever side has room. */
    var tw = tip.offsetWidth;
    var left = px + 10 + tw > w - 4 ? px - 10 - tw : px + 10;
    tip.style.left = Math.max(4, left).toFixed(0) + "px";
  }

  function unhover() {
    hoverAt = null;
    hoverY = null;
    var box = $("d-chart");
    [".xhair", ".dot", ".readout", ".yguide.hover"].forEach(function (s) { var n = box.querySelector(s); if (n) n.remove(); });
  }

  $("d-chart").addEventListener("pointermove", function (e) {
    if (!shown) return;
    var rect = this.getBoundingClientRect();
    hoverAt = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    hoverY = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    hover(hoverAt);
    if (INIT.alert) guide(hoverY);
  });
  /* In an alert's window a click on the chart picks the price level under the pointer as the target. */
  $("d-chart").addEventListener("click", function () {
    if (!INIT.alert || !shown || hoverY === null) return;
    pickLevel(levelAt(hoverY));
  });
  $("d-chart").addEventListener("pointerleave", unhover);

  function drawChart(box, c, animate) {
    box.replaceChildren();
    var W = 600, H = 150;
    /* The plugin chose the span (with headroom) and the ticks, so labels and line agree. */
    var span = c.yMax - c.yMin || 1;
    var x = function (f) { return f * W; };
    var y = function (v) { return (1 - (v - c.yMin) / span) * H; };
    var colour = c.trend === "down" ? "#ef4b4b" : c.trend === "up" ? "#29bd50" : "#8b8b93";
    var view = { viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "none" };
    /* Two layers: the grid, which stays, and the data, which is what animates in. */
    var grid = svgEl("svg", Object.assign({ "aria-hidden": "true" }, view));
    var svg = svgEl("svg", Object.assign({ role: "img", "aria-label": "Price, " + RANGE_NAMES[c.range] }, view));
    c.yTicks.forEach(function (t) {
      grid.append(svgEl("line", { x1: 0, x2: W, y1: y(t.v), y2: y(t.v), stroke: "#3a3a3a", "stroke-width": 1, "vector-effect": "non-scaling-stroke" }));
    });
    if (c.baseline != null) grid.append(svgEl("line", { x1: 0, x2: W, y1: y(c.baseline), y2: y(c.baseline), stroke: "#515151", "stroke-dasharray": "3 4", "vector-effect": "non-scaling-stroke" }));
    var line = c.points.map(function (p) { return x(p.x).toFixed(1) + "," + y(p.v).toFixed(1); }).join(" ");
    var first = x(c.points[0].x).toFixed(1), last = x(c.points[c.points.length - 1].x).toFixed(1);
    svg.append(svgEl("polygon", { points: first + "," + H + " " + line + " " + last + "," + H, fill: colour, "fill-opacity": 0.12 }));
    svg.append(svgEl("polyline", { points: line, fill: "none", stroke: colour, "stroke-width": 2, "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" }));
    if (animate) svg.classList.add("reveal");
    box.append(grid, svg);
    if (INIT.alert) drawTargetLine(box, c);
  }

  /* ---- search ---- */

  function runSearch() {
    var q = $("q").value.trim();
    query = $("q").value;
    var seq = ++searchSeq;
    if (!q) { results = []; renderResults(); return; }
    post("search", { query: q }).then(function (reply) {
      if (seq !== searchSeq) return;
      results = (reply && reply.results) || [];
      selected = 0;
      renderResults(reply && reply.message);
    }).catch(function () {
      if (seq === searchSeq) renderResults("The plugin is not responding.");
    });
  }

  function renderResults(message) {
    var list = $("results");
    list.replaceChildren();
    results.forEach(function (r, i) {
      var li = el("li", "result" + (i === selected ? " sel" : ""));
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(i === selected));
      var main = el("div", "r-main");
      main.append(el("div", "r-sym", r.symbol), el("div", "r-name", r.name));
      var side = el("div", "r-side");
      side.append(el("span", "badge", r.typeLabel || r.type));
      if (r.exchange) side.append(el("div", "r-ex", r.exchange));
      li.append(main, side);
      li.addEventListener("click", function () { pick(i); });
      list.append(li);
    });
    var notice = $("s-notice");
    var text = message || (query.trim() && !results.length ? "No matches." : "");
    if (!query.trim()) text = "Type a company name, ticker, fund or coin.";
    notice.hidden = !text;
    notice.textContent = text;
    var current = list.children[selected];
    if (current) current.scrollIntoView({ block: "nearest" });
  }

  function pick(i) {
    var r = results[i];
    if (!r) return;
    post("select", { symbol: r.symbol }).then(function (reply) {
      if (!reply || !reply.ok) { renderResults((reply && reply.message) || "Could not set that symbol."); return; }
      /* Adding to a list: say so, clear the box, and stay for the next one. */
      if (INIT.adding) {
        $("s-added").textContent = reply.message || ("Added " + r.symbol);
        query = "";
        results = [];
        $("q").value = "";
        renderResults();
        $("q").focus();
        return;
      }
      symbol = r.symbol;
      rangeCharts = {};
      chart1d = null;
      if (openedForSearch) post("close");
      else { query = ""; show("detail"); }
    });
  }

  $("q").addEventListener("input", function () {
    clearTimeout(debounce);
    debounce = setTimeout(runSearch, 250);
  });

  $("refresh").append(refreshIcon());
  $("refresh").addEventListener("click", refreshNow);
  $("pin").append(pinIcon());
  $("pin").addEventListener("click", togglePin);
  paintPin();
  $("details").append(sfIcon("sidebar.right", 13));
  $("details").addEventListener("click", toggleDetails);
  paintDetails();
  $("change").append(swapIcon());
  $("change").addEventListener("click", function (e) { e.stopPropagation(); toggleAdd(false, "change"); });
  $("d-news").append(sfIcon("newspaper", 14));
  $("d-web").append(sfIcon("globe", 14));
  $("back").append(chevronLeftIcon());
  $("back").addEventListener("click", function () { show("board"); });
  $("add").append(plusIcon());
  $("add").addEventListener("click", function (e) { e.stopPropagation(); toggleAdd(false, "add"); });
  Array.prototype.forEach.call($("ranges").children, function (b) {
    b.addEventListener("click", function () { selectRange(b.getAttribute("data-range")); });
  });
  /* The plugin opens it only if it is the website it just sent for this symbol. */
  $("d-web").addEventListener("click", function () { if (website) post("openLink", { url: website }); });
  $("d-news").addEventListener("click", function (e) { e.stopPropagation(); toggleNews(); });

  document.addEventListener("keydown", function (e) {
    /* An open popover takes Esc first, wherever the focus is. */
    if (e.key === "Escape" && addOpen()) { e.preventDefault(); closeAdd(); return; }
    if (e.key === "Escape" && !$("news-sheet").hidden) { e.preventDefault(); closeNews(); return; }
    /* Typing in the alert's form is typing: no single-key shortcuts while a field has the keys. */
    var t = e.target;
    var typing = t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA") && t.id !== "q";
    if (typing && e.key !== "Escape") return;
    if (e.key === "Escape" && typing) { t.blur(); e.preventDefault(); return; }
    if (e.key === "Escape") {
      e.preventDefault();
      if (onBoard && mode === "board" && openSym) closePanel();
      else if (onBoard && mode !== "board") show("board");
      else if (mode === "search" && !openedForSearch) show("detail");
      else post("close");
      return;
    }
    if (mode === "search") {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!results.length) return;
        selected = (selected + (e.key === "ArrowDown" ? 1 : results.length - 1)) % results.length;
        renderResults();
      } else if (e.key === "Enter") {
        e.preventDefault();
        clearTimeout(debounce);
        pick(selected);
      }
      return;
    }
    if (mode === "board" && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && boardCards.length > 1) {
      e.preventDefault();
      var to = cursor + (e.key === "ArrowDown" ? 1 : -1);
      if (to >= 0 && to < boardCards.length) moveRow(cursor, to);
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (mode === "board") {
      if (e.key === "a") { e.preventDefault(); toggleAdd(true, "add"); }
      if (e.key === "c") { e.preventDefault(); toggleChangeAs(); }
      if (e.key === "r") refreshNow();
      if (e.key === "p") togglePin();
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && boardCards.length) {
        e.preventDefault();
        cursor = (cursor + (e.key === "ArrowDown" ? 1 : boardCards.length - 1)) % boardCards.length;
        /* With the panel out, the arrows step it through the list; without, they move the cursor. */
        if (openSym) panelTo(boardCards[cursor].symbol);
        markCursor();
      }
      if (e.key === "Enter" && boardCards[cursor]) { e.preventDefault(); panelTo(boardCards[cursor].symbol); }
      var d = ["1", "2", "3", "4", "5", "6"].indexOf(e.key);
      if (d >= 0 && openSym) selectRange(["1d", "5d", "1mo", "6mo", "ytd", "1y"][d]);
      return;
    }
    if (e.key === "r") refreshNow();
    if (e.key === "p") togglePin();
    var digit = ["1", "2", "3", "4", "5", "6"].indexOf(e.key);
    if (digit >= 0) selectRange(["1d", "5d", "1mo", "6mo", "ytd", "1y"][digit]);
    if (e.key === "s" && INIT.canChange !== false && mode === "detail") { e.preventDefault(); toggleAdd(true, "change"); }
  });

  /* The browser fallback ignores --window-size when Chrome is already running. */
  if (!window.__nativeHost) {
    try { window.resizeTo(${WINDOW_WIDTH} + (outerWidth - innerWidth), ${WINDOW_HEIGHT} + (outerHeight - innerHeight)); } catch (e) { /* not allowed */ }
  }

  document.documentElement.classList.add("ready");
  show(mode);
})();
</script>
<script>${TIP_SCRIPT}</script>
</body>
</html>`;
}
