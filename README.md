# Stocks

Live stock, ETF and crypto quotes on your keys — works out of the box, with an optional free Finnhub key.

A Stream Deck plugin by Sydway Labs, for macOS 12 or later and Stream Deck 6.9 or later.

## Actions

| Action | Press | Hold |
|---|---|---|
| **Ticker** (symbol set) | Refresh now | Open the detail window: a chart (1D, 5D, 1M, 6M, YTD, 1Y), day and 52-week ranges, volume, market cap, and **Change symbol** |
| **Ticker** (empty key) | Open search | Open search |
| **Watchlist** | Next symbol (pauses auto-rotation for a minute) | The board: a card per symbol; click one for its detail |
| **Watchlist** (empty key) | Search, adding to the list | Search, adding to the list |
| **Price Alert** (fired) | Clear the alert | Detail window |
| **Price Alert** (watching) | Check now | Detail window |
| **Price Alert** (empty key) | Open search | Open search |

**Watchlist** keeps up to 12 symbols on one key, with a dot for each across the top. Type them
into the key's settings or add them with search, which stays open so you can add several. It can
also move on by itself every 5, 10 or 30 seconds. Holding it opens the board — a card for every
symbol with its price, today's move and the day's line, the one on the key marked — where a click
opens a symbol's full detail, **Add symbol…** adds more, and × on a card removes it.

**Price Alert** watches one symbol for a price (rises to / falls to), a move today (up or down by
a percentage) or a new 52-week high or low. The key shows the condition in amber and how far away
it is; when the alert fires, the whole key turns amber and pulses until you press it. It then
waits for the price to move back past the line by 0.5% (or half a point, for a % move) before it
watches again, so a price sitting on the line cannot fire it over and over. An alert keeps
watching while its folder is closed. After Stream Deck restarts, one in a closed folder starts
again when that folder is next opened.

Each key shows one symbol — a stock, ETF, fund, index or coin — with its price, today's change
and a sparkline of the day. Drag a Ticker onto a key, press it, type a company name ("apple",
"vanguard s&p", "bitcoin") and pick from the results; there is no need to know the ticker. A
symbol can also be typed straight into the key's settings — Yahoo's spelling, so Toronto listings
end in `.TO` (`RY.TO`), the TSX Venture in `.V`, London in `.L`, and the S&P/TSX Composite is
`^GSPTSE`. The key's settings also set how often it refreshes
(1, 5 or 15 minutes), whether it shows the price or only the change, and whether the change is
shown as a percentage (+1.23%) or an amount (+$4.20).

A refresh only reads public quotes, so a tap is safe to act on; the hold opens the window, as on
every Sydway Labs key. A key whose numbers are more than two refreshes old is drawn dimmed.

## Where the numbers come from

- **Out of the box: Yahoo Finance.** No account, no key. Yahoo's chart and search endpoints are
  unofficial — they are what Yahoo's own site uses — so quotes may be delayed by up to 15 minutes
  for some exchanges, and Yahoo could change them without notice.
- **Optional: a free [Finnhub](https://finnhub.io/register) key**, pasted into any Stocks key's
  settings and shared by all of them. With a key, prices come from Finnhub's official API wherever
  it covers the symbol (mostly US listings on the free plan), market cap and the 52-week range come
  from Finnhub, and Yahoo fills in everything else — the sparkline, and any symbol Finnhub does not
  price. If Yahoo ever stops answering, a key keeps US quotes working. A key also adds:
  - **in the detail window**: P/E, EPS, dividend yield, beta, the next earnings date, the
    company's industry and country, its logo and a link to its website;
  - **on the key**: an amber **E** in the corner from a week before an earnings report until the
    day itself.
- **Market cap without a key** comes from Nasdaq's quote summary, for US-listed stocks only.

The key is checked with Finnhub before it is saved, then stored in the plugin's global settings
**encrypted** with a key kept in your login keychain. That keeps it out of Stream Deck profile
exports, sync folders and backups. It is not protection from other software running as you on
this Mac.

## Install

Download the latest `com.sydwaylabs.stocks.streamDeckPlugin` from the
[releases](https://github.com/sydwaylabs/stocks/releases) and double-click it.

## Development

Built from [streamdeck-kit](https://github.com/sydwaylabs/streamdeck-kit); its references are the
specification for how this plugin is put together.

```bash
npm install
ln -s "$(pwd)/com.sydwaylabs.stocks.sdPlugin" \
  "$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins/"
npx streamdeck dev      # once per machine
npm run watch           # rebuilds and restarts the plugin on save
```

| Script | |
|---|---|
| `npm run watch` | Development loop |
| `npm test` | Unit tests for `src/lib/` |
| `npm run typecheck` | `tsc --noEmit` — the build alone does not catch type errors |
| `npm run release` | typecheck → test → build → native host → pack → verify |
| `npm run icons` | Re-render the static icons from `assets/icons/*.svg` |

Logs: `com.sydwaylabs.stocks.sdPlugin/logs/com.sydwaylabs.stocks.0.log`.

## Releasing

Record changes under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) as you go, then run the
`/streamdeck-kit:sd-release` skill. It bumps both version fields, writes the release notes and runs the release
gate.

## License

Copyright Sydway Labs.
