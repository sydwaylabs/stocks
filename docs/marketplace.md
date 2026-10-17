# Stocks — Marketplace listing

Copy for the Elgato Maker Console. Everything below the rule is the listing text; the notes here
are for whoever fills the form in. See the kit's `references/marketplace.md`.

- **Name**: Stocks
- **Author**: Sydway Labs
- **Short description**: use the manifest's own `Description`, so the store and the app agree.
- **Platform**: macOS 12 or later. Say so early; there is no Windows build.
- **Stream Deck**: 6.9 or later.
- **Screenshots to take**: a row of Ticker keys (a stock, an ETF, a coin, one red, one green); the search window mid-search for "vanguard"; the detail window for AAPL showing chart, ranges and market cap; the inspector's Finnhub section.
- **Hardware claims**: keys only (Keypad). No dial or touchscreen support.

Keep this in step with the README when behaviour changes.

---

## Stocks

**Live quotes for the stocks, funds and coins you watch, one per key — no account needed.**

### Find it by name

Press an empty key and type what you are looking for: "apple", "vanguard s&p", "bitcoin". Pick a
result and the key starts quoting. Stocks, ETFs, mutual funds, indices and crypto, on exchanges
around the world.

### See the day at a glance

Each key shows the price, today's change in green or red, and a sparkline of the session. Press to
refresh now; **hold** for a window with a larger chart, the day and 52-week ranges, volume and
market cap, and a button to change the symbol.

### Keep an eye on more with less

**Watchlist** puts up to twelve symbols on one key — press for the next, or let it rotate.
**Price Alert** turns its key amber when a stock reaches your price, moves a percentage in a day,
or hits a new 52-week high or low, and keeps watching while you work in another folder.

### Works out of the box

Quotes come from Yahoo Finance with no sign-up. Add a free Finnhub key once, in any key's settings,
for an official second source — it is checked before saving and stored encrypted.

### Requirements

- macOS 12 or later. **This plugin is macOS only.**
- An internet connection. Quotes may be delayed by the exchange or the data source; not for trading decisions.
- Stream Deck 6.9 or later.
