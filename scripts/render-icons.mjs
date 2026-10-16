/**
 * Renders the plugin's static icons from SVG sources at both densities.
 *
 *   npm run icons      ("icons": "node scripts/render-icons.mjs")
 *
 * The PNGs are committed — they are assets, not build products — so this runs when the artwork
 * changes, not on every build. Sources live in assets/icons/ and are committed too.
 *
 * Every icon ships twice, `<path>.png` and `<path>@2x.png`: a key or action icon without the @2x is
 * visibly soft on every Retina display, and nothing warns about it. Sizes are the house ones from
 * references/conventions.md.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const PLUGIN_DIR = "com.sydwaylabs.stocks.sdPlugin";
const SOURCES = "assets/icons";

/** `path` is relative to the sdPlugin directory, extension omitted — exactly as the manifest names it. */
const ICONS = [
    { src: "marketplace.svg", path: "imgs/plugin/marketplace", size: 288 },
    // Elgato's spec: monochrome #FFFFFF on transparent.
    { src: "category.svg", path: "imgs/plugin/category", size: 28 },
    { src: "ticker-icon.svg", path: "imgs/actions/ticker/icon", size: 72 },
    // Shown only until the plugin draws the key; the plugin draws every state itself.
    { src: "ticker-key.svg", path: "imgs/actions/ticker/key", size: 72 },
];

for (const icon of ICONS) {
    mkdirSync(dirname(join(PLUGIN_DIR, icon.path)), { recursive: true });
    for (const [suffix, scale] of [["", 1], ["@2x", 2]]) {
        const out = join(PLUGIN_DIR, `${icon.path}${suffix}.png`);
        execFileSync("swift", ["scripts/svg2png.swift", join(SOURCES, icon.src), out, String(icon.size * scale)], {
            stdio: ["ignore", "ignore", "inherit"],
        });
        console.log(`  ${out}  ${icon.size * scale}×${icon.size * scale}`);
    }
}
