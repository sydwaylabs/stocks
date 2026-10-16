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
  mode: "detail" | "search";
  symbol?: string;
  windowTitle: string;
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
.logo { width: 20px; height: 20px; border-radius: 4px; background: #fff; object-fit: contain; flex: 0 0 auto; }
.name { color: var(--fg-dim); margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.company { color: var(--fg-faint); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.name-row .spacer { flex: 1; }
.link { background: none; border: none; padding: 0; color: var(--series); font-size: 12px; }
.link:hover { text-decoration: underline; }
.price-row { display: flex; align-items: baseline; gap: 10px; }
.price { font-size: 32px; font-weight: 650; font-variant-numeric: tabular-nums; }
.ccy { color: var(--fg-dim); font-size: 13px; }
.move { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.up { color: var(--good); } .down { color: var(--down); } .flat { color: var(--fg-dim); }
.chart-head { display: flex; align-items: center; justify-content: space-between; margin: 12px 0 6px; }
.seg { display: inline-flex; background: var(--card); border: 1px solid var(--card-line); border-radius: 7px; padding: 2px; gap: 2px; }
.seg button { border: none; background: none; padding: 2px 9px; border-radius: 5px; font-size: 12px; color: var(--fg-dim); }
.seg button:hover { color: var(--fg); }
.seg button.on { background: var(--accent); color: var(--on-accent); font-weight: 600; }
.chart-caption { color: var(--fg-dim); font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
/* Price scale on the right, as price charts have it, hard against the plot; the time axis sits
   under the plot only. */
.chart-grid { display: grid; grid-template-columns: 1fr auto; column-gap: 6px; }
.chart { position: relative; background: var(--card); border: 1px solid var(--card-line); border-radius: 8px; height: 150px; overflow: hidden; cursor: crosshair; }
/* Hover: a rule at the nearest bar, a dot on the line, and a readout that stays inside the plot. */
.xhair { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--fg-faint); pointer-events: none; }
.dot { position: absolute; width: 9px; height: 9px; margin: -6px 0 0 -6px; border-radius: 50%; border: 2px solid var(--card); pointer-events: none; }
.readout { position: absolute; top: 6px; padding: 4px 8px; border-radius: 6px; background: #1e1e1e; border: 1px solid var(--card-line); box-shadow: var(--shadow-lift, 0 6px 18px rgba(0,0,0,.45)); pointer-events: none; white-space: nowrap; font-variant-numeric: tabular-nums; }
.readout-price { font-weight: 650; font-size: 13px; }
.readout-meta { color: var(--fg-dim); font-size: 11px; }
.yaxis { position: relative; min-width: 24px; margin: 1px 0; }
.ytick { position: absolute; left: 0; transform: translateY(-50%); color: var(--fg-faint); font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.chart svg { display: block; width: 100%; height: 100%; }
.axis { position: relative; height: 16px; margin: 4px 1px 0; }
.tick { position: absolute; top: 0; transform: translateX(-50%); color: var(--fg-faint); font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.tick.start { transform: none; }
.tick.end { transform: translateX(-100%); }
.chart-empty { height: 100%; display: flex; align-items: center; justify-content: center; color: var(--fg-faint); }
/* Stats in pairs, filled left to right. */
.stats { display: grid; grid-template-columns: 1fr 1fr; column-gap: 28px; margin-top: 12px; }
.stat { display: flex; justify-content: space-between; gap: 10px; padding: 6px 0; border-top: 1px solid var(--line); font-variant-numeric: tabular-nums; line-height: 18px; min-width: 0; }
.stat dt { color: var(--fg-dim); white-space: nowrap; }
.stat dd { margin: 0; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta { color: var(--fg-faint); font-size: 11px; margin-top: 10px; }
.note { color: var(--slow); font-size: 12px; margin-top: 8px; }
.notice { color: var(--fg-dim); padding: 30px 10px; text-align: center; }

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
  <button id="change" hidden>Change symbol…</button>
</div>

<main id="detail" hidden>
  <div class="name-row">
    <img class="logo" id="d-logo" alt="" hidden>
    <p class="name" id="d-name"></p>
    <span class="company" id="d-company"></span>
    <span class="spacer"></span>
    <button class="link" id="d-web" hidden>Website</button>
  </div>
  <div class="price-row"><span class="price" id="d-price"></span><span class="ccy" id="d-ccy"></span></div>
  <div class="move" id="d-move"></div>
  <div class="chart-head">
    <div class="seg" id="ranges" role="tablist" aria-label="Chart range">
      <button data-range="1d" class="on" role="tab">1D</button><button data-range="5d" role="tab">5D</button><button data-range="1mo" role="tab">1M</button><button data-range="6mo" role="tab">6M</button><button data-range="1y" role="tab">1Y</button>
    </div>
    <span class="chart-caption" id="chart-caption"></span>
  </div>
  <div class="chart-grid">
    <div class="chart" id="d-chart"></div>
    <div class="yaxis" id="d-yaxis"></div>
    <div class="axis" id="d-axis"></div>
  </div>
  <dl class="stats" id="d-rows"></dl>
  <p class="note" id="d-note" hidden></p>
  <p class="meta" id="d-meta"></p>
</main>
<main id="d-error" class="notice" hidden></main>

<main id="search" hidden>
  <input class="search-box" id="q" type="text" placeholder="Search a company, fund, ETF or crypto" autocomplete="off" spellcheck="false" aria-label="Search">
  <ul class="results" id="results" role="listbox"></ul>
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
      if (mode === "detail") {
        var view = $("detail").hidden ? $("d-error") : $("detail");
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
    $("search").hidden = next !== "search";
    $("change").hidden = next !== "detail";
    clearInterval(poll);
    if (next === "search") {
      $("chip").textContent = symbol ? "Change " + symbol : "Choose a symbol";
      setFooter([["↑↓", "choose"], ["↵", "pick"], ["esc", openedForSearch ? "close" : "back"]]);
      var q = $("q");
      q.value = query;
      q.focus();
      q.select();
      renderResults();
      fit();
    } else {
      $("chip").textContent = symbol;
      setFooter([["1–5", "range"], ["r", "refresh"], ["s", "change symbol"], ["esc", "close"]]);
      loadDetail();
      poll = setInterval(loadDetail, 30000);
    }
  }

  /* ---- detail ---- */

  function loadDetail() {
    return post("snapshot").then(function (reply) {
      if (mode !== "detail") return;
      if (reply && reply.detail) renderDetail(reply.detail);
      else showDetailError((reply && reply.message) || "No quote available.");
    }).catch(function () { showDetailError("The plugin is not responding."); });
  }

  function showDetailError(message) {
    $("detail").hidden = true;
    var box = $("d-error");
    box.hidden = false;
    box.textContent = message;
    fit();
  }

  function renderDetail(d) {
    $("d-error").hidden = true;
    $("detail").hidden = false;
    symbol = d.symbol;
    $("chip").textContent = d.exchange ? d.symbol + " · " + d.exchange : d.symbol;
    document.title = INIT.windowTitle.split(" — ")[0] + " — " + d.symbol;
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
      item.append(el("dt", "", r.label), el("dd", "", r.value));
      rows.append(item);
    });

    var logo = $("d-logo");
    if (d.logo && logo.getAttribute("src") !== d.logo) logo.setAttribute("src", d.logo);
    logo.hidden = !d.logo;
    logo.onerror = function () { logo.hidden = true; fit(); };
    logo.onload = fit;
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

  var RANGE_NAMES = { "1d": "today", "5d": "past 5 days", "1mo": "past month", "6mo": "past 6 months", "1y": "past year" };

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
    move.className = "move " + src.trend;
    var label = src === today ? "today" : RANGE_NAMES[range];
    move.textContent = [src.change, src.changePct ? "(" + src.changePct + ")" : ""].join(" ").trim() + " " + label;
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
    drawChart($("d-chart"), c);
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

  function drawChart(box, c) {
    box.replaceChildren();
    var W = 600, H = 150;
    /* The plugin chose the span (with headroom) and the ticks, so labels and line agree. */
    var span = c.yMax - c.yMin || 1;
    var x = function (f) { return f * W; };
    var y = function (v) { return (1 - (v - c.yMin) / span) * H; };
    var colour = c.trend === "down" ? "#ef4b4b" : c.trend === "up" ? "#29bd50" : "#8b8b93";
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "none", role: "img", "aria-label": "Price, " + RANGE_NAMES[c.range] });
    c.yTicks.forEach(function (t) {
      svg.append(svgEl("line", { x1: 0, x2: W, y1: y(t.v), y2: y(t.v), stroke: "#3a3a3a", "stroke-width": 1, "vector-effect": "non-scaling-stroke" }));
    });
    if (c.baseline != null) svg.append(svgEl("line", { x1: 0, x2: W, y1: y(c.baseline), y2: y(c.baseline), stroke: "#515151", "stroke-dasharray": "3 4", "vector-effect": "non-scaling-stroke" }));
    var line = c.points.map(function (p) { return x(p.x).toFixed(1) + "," + y(p.v).toFixed(1); }).join(" ");
    var first = x(c.points[0].x).toFixed(1), last = x(c.points[c.points.length - 1].x).toFixed(1);
    svg.append(svgEl("polygon", { points: first + "," + H + " " + line + " " + last + "," + H, fill: colour, "fill-opacity": 0.12 }));
    svg.append(svgEl("polyline", { points: line, fill: "none", stroke: colour, "stroke-width": 2, "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" }));
    box.append(svg);
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
  Array.prototype.forEach.call($("ranges").children, function (b) {
    b.addEventListener("click", function () { selectRange(b.getAttribute("data-range")); });
  });
  /* The plugin opens it only if it is the website it just sent for this symbol. */
  $("d-web").addEventListener("click", function () { if (website) post("openLink", { url: website }); });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (mode === "search" && !openedForSearch) show("detail");
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
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "r") { rangeCharts = {}; loadDetail(); if (range !== "1d") selectRange(range); }
    var digit = ["1", "2", "3", "4", "5"].indexOf(e.key);
    if (digit >= 0) selectRange(["1d", "5d", "1mo", "6mo", "1y"][digit]);
    if (e.key === "s") { e.preventDefault(); show("search"); }
  });

  /* The browser fallback ignores --window-size when Chrome is already running. */
  if (!window.__nativeHost) {
    try { window.resizeTo(${WINDOW_WIDTH} + (outerWidth - innerWidth), ${WINDOW_HEIGHT} + (outerHeight - innerHeight)); } catch (e) { /* not allowed */ }
  }

  document.documentElement.classList.add("ready");
  show(mode);
})();
</script>
</body>
</html>`;
}
