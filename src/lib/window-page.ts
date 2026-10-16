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

export const WINDOW_WIDTH = 440;
export const WINDOW_HEIGHT = 560;

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
main { flex: 1; overflow: auto; padding: 14px; }
footer { padding: 8px 14px; border-top: 1px solid var(--line); color: var(--fg-faint); font-size: 11px; display: flex; gap: 12px; }
kbd { background: var(--kbd); border-radius: 4px; padding: 0 5px; font: inherit; color: var(--fg-dim); }
button { font: inherit; color: var(--fg); background: var(--card); border: 1px solid var(--card-line); border-radius: 6px; padding: 4px 10px; cursor: default; }
button:focus-visible, input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
[hidden] { display: none !important; }

/* detail */
.name { color: var(--fg-dim); margin: 0 0 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.price-row { display: flex; align-items: baseline; gap: 10px; }
.price { font-size: 32px; font-weight: 650; font-variant-numeric: tabular-nums; }
.ccy { color: var(--fg-dim); font-size: 13px; }
.move { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.up { color: var(--good); } .down { color: var(--down); } .flat { color: var(--fg-dim); }
.chart { margin: 12px 0 4px; background: var(--card); border: 1px solid var(--card-line); border-radius: 8px; height: 140px; }
.chart svg { display: block; width: 100%; height: 100%; }
.chart-empty { height: 100%; display: flex; align-items: center; justify-content: center; color: var(--fg-faint); }
.range { margin: 12px 0; }
.range-head { display: flex; justify-content: space-between; color: var(--fg-dim); font-size: 12px; margin-bottom: 5px; font-variant-numeric: tabular-nums; }
.range-head span:first-child { color: var(--fg); }
.track { position: relative; height: 4px; border-radius: 2px; background: var(--card-line); }
.marker { position: absolute; top: -4px; width: 4px; height: 12px; margin-left: -2px; border-radius: 2px; background: var(--fg); }
table { width: 100%; border-collapse: collapse; margin-top: 6px; }
td { padding: 6px 0; border-top: 1px solid var(--line); font-variant-numeric: tabular-nums; }
td:last-child { text-align: right; }
td:first-child { color: var(--fg-dim); }
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
<div class="bar">
  <span class="brand">Stocks</span>
  <span class="bar-divider"></span>
  <span class="chip" id="chip"></span>
  <span class="spacer"></span>
  <button id="change" hidden>Change symbol…</button>
</div>

<main id="detail" hidden>
  <p class="name" id="d-name"></p>
  <div class="price-row"><span class="price" id="d-price"></span><span class="ccy" id="d-ccy"></span></div>
  <div class="move" id="d-move"></div>
  <div class="chart" id="d-chart"></div>
  <div id="d-ranges"></div>
  <table><tbody id="d-rows"></tbody></table>
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
    } else {
      $("chip").textContent = symbol;
      setFooter([["r", "refresh"], ["s", "change symbol"], ["esc", "close"]]);
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
    var move = $("d-move");
    move.className = "move " + d.trend;
    move.textContent = [d.change, d.changePct ? "(" + d.changePct + ")" : ""].join(" ").trim() + " today";
    drawChart($("d-chart"), d.points, d.prevClose, d.trend);

    var ranges = $("d-ranges");
    ranges.replaceChildren();
    d.ranges.forEach(function (r) {
      var wrap = el("div", "range");
      var head = el("div", "range-head");
      head.append(el("span", "", r.label), el("span", "", r.low + " – " + r.high));
      var track = el("div", "track");
      var marker = el("div", "marker");
      marker.style.left = (r.at * 100).toFixed(1) + "%";
      track.append(marker);
      wrap.append(head, track);
      ranges.append(wrap);
    });

    var rows = $("d-rows");
    rows.replaceChildren();
    d.rows.forEach(function (r) {
      var tr = el("tr");
      tr.append(el("td", "", r.label), el("td", "", r.value));
      rows.append(tr);
    });

    var note = $("d-note");
    note.hidden = !d.note;
    note.textContent = d.note || "";

    var when = d.marketTime ? new Date(d.marketTime) : null;
    var meta = "Source: " + d.source;
    if (when) meta += " · last trade " + when.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    meta += " · updated " + new Date(d.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    $("d-meta").textContent = meta;
  }

  var NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach(function (k) { e.setAttribute(k, String(attrs[k])); });
    return e;
  }

  function drawChart(box, points, prevClose, trend) {
    box.replaceChildren();
    if (!points || points.length < 2) {
      box.append(el("div", "chart-empty", "No intraday data"));
      return;
    }
    var W = 400, H = 140, P = 10;
    var values = prevClose != null ? points.concat([prevClose]) : points;
    var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
    var span = hi - lo || 1;
    var x = function (i) { return P + (i / (points.length - 1)) * (W - 2 * P); };
    var y = function (v) { return P + (1 - (v - lo) / span) * (H - 2 * P); };
    var colour = trend === "down" ? "#ef4b4b" : trend === "up" ? "#29bd50" : "#8b8b93";
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "none", role: "img", "aria-label": "Today's price" });
    if (prevClose != null) svg.append(svgEl("line", { x1: P, x2: W - P, y1: y(prevClose), y2: y(prevClose), stroke: "#515151", "stroke-dasharray": "3 4", "vector-effect": "non-scaling-stroke" }));
    var line = points.map(function (v, i) { return x(i).toFixed(1) + "," + y(v).toFixed(1); }).join(" ");
    svg.append(svgEl("polygon", { points: P + "," + (H - P) + " " + line + " " + (W - P) + "," + (H - P), fill: colour, "fill-opacity": 0.12 }));
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
      if (openedForSearch) post("close");
      else { query = ""; show("detail"); }
    });
  }

  $("q").addEventListener("input", function () {
    clearTimeout(debounce);
    debounce = setTimeout(runSearch, 250);
  });

  $("change").addEventListener("click", function () { show("search"); });

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
    if (e.key === "r") loadDetail();
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
