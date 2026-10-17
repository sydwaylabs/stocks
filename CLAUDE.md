# Stocks

A Stream Deck plugin (`com.sydwaylabs.stocks`), built from streamdeck-kit.

## Read first

- The **streamdeck-kit** skill is the specification. Load it before touching anything in
  `com.sydwaylabs.stocks.sdPlugin/`, and follow its references over anything guessed.
- House rules — ids, names, versions, icons — are in the kit's `references/conventions.md`.
- `/streamdeck-kit:sd-audit` checks this repo against the kit; deliberate departures are recorded
  in `.streamdeck-kit.json` with a reason.
- Releases go through `/streamdeck-kit:sd-release`. Never edit the manifest `Version` by hand: it has to agree
  with `package.json`, and the release gate fails if it does not.
- Add every user-visible change to `## [Unreleased]` in `CHANGELOG.md` in the same commit.

## Verifying a change

`npm run build` passing is not evidence. Run `npm run typecheck && npm test`, and
`npm run release` before calling anything done.

## This plugin

Three actions, all drawn as SVG (`src/lib/key-image.ts`), all sharing one `QuoteService` and the
Finnhub key handling through `src/services.ts`, and one inspector script (`ui/stocks-inspector.js`):

- **Ticker** (`com.sydwaylabs.stocks.ticker`): one quote. Tap refreshes, hold opens the window.
- **Watchlist** (`.watchlist`): up to 12 symbols, dots across the top. Tap moves on (pausing
  rotation); hold opens the board (`mode: "board"`): rows, one open at a time. Opening a row moves the
  detail view's `#d-body` (chart, stats, source) into it, so the chart code is shared; the rest of
  the detail view stays hidden. Messages `focus`, `showOnKey` and `remove` are checked against the
  list. Rows are kept by symbol and refreshed in place, so the poll never rebuilds the open one.
  Every row opens closed (the user's call); the keyboard cursor starts on the key's row.
  Adding is a popover from + (Timekeeper's world-clock pattern), over the board; an empty key's
  press opens the board with it open (`openAdd`). Ticker and Price Alert change symbol from the same
  popover, opened by the ⇄ icon button in the same corner, which closes on a pick. The full-screen
  search view remains only for an empty Ticker or Alert key's first press.
  Note from Timekeeper: WebKit draws the system checkbox as a bare tick with no box on the dark
  ground — use a drawn control there.
  Reordering follows Timekeeper's card drag (lift, others slide, settle); an open row closes when
  a drag starts so slots are even. `reorder` is accepted only as a permutation of the list.
  Search adds and stays open. Note: an offscreen WKWebView does not advance CSS animations, so a
  headless preview of a faded-in chart shows it blank — render with the window on screen.
- **Price Alert** (`.alert`): logic in `src/lib/alert.ts` (armed → fired → cleared → armed, with
  a 0.5% re-arm margin). Tap clears a fired alert, otherwise checks now. Its watch ticker keeps
  running after `willDisappear` (only the pulse and window stop); the phase is saved in settings.
  Known gap: after a restart Stream Deck reports only visible keys, so a hidden alert resumes when
  its folder is opened. With `popup` on (default) a firing opens the window `unbidden`, i.e. with
  `--no-focus`, so it never takes the keyboard.
- **One record per key**: every action's `onWillAppear` updates the existing instance in place.
  Replacing it once left the window's `finally` clearing `closeWindow` on a dead record, and the key
  ignored holds forever after.

Every action: hold opens the window, and an empty key opens search on any press.

- **Data**: `src/lib/quotes.ts` chooses sources; parsers live in `src/lib/providers/` and are
  tested against fixtures captured from the live endpoints. Yahoo `v8/finance/chart` and
  `v1/finance/search` are keyless; `v7/quote` and `v10/quoteSummary` need a crumb and are not used.
  Nasdaq `api/quote/<sym>/summary` gives US market cap. Finnhub is optional; 401 means a bad key,
  403 means a good key without access to that symbol — only 401 is reported to the user.
- **User agent** (`src/lib/providers/http.ts`): a plain `SydwayLabsStocks/1.0` string. A full
  Safari or Chrome UA from Node gets 429 from Yahoo, and a UA containing a URL makes Nasdaq hang.
  Both measured 2026-10-16; if either endpoint starts failing, check the UA first.
- **Finnhub key**: global settings, sealed with the keychain collection key
  (`patterns/keychain-secret-store`, `--collection-key` mode in `native/host.swift`). The inspector
  never binds it to a setting; it sends `setFinnhubKey` and the plugin checks, seals and stores.
- **Chart**: `src/lib/chart-data.ts` lays it out (x positions, ticks as epoch ms); the page
  formats times in the Mac's zone. 1D is on the session clock from Yahoo's `tradingPeriods`;
  longer ranges are spaced by bar. `QuoteService.chart` caches longer ranges for 10 minutes.
- **Profiles** (name, industry, logo URL) are one Finnhub call per symbol, cached a day in
  `QuoteService.profile` and shared by the detail view and `QuoteService.logo`, which a board uses
  for its rows — so a full board costs at most 12 calls a day, well inside 60 a minute.
- **Logos** are cached in `~/Library/Caches/com.sydwaylabs.stocks/logos/` (`src/lib/logo-cache.ts`,
  30 days, raster images only, sniffed by their bytes) and served to the window at
  `/asset/logo?symbol=…` — a route added to `src/window-host.ts` (`serveAsset`), worth harvesting
  into the kit. The page never loads anything from the internet.
- **Tooltips**: `src/lib/page-tip.ts` is the kit's page-tip pattern, plus a 600 ms rest before a
  tip shows and instant neighbours once one is up, and `data-explain` for click-to-show (the stat
  labels; buttons keep hover `data-hint`) — both worth harvesting into the kit; anything with `data-hint`
  gets the one page tooltip (stat labels, change pills, the trash button). Hint texts live in
  `HINTS` in `src/lib/detail-data.ts`.
- **Watchlist key dots** sit on the bottom edge (y=135), matching Timekeeper's world clock.
- **Pin and refresh**: the window's ⟳ forces past the quote and chart caches (`force` on the
  `board`, `snapshot` and `chart` messages). 📌 sets the key's `pinWindow`: `serveWindow`'s
  `keepOpen` (added to `src/window-host.ts`, a kit candidate) skips the idle close, and
  `onWillDisappear` leaves a pinned window open. After Quick Clips' stay-open pin.
- **Board sort** (`boardSort`, remembered per key): the plugin sorts with `sortCards` before
  sending; the list's own order — and the key's rotation — never change. Drag and ⌥↑↓ work only
  in "custom" (My order). Class names in the page share one namespace: the menu's tick is
  `mtick` because `tick` is the chart axis label.
- **Palette departure**: the chart's range selector is a neutral grey pill, not the house
  `--accent` green — in the detail view green means "price up", so a green selection reads as
  data. Search keeps the house green, which has no price colours to collide with.
- **Window**: one page, two views (`src/lib/window-page.ts`). `select` is accepted only for a
  symbol in the last search results (`SearchSession`).
- **Refresh**: the shared ticker (`src/tick.ts`), one subscription per key; the quote cache
  (20 s) makes keys on the same symbol share one request.
- **Finnhub extras** (key only): `/stock/metric` ratios, `/stock/profile2` company facts and
  `/calendar/earnings`, all in `QuoteService.detailed`; the key's earnings badge uses
  `QuoteService.earnings`, cached 6 h. Company websites reach `serveWindow`'s `links` as the
  window shows them, so `openLink` opens only a site the page was just given.
- The Finnhub tests in `providers.test.ts` use shapes from the API docs. `FINNHUB_KEY=…
  node scripts/capture-finnhub.mjs` captures real ones into `fixtures/` and reports which metric
  names are present.
