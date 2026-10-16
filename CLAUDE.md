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

<!-- What is specific to this plugin: its actions, its settings, anything learned the hard way.
     When something here would apply to every plugin, fold it back into the kit with /streamdeck-kit:sd-harvest. -->
