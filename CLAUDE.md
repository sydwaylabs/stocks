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
- **Watchlist** (`.watchlist`): up to 10 symbols (`WATCHLIST_MAX`: as many rows as fit the
  board's height, so the list never scrolls), dots across the top. Tap moves on (pausing
  rotation); hold opens the board (`mode: "board"`): the list, and beside it the whole detail view
  as a panel (`.split.side`), so the chart code is shared. The panel opens on the key's symbol and
  the window launches wide (`BOARD_WIDE_WIDTH`) for it. The board remembers whether the panel
  was showing (`rememberPanel`, message `boardOpens`, the setting `boardOpens` sent as
  `INIT.listOnly`, also the inspector's **Hold opens**): shown by the bar's details button
  (`sidebar.right`, pressed like the pin while it shows) or a row's click, hidden by the button or
  Esc — so Esc, Esc opens the next board on its list. Remembering Esc was dropped once, when
  nothing showed the state or brought the panel back; the button does both, and the user asked
  for it back. The window then launches narrow and a row's click widens it. The panel had its
  own ✕ too; it and a sort menu (by change, name or price) were removed as too many buttons — the
  user's call. The panel slides out: the board is `BOARD_LIST_WIDTH` wide
  without it, the list's width beside it, so only the panel's width is added (the list was 640 →
  560 once, and every row shrank as it opened); `resize` takes a `width` and `anchor: "left"` in
  `native/host.swift` (a kit candidate), so the window grows from its right edge and the list
  holds still; `.split` clips the panel while the window animates; and `closePanel` keeps it drawn
  for `PANEL_SLIDE_MS` while the window narrows over it. Other windows still resize about their
  centre. The board keeps one height (`BOARD_VIEW_HEIGHT`, a stock's full
  panel; it only ever grows), so a short list leaves room under it with one "Add symbol" slot.
  Rows were tried opening in place: the window grew with each one (the user's call to change).
  No CSS animation on the panel: one in a window not yet on screen is stuck at its first frame.
  Messages `focus`, `showOnKey` and `remove` are checked against the list. Rows are kept by symbol
  and refreshed in place. ↑↓ step the panel through the list; a detail reply for a symbol stepped
  past is dropped. Removing the symbol shown moves the panel to the next.
  Adding is a popover from + (Timekeeper's world-clock pattern), over the board; an empty key's
  press opens the board with it open (`openAdd`). Ticker and Price Alert change symbol from the same
  popover, opened by the ⇄ icon button in the same corner, which closes on a pick. The full-screen
  search view remains only for an empty Ticker or Alert key's first press.
  Note from Timekeeper: WebKit draws the system checkbox as a bare tick with no box on the dark
  ground — use a drawn control there.
  Reordering follows Timekeeper's card drag (lift, others slide, settle). `reorder` is accepted only as a permutation of the list.
  Search adds and stays open. Note: an offscreen WKWebView does not advance CSS animations, so a
  headless preview of a faded-in chart shows it blank — render with the window on screen.
- **Watchlist on a dial** (`Controllers: Keypad, Encoder`): turn moves (any number of ticks,
  wrapping), push and touch open the board — Timekeeper's world-clock mapping. The strip is one
  pixmap, `canvas` in `layouts/watchlist.json`, drawn by `renderDial`. A changed layout file needs
  the Stream Deck app quit and reopened, not just a plugin restart.
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
  for its rows — so a full board costs at most 10 calls a day, well inside 60 a minute.
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
- **Pin and refresh**: the window's ⟳ forces what is being looked at past the quote and chart
  caches (`force` on the `snapshot` and `chart` messages) — on a board, the panel's symbol only;
  the list is re-read through the cache. 📌 sets the key's `pinWindow`: `serveWindow`'s
  `keepOpen` (added to `src/window-host.ts`, a kit candidate) skips the idle close, and
  `onWillDisappear` leaves a pinned window open. After Quick Clips' stay-open pin.
- **Palette departure**: the chart's range selector is a neutral grey pill, not the house
  `--accent` green — in the detail view green means "price up", so a green selection reads as
  data. Search keeps the house green, which has no price colours to collide with.
- **Window**: one page, two views (`src/lib/window-page.ts`). `select` is accepted only for a
  symbol in the last search results (`SearchSession`).
- **Refresh**: the shared ticker (`src/tick.ts`), one subscription per key; the quote cache
  (20 s) makes keys on the same symbol share one request. A quote fetched after its session ended
  is kept 5 minutes (nothing moves until the next open); a forced fetch within 5 s of the last
  answer gets that answer. A board's rows ask `lite` (Yahoo only — no Finnhub quote per row, so
  a 10-row board polled every 30 s stays well inside Finnhub's 60 a minute); a lite answer never
  serves a key or the panel. Key timers (Ticker every `intervalMin`, default 1; Watchlist every
  minute) go through the cache, never `force` — only a press forces — so a closed market costs
  nothing. Keys fade with `isStale`, which never fades a quote fetched after the close.
- **Finnhub extras** (key only): `/stock/metric` ratios, `/stock/profile2` company facts and
  `/calendar/earnings`, all in `QuoteService.detailed`; the key's earnings badge uses
  `QuoteService.earnings`, cached 6 h. Company websites reach `serveWindow`'s `links` as the
  window shows them, so `openLink` opens only a site the page was just given.
- **News** (`QuoteService.news`, a popover from the newspaper button beside the website's,
  `.hero-acts`): Yahoo's
  `v1/finance/search` with `newsCount`, keyless. Kept to stories tagged with the symbol and at most
  5 tickers (more is a market round-up); Yahoo finds nothing for `RY.TO` or `BTC-USD`, so it asks
  again by base symbol, then by name less a trailing currency ("Bitcoin USD" finds nothing either).
  Cached 15 min, empty answers too. Headline URLs join `links` as they are sent, like websites.
  Each story's 140 px picture (only from `*.yimg.com`) is downloaded by the plugin, kept in memory
  for the window's life, and served at `/asset/thumb?n=…` by index into what was sent; the
  publisher's initial shows beneath it, as the company logo's does. Favicons were considered:
  every link is finance.yahoo.com and no publisher domain is given. A button with an open
  popover sets `aria-expanded`, and the page tip skips it — otherwise it reappears under the popover.
- **Extended hours**: the detail view only (`QuoteService.detailed` → `extended`, plain US
  tickers, 20 s cache, failures ignored) asks Yahoo's chart again with `includePrePost=true` and
  `parseExtended` takes the last bar's price and time: inside a `tradingPeriods.pre` span is
  "Pre-market", inside `post` "After hours", inside regular nothing. Overnight and at weekends it
  is the last after-hours trade, as Apple's Stocks shows it. Keys, rows, the sparkline and the 1D
  chart stay on `includePrePost=false` and never pay for it. `fulldayPrice` was tried first and
  measured 2026-10-20: it falls back to the regular close the moment after-hours trading ends
  (20:00 ET), and the line vanished. Shown on the move's line (a line of its own would grow the
  board's panel). Pre-market is not yet seen live.
- **SF Symbols** (newspaper, globe, sidebar.right) come in as path data: `npm run symbols` writes
  `src/lib/sf-symbols.ts` from `scripts/sf-symbols.swift`, Timekeeper's script trimmed to window
  icons. Apple's licence rules them out of the plugin's and actions' icons. The other window
  icons are still Lucide. `globe`'s meridians come as "eraser" layers on macOS 27 (`erasersAreInk`).
- The Finnhub tests in `providers.test.ts` use shapes from the API docs. `FINNHUB_KEY=…
  node scripts/capture-finnhub.mjs` captures real ones into `fixtures/` and reports which metric
  names are present.
