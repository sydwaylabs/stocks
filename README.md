# Stocks

Live stock, ETF and crypto quotes on your keys — works out of the box, with an optional free Finnhub key.

A Stream Deck plugin by Sydway Labs, for macOS 12 or later and Stream Deck 6.9 or later.

## Actions

| Action | Press | Hold |
|---|---|---|
| **Ticker** | What one press does | What a hold does |

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

Logs: `com.sydwaylabs.stocks.sdPlugin/logs/com.sydwaylabs.stocks.0.log`.

## Releasing

Record changes under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) as you go, then run the
`/streamdeck-kit:sd-release` skill. It bumps both version fields, writes the release notes and runs the release
gate.

## License

Copyright Sydway Labs.
