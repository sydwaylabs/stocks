# Stocks

Live stock, ETF and crypto quotes on your keys — works out of the box, with an optional free Finnhub key.

A Stream Deck plugin by Sydway Labs, for macOS 12 or later and Stream Deck 6.9 or later.

## Actions

| Action | Press | Hold |
|---|---|---|
| **Ticker** (symbol set) | Refresh now | Open the detail window: intraday chart, day and 52-week ranges, volume, market cap, and **Change symbol** |
| **Ticker** (empty key) | Open search | Open search |

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
