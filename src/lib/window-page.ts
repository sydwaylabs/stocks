import { TIP_CSS, TIP_SCRIPT } from "./page-tip.js";

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
};

export const WINDOW_WIDTH = 640;
export const WINDOW_HEIGHT = 630;

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
.name-row .spacer { flex: 1; }
.link { background: none; border: none; padding: 0; color: var(--series); font-size: 12px; }
.link:hover { text-decoration: underline; }
.price-row { display: flex; align-items: baseline; gap: 10px; }
.price { font-size: 32px; font-weight: 650; font-variant-numeric: tabular-nums; }
.ccy { color: var(--fg-dim); font-size: 13px; }
/* Only the figures carry the up/down colour; the period beside them is a plain label. */
.move { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
.move-label { color: var(--fg-dim); font-weight: 400; margin-left: 4px; }
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
/* A label that explains itself on hover says so with a faint dotted underline. */
.stat dt[data-hint] { text-decoration: underline dotted rgba(255,255,255,.28); text-underline-offset: 3px; cursor: help; }
.stat dd { margin: 0; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta { color: var(--fg-faint); font-size: 11px; margin-top: 10px; }
.note { color: var(--slow); font-size: 12px; margin-top: 8px; }
.notice { color: var(--fg-dim); padding: 30px 10px; text-align: center; }
.added { color: var(--good); font-size: 12px; margin: 8px 2px 0; min-height: 16px; }

/* board: a watchlist as rows, one opening in place to the full chart and stats — so the other
   symbols stay in view and comparing is moving down the list, not going in and out of a page. */
.wl { display: flex; flex-direction: column; gap: 6px; }
.wrow { position: relative; background: var(--card); border: 1px solid var(--card-line); border-radius: 10px;
  transition: border-color .1s ease, transform 140ms ease; }
/* Dragging, after Timekeeper's cards: the row lifts and follows the pointer, the others slide aside. */
.wrow.lifted { transition: none; z-index: 3; box-shadow: var(--shadow-lift, 0 6px 18px rgba(0,0,0,.45)); border-color: #6a6a70; }
.wrow.lifted.settling { transition: transform 150ms cubic-bezier(.2, .7, .3, 1); }
body.dragging-row, body.dragging-row * { cursor: grabbing !important; user-select: none; }
.wrow:hover, .wrow.cursor { border-color: #6a6a70; }
.wrow.open { border-color: #6a6a70; }
.whead { display: grid; grid-template-columns: 30px minmax(0, 1fr) 76px 104px 92px; align-items: center; column-gap: 12px;
  height: 46px; padding: 0 12px; cursor: pointer; }
.wmark { position: relative; width: 30px; height: 30px; border-radius: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(160deg, #4a4a50, #2c2c30); font-size: 14px; font-weight: 700; color: var(--fg);
  box-shadow: 0 0 0 1px rgba(255,255,255,.08) inset; }
/* The logo over the initial, so a slow or failed image still leaves a mark — as the large tile does. */
.wmark img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.wwho { min-width: 0; display: flex; flex-direction: column; justify-content: center; line-height: 16px; }
.wsym { font-size: 13.5px; font-weight: 600; white-space: nowrap; display: flex; align-items: center; gap: 6px; }
.wname { font-size: 11.5px; color: var(--fg-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* Which row the key is showing: a fact, in white, beside the symbol — not the up-green. */
.onkey { flex: none; font-size: 9px; font-weight: 600; color: var(--fg); background: var(--kbd); border-radius: 4px; padding: 1px 5px; letter-spacing: .03em; }
.wspark { display: block; }
.wprice { text-align: right; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wprice .unit { font-size: 10.5px; font-weight: 500; color: var(--fg-dim); margin-left: 3px; }
/* The move as a pill, coloured by direction — the one place colour sits in a closed row. */
.wmove { justify-self: end; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; padding: 3px 8px; border-radius: 6px; background: var(--kbd); white-space: nowrap; }
.wmove.up { background: rgba(41,189,80,.16); }
.wmove.down { background: rgba(239,75,75,.16); }
/* Clicking a pill switches every row between % and the amount, as Stocks on iPhone does. */
.wmove { cursor: pointer; border: 1px solid transparent; position: relative; }
.wmove:hover { border-color: rgba(255,255,255,.18); }

.werr { grid-column: 3 / -1; justify-self: end; color: var(--slow); font-size: 12.5px; }
.wpanel { padding: 2px 12px 12px; border-top: 1px solid var(--line); }
.wpanel .chart-head { margin-top: 10px; }
.wacts { display: flex; gap: 8px; justify-content: flex-end; align-items: center; margin-top: 10px; }
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

/* In a row, the stats sit four across and label-over-value, so a full set is three short lines. */
.wpanel .stats { grid-template-columns: repeat(4, minmax(0, 1fr)); column-gap: 16px; margin-top: 10px; }
.wpanel .stat { flex-direction: column; justify-content: flex-start; gap: 1px; padding: 6px 0; }
.wpanel .stat dt { font-size: 11px; }
.wpanel .stat dd { text-align: left; font-size: 12.5px; }
/* The source line shares the row's last line with its buttons: on the left, quiet, and clipped
   rather than wrapped if a long one meets them. */
.wacts .meta { margin: 0 auto 0 0; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.board-empty { color: var(--fg-dim); text-align: center; padding: 40px 10px; }

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
  <button id="back" class="iconbtn" aria-label="Back to watchlist" data-hint="Back to watchlist" hidden></button>
  <!-- Neutral, not Timekeeper's green Add: on this screen green means a price went up. -->
  <button id="add" class="iconbtn" aria-label="Add symbol" data-hint="Add symbol" hidden></button>
  <button id="change" hidden>Change symbol…</button>
</div>

<main id="board" hidden><div class="wl" id="cards"></div></main>

<main id="detail" hidden>
  <div class="hero">
    <div class="mark" aria-hidden="true"><span class="mono" id="d-mono"></span><img id="d-logo" alt="" hidden></div>
    <div class="hero-text">
      <div class="name-row">
        <p class="name" id="d-name"></p>
        <span class="company" id="d-company"></span>
        <span class="spacer"></span>
        <button class="link" id="d-web" hidden>Website</button>
      </div>
      <div class="price-row"><span class="price" id="d-price"></span><span class="ccy" id="d-ccy"></span></div>
      <div class="move" id="d-move"></div>
    </div>
  </div>
  <!-- The chart, stats and source line. On a watchlist board this whole block moves into the
       open row; elsewhere it stays here under the price. -->
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
      if (mode === "detail" || mode === "board") {
        var view = mode === "board" ? $("board") : $("detail").hidden ? $("d-error") : $("detail");
        view.style.flex = "none";
        height = $("bar").offsetHeight + view.scrollHeight + $("footer").offsetHeight;
        view.style.flex = "";
      }
      if (window.__nativeHost) {
        try { window.webkit.messageHandlers.resize.postMessage({ height: height }); } catch (e) { /* older host */ }
      } else {
        try { window.resizeTo(outerWidth, height + (outerHeight - innerHeight)); } catch (e) { /* not allowed */ }
      }
    }, 0);
  }

  function show(next) {
    mode = next;
    $("detail").hidden = true;
    $("d-error").hidden = true;
    $("board").hidden = next !== "board";
    $("search").hidden = next !== "search";
    $("change").hidden = next !== "detail" || INIT.canChange === false;
    /* A board's views lead back to it; its own view offers Add. */
    $("back").hidden = !onBoard || next === "board";
    $("add").hidden = !onBoard || next !== "board";
    clearInterval(poll);
    if (next === "board") {
      setFooter([["↑↓", "move"], ["⌥↑↓", "reorder"], ["↵", "open"], ["c", "% / $"], ["1–6", "range"], ["a", "add"], ["esc", "close"]]);
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
        : [["1–6", "range"], ["r", "refresh"], ["s", "change symbol"], ["esc", "close"]]);
      loadDetail();
      poll = setInterval(loadDetail, 30000);
    }
  }

  /* ---- board ---- */

  /*
   * A watchlist's rows. One at a time opens in place: the detail view's chart, stats and source
   * line (#d-body) move into it, so the chart, its ranges and hover work exactly as they do on a
   * Ticker's window. Rows are kept by symbol and updated in place, so the minute's refresh does not
   * rebuild the open one under the pointer.
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

  function loadBoard() {
    return post("board").then(function (reply) {
      if (mode !== "board") return;
      boardCards = (reply && reply.cards) || [];
      boardOnKey = (reply && reply.onKey) || "";
      if (reply && reply.changeAs) changeAs = reply.changeAs;
      $("chip").textContent = "Watchlist · " + boardCards.length + " of " + ((reply && reply.max) || 12);
      /* Every row starts closed; the keyboard's place starts on the row the key is showing, so
         Return opens what you were just looking at. */
      if (firstBoard) {
        firstBoard = false;
        cursor = Math.max(0, boardCards.findIndex(function (c) { return c.symbol === boardOnKey; }));
      }
      renderBoard();
    }).catch(function () {
      if (mode === "board") $("cards").replaceChildren(el("p", "board-empty", "The plugin is not responding."));
    });
  }

  function sparkSvg(c) {
    var W = 76, H = 26;
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
      parkBody();
      list.replaceChildren(el("p", "board-empty", "No symbols yet. Add some to fill the board."));
      fit();
      return;
    }
    /* Same symbols in the same order: refresh each row's line in place, leaving the open one open. */
    if (order === boardOrder) {
      boardCards.forEach(function (c) { fillHead(rowEls[c.symbol].head, c); });
      markCursor();
      return;
    }
    boardOrder = order;
    rowEls = {};
    parkBody();
    list.replaceChildren();
    boardCards.forEach(function (c, i) {
      var row = el("div", "wrow");
      var head = el("div", "whead");
      head.setAttribute("role", "button");
      head.setAttribute("aria-expanded", "false");
      head.addEventListener("pointerdown", function (e) { beginDrag(e, boardCards.indexOf(c)); });
      head.addEventListener("click", function () {
        if (swallowClick) return;
        cursor = boardCards.indexOf(c);
        toggleRow(c.symbol);
      });
      fillHead(head, c);
      row.append(head);
      list.append(row);
      rowEls[c.symbol] = { row: row, head: head };
    });
    if (openSym && rowEls[openSym]) attachBody(openSym);
    else openSym = "";
    if (cursor >= boardCards.length) cursor = boardCards.length - 1;
    markCursor();
    fit();
  }

  function markCursor() {
    boardCards.forEach(function (c, i) {
      var r = rowEls[c.symbol];
      if (r) r.row.classList.toggle("cursor", i === cursor);
    });
  }

  /* Puts the chart block back in the hidden detail view, out of any row. */
  function parkBody() {
    var body = $("d-body");
    /* The source line is borrowed by an open row's button line; it goes home with the rest. */
    var meta = $("d-meta") || body.querySelector("#d-meta");
    if (meta.parentNode !== body) body.append(meta);
    if (body.parentNode !== $("detail")) $("detail").append(body);
    var acts = $("wacts");
    if (acts) acts.remove();
  }

  function attachBody(sym) {
    var r = rowEls[sym];
    if (!r) return;
    r.row.classList.add("open");
    r.head.setAttribute("aria-expanded", "true");
    /* Found before anything moves: once #d-body leaves the document, getElementById cannot see in. */
    var body = $("d-body"), meta = $("d-meta");
    var panel = el("div", "wpanel");
    panel.append(body);
    var acts = el("div", "wacts");
    acts.id = "wacts";
    acts.append(meta);
    if (sym !== boardOnKey) {
      var onKey = el("button", "", "Show on key");
      onKey.addEventListener("click", function () {
        post("showOnKey", { symbol: sym }).then(function () { boardOnKey = sym; renderBoardHeads(); acts.removeChild(onKey); });
      });
      acts.append(onKey);
    }
    var remove = el("button", "iconbtn remove");
    remove.setAttribute("aria-label", "Remove " + sym);
    remove.dataset.hint = "Remove from watchlist";
    remove.append(trashIcon());
    remove.addEventListener("click", function () {
      post("remove", { symbol: sym }).then(function () { closeRow(); loadBoard(); });
    });
    acts.append(remove);
    panel.append(acts);
    r.row.append(panel);
  }

  /* Lucide chevron-left (ISC). */
  function chevronLeftIcon() {
    var svg = svgEl("svg", { viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", stroke: "currentColor",
      "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
    svg.append(svgEl("path", { d: "m15 18-6-6 6-6" }));
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

  function closeRow() {
    if (!openSym) return;
    var r = rowEls[openSym];
    parkBody();
    if (r) {
      r.row.classList.remove("open");
      r.head.setAttribute("aria-expanded", "false");
      var panel = r.row.querySelector(".wpanel");
      if (panel) panel.remove();
    }
    openSym = "";
    fit();
  }

  function openRow(sym) {
    var card = boardCards.find(function (c) { return c.symbol === sym; });
    if (!card || card.error) return;
    closeRow();
    post("focus", { symbol: sym }).then(function (reply) {
      if (!reply || !reply.ok || mode !== "board") return;
      openSym = sym;
      symbol = sym;
      rangeCharts = {};
      chart1d = null;
      drawnKey = "";
      /* Clear the last symbol's numbers so they never show under this one's name. */
      $("d-chart").replaceChildren();
      $("d-rows").replaceChildren();
      $("d-meta").textContent = "";
      attachBody(sym);
      /* Today's chart arrives with the quote; a longer range is asked for now. */
      if (range === "1d") chartNotice("Loading…");
      else selectRange(range);
      loadDetail();
      fit();
    });
  }

  function toggleRow(sym) {
    if (openSym === sym) closeRow();
    else openRow(sym);
  }

  /* ---- reordering: drag a row, or ⌥↑ / ⌥↓ on the highlighted one ---- */

  var DRAG_THRESHOLD = 5;
  var drag = null;
  /* A press that became a drag must not also count as the click that opens the row. */
  var swallowClick = false;

  function rowList() { return boardCards.map(function (c) { return rowEls[c.symbol].row; }); }

  function beginDrag(e, i) {
    if (e.button !== 0 || boardCards.length < 2) return;
    drag = { from: i, target: i, startY: e.clientY, active: false, row: rowEls[boardCards[i].symbol].row };
  }

  /* Where row i sits if the dragged row lands on target: everything between shifts one slot. */
  function slotFor(i, target) {
    if (target > drag.from && i > drag.from && i <= target) return i - 1;
    if (target < drag.from && i >= target && i < drag.from) return i + 1;
    return i;
  }

  document.addEventListener("pointermove", function (e) {
    if (!drag) return;
    var dy = e.clientY - drag.startY;
    if (!drag.active) {
      if (Math.abs(dy) < DRAG_THRESHOLD) return;
      drag.active = true;
      /* Every row the same height while they move: an open one closes first. */
      if (openSym) closeRow();
      drag.slots = rowList().map(function (r) { var b = r.getBoundingClientRect(); return b.top + b.height / 2; });
      drag.row.classList.add("lifted");
      document.body.classList.add("dragging-row");
    }
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

  function loadDetail() {
    return post("snapshot").then(function (reply) {
      if (mode !== "detail" && !(mode === "board" && openSym)) return;
      if (reply && reply.detail) renderDetail(reply.detail);
      else showDetailError((reply && reply.message) || "No quote available.");
    }).catch(function () { showDetailError("The plugin is not responding."); });
  }

  /* "Apple Inc." → "A", "S&P/TSX Composite index" → "S", "^GSPTSE" → "G". */
  function initialOf(name, sym) {
    var m = String(name || sym || "").match(/[A-Za-z0-9]/);
    return m ? m[0].toUpperCase() : "·";
  }

  function showDetailError(message) {
    /* In an open row, say it where the chart would be, and keep the board. */
    if (mode === "board") { chartNotice(message); return; }
    $("detail").hidden = true;
    var box = $("d-error");
    box.hidden = false;
    box.textContent = message;
    fit();
  }

  function renderDetail(d) {
    $("d-error").hidden = true;
    /* On a board the detail view stays hidden: only its chart block is shown, inside the open row. */
    $("detail").hidden = mode === "board";
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
    d.rows.forEach(function (r) {
      var item = el("div", "stat");
      var label = el("dt", "", r.label);
      if (r.hint) label.dataset.hint = r.hint;
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
    $("d-web").hidden = !website;

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
  function svgEl(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach(function (k) { e.setAttribute(k, String(attrs[k])); });
    return e;
  }

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

  function selectRange(next) {
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
    post("chart", { range: next }).then(function (reply) {
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
    var box = $("d-chart");
    [".xhair", ".dot", ".readout"].forEach(function (s) { var n = box.querySelector(s); if (n) n.remove(); });
  }

  $("d-chart").addEventListener("pointermove", function (e) {
    if (!shown) return;
    var rect = this.getBoundingClientRect();
    hoverAt = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    hover(hoverAt);
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

  $("change").addEventListener("click", function () { show("search"); });
  $("back").append(chevronLeftIcon());
  $("back").addEventListener("click", function () { show("board"); });
  $("add").append(plusIcon());
  $("add").addEventListener("click", function () { show("search"); });
  Array.prototype.forEach.call($("ranges").children, function (b) {
    b.addEventListener("click", function () { selectRange(b.getAttribute("data-range")); });
  });
  /* The plugin opens it only if it is the website it just sent for this symbol. */
  $("d-web").addEventListener("click", function () { if (website) post("openLink", { url: website }); });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (onBoard && mode === "board" && openSym) closeRow();
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
      if (to >= 0 && to < boardCards.length) { if (openSym) closeRow(); moveRow(cursor, to); }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (mode === "board") {
      if (e.key === "a") { e.preventDefault(); show("search"); }
      if (e.key === "c") { e.preventDefault(); toggleChangeAs(); }
      if (e.key === "r") { loadBoard(); if (openSym) { rangeCharts = {}; loadDetail(); if (range !== "1d") selectRange(range); } }
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && boardCards.length) {
        e.preventDefault();
        cursor = (cursor + (e.key === "ArrowDown" ? 1 : boardCards.length - 1)) % boardCards.length;
        markCursor();
        var r = rowEls[boardCards[cursor].symbol];
        if (r) r.row.scrollIntoView({ block: "nearest" });
      }
      if (e.key === "Enter" && boardCards[cursor]) { e.preventDefault(); toggleRow(boardCards[cursor].symbol); }
      var d = ["1", "2", "3", "4", "5", "6"].indexOf(e.key);
      if (d >= 0 && openSym) selectRange(["1d", "5d", "1mo", "6mo", "ytd", "1y"][d]);
      return;
    }
    if (e.key === "r") { rangeCharts = {}; loadDetail(); if (range !== "1d") selectRange(range); }
    var digit = ["1", "2", "3", "4", "5", "6"].indexOf(e.key);
    if (digit >= 0) selectRange(["1d", "5d", "1mo", "6mo", "ytd", "1y"][digit]);
    if (e.key === "s" && INIT.canChange !== false) { e.preventDefault(); show("search"); }
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
