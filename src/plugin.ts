import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import streamDeck from "@elgato/streamdeck";

import { Ticker } from "./actions/ticker.js";

// When relaunched via `streamdeck restart`, process.cwd() may be the repo root rather than the
// sdPlugin directory, because the dev install is a symlink and relaunching resolves it. The SDK
// uses process.cwd() to find manifest.json, so fix it before any SDK call.
//
// Relative to the bundle at bin/plugin.js — change this if the output path changes.
process.chdir(join(dirname(fileURLToPath(import.meta.url)), ".."));

streamDeck.logger.setLevel("info");

// The log file is the only window into a running plugin, and it is created on the first write —
// so an empty logs/ directory and a plugin that never started look identical without this line.
streamDeck.logger.info(`Stocks starting (node ${process.version}, cwd ${process.cwd()})`);

streamDeck.actions.registerAction(new Ticker());

// Must come after every registerAction; registering afterwards silently does nothing.
streamDeck.connect();
