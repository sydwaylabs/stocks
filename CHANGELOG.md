# Changelog

Every user-visible change to Stocks, newest first. The format is
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are
[semver](https://semver.org/), and the manifest carries the four-part form described in
[the kit's conventions](https://github.com/sydwaylabs/streamdeck-kit/blob/main/references/conventions.md).

Write entries for the person using the plugin, not for the person reading the diff. The release
notes and the Marketplace "what's new" text are generated from this file.

## [Unreleased]

### Added

- **Watchlist**: up to 12 symbols on one key. Press for the next; hold for a board with a row per
  symbol — price, move and the day's line — where a row opens in place to its chart and stats,
  can be put on the key or removed, and can be dragged (or moved with ⌥↑ / ⌥↓) to reorder. Click a change to switch the whole board,
  and the key, between % and the amount. Optional rotation
  every 5, 10 or 30 seconds. Add symbols by typing them or with search, which stays open
  to add several.
- **Price Alert**: turns its key amber, pulsing, when a symbol rises or falls to a price, moves a
  percentage today, or reaches a new 52-week high or low. Press to clear it; it watches again once
  the price moves back past the line, and keeps watching while its folder is closed. Set it in
  the key's settings or in its window, where a click on the chart picks the price. When it fires,
  the window opens too, without taking the keyboard; turn **Open the window** off for key only.
  Remove an alert from its window with the trash button.

### Fixed

- A key whose window had been open while it was redrawn (switching folders, an alert firing)
  ignored every hold afterwards, so its window could not be opened again.

- **Ticker** shows a live quote for any stock, ETF, fund, index or coin: price, today's change and
  a sparkline, refreshed every 1, 5 or 15 minutes. Quotes that are more than two refreshes old are
  dimmed. Today's change can be shown as a percentage or as an amount.
- Press an empty key to search by company or fund name, so you never need to know the ticker.
- Hover a figure's label in the window — Beta, P/E, Market cap and the rest — for what it means.
- Press to refresh; hold for a window with a chart, day and 52-week ranges, volume, market cap
  and a **Change symbol** button. The chart shows today's session on its own clock — a morning
  fills the first part of it — with times in your time zone, and switches to 5 days, 1 month,
  6 months, year to date or 1 year with the buttons above it or keys 1–6; the change under the price follows
  the range shown. Hover over it for the price, time and
  change at any point.
- Works with no account or API key. An optional free Finnhub key, shared by every Stocks key, adds
  an official quote source; it is checked before saving and stored encrypted.
- The detail window leads with the company's logo as a large tile — or its initial when there is
  no logo, so every symbol gets the same header.
- With a Finnhub key, the detail window adds P/E, EPS, dividend yield, beta, the next earnings
  date, industry, country, the company logo and a website link, and the key shows an amber **E**
  in the week before an earnings report.

## [0.1.0] - 2026-10-16

### Added

- **Ticker**: first version, scaffolded from streamdeck-kit.
