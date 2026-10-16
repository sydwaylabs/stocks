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

One action, **Ticker** (`com.sydwaylabs.stocks.ticker`): a quote per key, drawn as SVG
(`src/lib/key-image.ts`). Tap refreshes (a read-only request, so the tap may act), hold opens the
window; an empty key opens search on any press.

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
