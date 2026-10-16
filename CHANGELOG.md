# Changelog

Every user-visible change to Stocks, newest first. The format is
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are
[semver](https://semver.org/), and the manifest carries the four-part form described in
[the kit's conventions](https://github.com/sydwaylabs/streamdeck-kit/blob/main/references/conventions.md).

Write entries for the person using the plugin, not for the person reading the diff. The release
notes and the Marketplace "what's new" text are generated from this file.

## [Unreleased]

### Added

- **Ticker** shows a live quote for any stock, ETF, fund, index or coin: price, today's change and
  a sparkline, refreshed every 1, 5 or 15 minutes. Quotes that are more than two refreshes old are
  dimmed. Today's change can be shown as a percentage or as an amount.
- Press an empty key to search by company or fund name, so you never need to know the ticker.
- Press to refresh; hold for a window with a chart, day and 52-week ranges, volume, market cap
  and a **Change symbol** button. The chart shows today's session on its own clock — a morning
  fills the first part of it — with times in your time zone, and switches to 5 days, 1 month,
  6 months or 1 year with the buttons above it or keys 1–5.
- Works with no account or API key. An optional free Finnhub key, shared by every Stocks key, adds
  an official quote source; it is checked before saving and stored encrypted.
- With a Finnhub key, the detail window adds P/E, EPS, dividend yield, beta, the next earnings
  date, industry, country, the company logo and a website link, and the key shows an amber **E**
  in the week before an earnings report.

## [0.1.0] - 2026-10-16

### Added

- **Ticker**: first version, scaffolded from streamdeck-kit.
