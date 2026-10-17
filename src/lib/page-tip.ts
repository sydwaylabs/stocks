/**
 * One tooltip for a whole page, for anything marked `data-hint`.
 *
 * The native host does not show the `title` attribute, so a swatch, a status dot or an icon button
 * named only by `title` has a name nobody can see. A CSS tip on the element itself is clipped by
 * whatever scrolls or rounds its corners around it — a list's own overflow cut one off above its
 * first row — so this is one fixed element at the top of the page, placed by script under the
 * thing pointed at, or above it when there is no room below, and kept inside the window.
 *
 * Splice both into the page: `<style>${TIP_CSS}</style>` and `<script>${TIP_SCRIPT}</script>`.
 * No backticks in either string, because both go into page template literals.
 *
 * A page that measures its own height to fit the window must skip this element, which is
 * `position: fixed` — or the first hover grows the window by the tip's height.
 */

export const TIP_CSS = `
  .page-tip {
    position: fixed; z-index: 100; left: 0; top: 0; pointer-events: none;
    padding: 4px 7px; border-radius: 6px; background: #333333; color: #8b8b93;
    border: 1px solid #515151; box-shadow: 0 6px 18px rgba(0,0,0,.45);
    font: 500 11px/1.3 -apple-system, BlinkMacSystemFont, sans-serif; white-space: nowrap;
    opacity: 0; transition: opacity .1s ease;
  }
  .page-tip.on { opacity: 1; }
`;

export const TIP_SCRIPT = `
(function () {
  var tip = document.createElement("div");
  tip.className = "page-tip";
  tip.setAttribute("role", "tooltip");
  var shownFor = null;
  /* A tip waits for the pointer to rest, so passing over things does not flash them up; once one is
     showing, its neighbours follow at once, as macOS tooltips do, until the pointer has been off
     anything with a hint for a moment. */
  var REST_MS = 600, WARM_MS = 400;
  var pending = 0, lastHidden = 0;
  function hide() {
    clearTimeout(pending);
    if (shownFor) lastHidden = Date.now();
    shownFor = null;
    tip.classList.remove("on");
  }
  function show(target) {
    if (!tip.parentNode) document.body.appendChild(tip);
    shownFor = target;
    tip.textContent = target.getAttribute("data-hint");
    var r = target.getBoundingClientRect();
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var left = Math.max(6, Math.min(window.innerWidth - w - 6, r.left + r.width / 2 - w / 2));
    var top = r.bottom + 6;
    if (top + h > window.innerHeight - 4) top = r.top - h - 6;
    tip.style.transform = "translate(" + Math.round(left) + "px," + Math.round(top) + "px)";
    tip.classList.add("on");
  }
  document.addEventListener("mouseover", function (event) {
    var target = event.target && event.target.closest ? event.target.closest("[data-hint]") : null;
    if (target === shownFor) return;
    var warm = shownFor !== null || Date.now() - lastHidden < WARM_MS;
    hide();
    if (!target || !target.getAttribute("data-hint")) return;
    if (warm) show(target);
    else pending = setTimeout(function () { show(target); }, REST_MS);
  });
  document.addEventListener("mousedown", hide);
  window.addEventListener("blur", hide);
})();
`;
