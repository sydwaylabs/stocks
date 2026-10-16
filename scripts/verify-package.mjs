/**
 * Verifies a packaged .streamDeckPlugin before it is released.
 *
 * Every check here corresponds to a defect that shipped or nearly shipped, and that was only
 * caught by inspecting the archive by hand:
 *
 *   - the native host missing entirely, because `npm run build` does not build it and the plugin
 *     then falls back to a browser silently
 *   - the host present but with an invalid code signature after `lipo`
 *   - an icon referenced by the code but absent from the package, which renders as blank space
 *   - the packaged manifest version not matching the working tree
 *   - a watch build overwriting the production bundle between `build` and `pack`
 *   - the manifest and package.json naming different versions
 *   - a Property Inspector shipped blank: no component library, unlabelled buttons, or colours
 *     that resolve to black on a dark panel
 *   - a release with no CHANGELOG entry, so nothing to put in the release notes
 *
 * Exits non-zero on any failure so it can gate a release.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// ── Instantiate these three ──────────────────────────────────────────────────
const PLUGIN_DIR = "com.sydwaylabs.stocks.sdPlugin";
const ARCHIVE = "com.sydwaylabs.stocks.streamDeckPlugin";
/** Set to null if the plugin ships no native host. */
const HOST_NAME = "stocks-host";
// ─────────────────────────────────────────────────────────────────────────────

const HOST = HOST_NAME ? `${PLUGIN_DIR}/bin/${HOST_NAME}` : null;

const failures = [];
const notes = [];
const fail = (msg) => failures.push(msg);
const ok = (msg) => notes.push(`  ok    ${msg}`);

/** Lists archive entries as `path -> size`, via unzip so there is no zip dependency. */
function archiveEntries() {
    const out = execFileSync("unzip", ["-l", ARCHIVE], { encoding: "utf8" });
    const entries = new Map();
    for (const line of out.split("\n")) {
        const m = line.match(/^\s*(\d+)\s+\S+\s+\S+\s+(\S.*)$/);
        if (m && !m[2].endsWith("/")) entries.set(m[2].replace(/^[^/]+\//, ""), Number(m[1]));
    }
    return entries;
}

if (!existsSync(ARCHIVE)) {
    console.error(`verify: ${ARCHIVE} not found — run the pack step first`);
    process.exit(1);
}

const entries = archiveEntries();
const inArchive = (p) => entries.has(p);

// --- 1. version agreement ----------------------------------------------------------------------
const treeVersion = require(`../${PLUGIN_DIR}/manifest.json`).Version;
const packedVersion = JSON.parse(
    execFileSync("unzip", ["-p", ARCHIVE, `${PLUGIN_DIR}/manifest.json`], { encoding: "utf8" })
).Version;
if (treeVersion !== packedVersion) {
    fail(`packaged version ${packedVersion} does not match the working tree (${treeVersion}) — repack`);
} else {
    ok(`version ${packedVersion} matches the working tree`);
}

// --- 1b. the manifest and package.json describe the same release --------------------------------
// Two files carry the version and nothing has ever compared them. The manifest is what Stream Deck
// installs and upgrades on, and package.json is what the tag is named after — so a bump that
// misses one ships a build the app will not replace, or a tag that names a version nobody has.
// The manifest wants four parts, and Stream Deck compares all four numerically with no notion of a
// pre-release — so a final 1.2.0.0 would rank *below* its own alphas and never install over one.
// The fourth part is therefore the pre-release number (1–99), or 100 for a final:
//   1.2.0-alpha.3  →  1.2.0.3        1.2.0  →  1.2.0.100
// See references/conventions.md.
{
    const pkg = require("../package.json").version;
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-[A-Za-z]+\.(\d+))?$/.exec(pkg);
    if (m === null) {
        fail(`package.json version ${pkg} is not a shape this can check — x.y.z or x.y.z-tag.N`);
    } else if (m[4] !== undefined && (Number(m[4]) < 1 || Number(m[4]) > 99)) {
        fail(`pre-release number ${m[4]} in ${pkg} must be 1–99, or it collides with a final's .100`);
    } else {
        const expected = `${m[1]}.${m[2]}.${m[3]}.${m[4] ?? 100}`;
        if (treeVersion !== expected) {
            fail(`manifest Version ${treeVersion} does not match package.json ${pkg} — expected ${expected}`);
        } else {
            ok(`manifest ${treeVersion} agrees with package.json ${pkg}`);
        }
    }
}

// --- 2. the plugin bundle ----------------------------------------------------------------------
const bundle = "bin/plugin.js";
if (!inArchive(bundle)) {
    fail(`${bundle} missing from the package`);
} else if (entries.get(bundle) < 10_000) {
    fail(`${bundle} is only ${entries.get(bundle)} bytes — the build probably failed`);
} else {
    ok(`${bundle} present (${entries.get(bundle)} bytes)`);
}

// --- 3. the bundle is a production build -------------------------------------------------------
// `npm run watch` rebuilds unminified and with a sourcemap. If it is running during a release it
// can overwrite the production bundle between `build` and `pack`, so the package silently ships a
// dev build. Caught here rather than trusted, because nothing else would notice.
if (inArchive(bundle)) {
    const packedJs = execFileSync("unzip", ["-p", ARCHIVE, `${PLUGIN_DIR}/${bundle}`], { encoding: "utf8" });
    const lines = packedJs.split("\n").length;
    if (packedJs.includes("sourceMappingURL")) {
        fail(`${bundle} references a sourcemap — that is a watch build, not a production one. ` +
             "Stop `npm run watch` and re-run the release.");
    } else if (lines > 50) {
        fail(`${bundle} spans ${lines} lines and is not minified — likely a watch build. ` +
             "Stop `npm run watch` and re-run the release.");
    } else {
        ok("bundle is a minified production build");
    }
}

// --- 4. the native host ------------------------------------------------------------------------
// Absence is the dangerous case: the plugin falls back to a browser without complaint, so a
// release built without `npm run build:native` looks fine until someone has no browser.
if (HOST_NAME) {
    const entry = `bin/${HOST_NAME}`;
    if (!inArchive(entry)) {
        fail(`${entry} missing from the package — run \`npm run build:native\` before packing`);
    } else {
        ok(`${entry} present (${entries.get(entry)} bytes)`);

        if (!existsSync(HOST)) {
            fail(`${HOST} is in the archive but not on disk, which should be impossible`);
        } else {
            if (!(statSync(HOST).mode & 0o111)) {
                fail(`${HOST} is not executable on disk`);
            } else {
                ok("host is executable on disk");
            }
            // `lipo` does not re-sign what it produces, leaving a binary that claims adhoc but
            // fails verification. Both slices still run, yet an invalid signature blocks
            // notarization.
            try {
                execFileSync("codesign", ["--verify", HOST], { stdio: "pipe" });
                ok("host code signature verifies");
            } catch {
                fail(`${HOST} has an invalid code signature — native/build.sh should re-sign after lipo`);
            }
            try {
                const archs = execFileSync("lipo", ["-archs", HOST], { encoding: "utf8" }).trim();
                for (const want of ["arm64", "x86_64"]) {
                    if (!archs.includes(want)) fail(`host is missing the ${want} slice (has: ${archs})`);
                }
                if (archs.includes("arm64") && archs.includes("x86_64")) ok(`host is universal (${archs})`);
            } catch {
                fail("could not read host architectures");
            }
        }
    }
}

/** The packed manifest's actions, used by the inspector and layout checks below. */
const manifestActions = JSON.parse(
    execFileSync("unzip", ["-p", ARCHIVE, `${PLUGIN_DIR}/manifest.json`], { encoding: "utf8" })
).Actions ?? [];

// --- 5. every icon the *code* references is packaged --------------------------------------------
// Only the code. `streamdeck pack` already validates every icon the manifest names — Icon,
// CategoryIcon, Actions[].Icon and States[].Image — both for existing and for not being caught by
// sdignore, and refuses to pack otherwise. Verified by breaking each of them in turn. Re-checking
// them here would be a check that can never fire.
//
// What pack cannot see is a path handed to setImage, because that is a string in a bundle. Those
// are what this scans for.
//
// Two reference styles exist and mean different things:
//   - a full path ending in .png — that exact file must exist, no density lookup happens
//   - a bare base path — Stream Deck resolves the density, so at least one of .png / @2x.png
//
// Requiring both densities everywhere would be wrong: a setImage icon is a single 288×288 file.
// Hyphens must be in the character class or `release-to-clear` truncates to `release`.
//
// Finding none is not a failure. A plugin that draws its own key images references no icon path
// in code at all, and an earlier version of this check called that a broken scan and blocked the
// release.
if (inArchive(bundle)) {
    const packedBundle = execFileSync("unzip", ["-p", ARCHIVE, `${PLUGIN_DIR}/${bundle}`], { encoding: "utf8" });
    const referenced = [...new Set(
        [...packedBundle.matchAll(/imgs\/actions\/[\w/-]+(?:\.png)?/g)].map(m => m[0])
    )];
    let missingIcons = 0;
    const noRetina = [];
    for (const ref of referenced) {
        if (ref.endsWith(".png")) {
            if (!inArchive(ref)) {
                fail(`icon ${ref} is referenced by the code but not in the package`);
                missingIcons++;
            }
            continue;
        }
        const has1x = inArchive(`${ref}.png`);
        const has2x = inArchive(`${ref}@2x.png`);
        if (!has1x && !has2x) {
            fail(`icon ${ref} is referenced by the code but no .png or @2x.png is in the package`);
            missingIcons++;
        } else if (!has2x) {
            noRetina.push(ref);
        }
    }
    if (referenced.length === 0) {
        ok("no icon paths in the bundle — this plugin draws its own key images");
    } else if (missingIcons === 0) {
        ok(`all ${referenced.length} code-referenced icons resolve in the package`);
        if (noRetina.length) {
            notes.push(`  note  ${noRetina.length} icon(s) have no @2x variant: ${noRetina.join(", ")}`);
        }
    }
}

// --- 6. the Property Inspector and its component library ----------------------------------------
// sdpi-components.js is vendored rather than loaded from a CDN, so it has to actually be in the
// archive: without it the inspector renders blank, and a blank inspector looks like a broken
// plugin rather than a missing file.
//
// The inspector paths come from the manifest rather than a literal here. Several actions can share
// one inspector; a hardcoded filename in a gate went stale the moment the file was renamed, and a
// gate that checks the wrong path passes for the wrong reason.
const inspectors = [...new Set((manifestActions ?? []).map((a) => a.PropertyInspectorPath).filter(Boolean))];
if (!inspectors.length) notes.push("  note  no PropertyInspectorPath in the manifest — nothing to check");
for (const asset of [...inspectors, "ui/sdpi-components.js"]) {
    if (!inArchive(asset)) fail(`${asset} missing from the package`);
    else ok(`${asset} present`);
}

// --- 7. the inspector's buttons have labels -----------------------------------------------------
// sdpi-button renders <button><slot></slot></button>: its label is the element's own text. A
// `title` attribute only sets a tooltip, so the button ships blank — which is exactly what
// happened, and neither the build, the tests nor the release gate noticed. A blank control in the
// inspector is invisible to everything except a person looking at it.
for (const inspector of inspectors) {
    if (!inArchive(inspector)) continue;
    const html = execFileSync("unzip", ["-p", ARCHIVE, `${PLUGIN_DIR}/${inspector}`], { encoding: "utf8" });
    const blank = [...html.matchAll(/<sdpi-button\b[^>]*>\s*<\/sdpi-button>/g)];
    if (blank.length) {
        fail(`${blank.length} sdpi-button(s) in ${inspector} have no label — the text goes between the tags, not in a title attribute`);
    } else {
        const labelled = [...html.matchAll(/<sdpi-button\b[^>]*>\s*([^<]+?)\s*<\/sdpi-button>/g)];
        ok(`all ${labelled.length} buttons in ${inspector} are labelled`);
    }
}

// --- 8. a shared inspector knows every action it serves -----------------------------------------
// An inspector serving several actions chooses which fields to show by matching its own action
// UUID against a table inside it. Nothing connects that table to the manifest, and getting it
// wrong fails silently and specifically: the panel loads, the shared rows all work, and only the
// one action-specific field is quietly missing. Neither the typechecker nor the tests can see
// inside that HTML, so the check belongs here. An inspector used by one action is exempt.
for (const inspector of inspectors) {
    if (!inArchive(inspector)) continue;
    if (manifestActions.filter((a) => a.PropertyInspectorPath === inspector).length < 2) continue;
    const html = execFileSync("unzip", ["-p", ARCHIVE, `${PLUGIN_DIR}/${inspector}`], { encoding: "utf8" });
    const missing = manifestActions
        .filter((a) => a.PropertyInspectorPath === inspector)
        .map((a) => a.UUID)
        .filter((uuid) => !html.includes(uuid));
    if (missing.length) {
        fail(`${inspector} never mentions ${missing.join(", ")} — its pane table has drifted from the manifest`);
    } else {
        ok(`${inspector} accounts for every action that uses it`);
    }
}

// --- 9. rows hidden from one action name an action that exists -----------------------------------
// A shared row can opt out of an action it has no meaning for by naming that action's UUID in `data-hide-for`. Misspell it, or rename the action, and the row
// simply stops hiding: the panel still loads and still works, and the only symptom is a setting
// offered where it cannot take effect, which is what the attribute existed to prevent.
for (const inspector of inspectors) {
    if (!inArchive(inspector)) continue;
    const html = execFileSync("unzip", ["-p", ARCHIVE, `${PLUGIN_DIR}/${inspector}`], { encoding: "utf8" });
    const known = new Set(manifestActions.map((a) => a.UUID));
    const named = [...html.matchAll(/data-hide-for="([^"]+)"/g)].flatMap((m) => m[1].trim().split(/\s+/));
    const unknown = [...new Set(named)].filter((uuid) => !known.has(uuid));
    if (unknown.length) {
        fail(`${inspector} hides rows from ${unknown.join(", ")}, which no action in the manifest is called`);
    } else if (named.length) {
        ok(`all ${named.length} hidden row(s) in ${inspector} name a real action`);
    }
}

// --- 10. the inspector's own colours have fallbacks ----------------------------------------------
// `--sdpi-*` are the host's variables, and sdpi-components defines none of them — it ships no
// global stylesheet at all. Referencing one without a fallback makes the whole declaration invalid
// at computed-value time, so `color` inherits from a body nothing has styled and lands on the user
// agent's black, on a dark panel. That is invisible rather than wrong-looking, which is why it
// shipped: the text is there, and nobody can read it.
for (const inspector of inspectors) {
    if (!inArchive(inspector)) continue;
    const html = execFileSync("unzip", ["-p", ARCHIVE, `${PLUGIN_DIR}/${inspector}`], { encoding: "utf8" });
    const bare = [...html.matchAll(/var\(\s*(--(?:sdpi|font|input|window|spacer|checkbox|opacity)[a-z-]*)\s*\)/g)]
        .map((m) => m[1]);
    if (bare.length) {
        fail(`${inspector} uses ${[...new Set(bare)].join(", ")} with no fallback — sdpi-components defines none of them, so this falls back to the user agent: black text, in Times, on a dark panel`);
    } else {
        ok(`${inspector} gives every host variable a fallback`);
    }
}

// --- 11. every custom dial layout is in the package ---------------------------------------------
// An encoder action names a layout file, and a missing one is a dial that lights up black with
// nothing in any log. `streamdeck pack` validates icon paths but not this one.
//
// Only presence is checked here. Whether the *item names* inside it match what the code fills in
// belongs in a unit test that reads the layout file — the bundle is minified and ships those names
// as bare identifiers, so scanning for one here would either miss the drift or match some
// unrelated word and pass for the wrong reason.
{
    const layouts = new Set(
        manifestActions
            .map((action) => action.Encoder?.layout)
            // Built-in layouts are named $A0, $B1 and so on, and are not files.
            .filter((layout) => layout && !layout.startsWith("$"))
    );
    for (const layout of layouts) {
        if (!inArchive(layout)) fail(`the manifest declares layout ${layout}, which is not in the package`);
        else ok(`${layout} present`);
    }
}

// --- 12. the release has a CHANGELOG entry ------------------------------------------------------
// Release notes, the GitHub release and the Marketplace "what's new" text are all generated from
// this section, so a version without one ships with nothing to say. See references/release-notes.md.
{
    const pkg = require("../package.json").version;
    let changelog = null;
    try { changelog = readFileSync("CHANGELOG.md", "utf8"); } catch { /* reported below */ }
    // Guarded: a plugin adopting this gate may not have a version yet, and check 1b reports that.
    // Without it this line threw a TypeError that ended the run instead of reporting a failure.
    const heading = typeof pkg === "string"
        ? new RegExp(`^## \\[${pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`, "m")
        : null;
    if (heading === null) {
        fail("package.json has no version, so there is no CHANGELOG section to look for");
    } else if (changelog === null) {
        fail("CHANGELOG.md not found");
    } else if (!heading.test(changelog)) {
        fail(`CHANGELOG.md has no "## [${pkg}]" section — run the release notes step before packing`);
    } else {
        ok(`CHANGELOG.md has a section for ${pkg}`);
    }
}

// --- report ------------------------------------------------------------------------------------
console.log(`\nverifying ${ARCHIVE}`);
for (const n of notes) console.log(n);
if (failures.length) {
    console.error("");
    for (const f of failures) console.error(`  FAIL  ${f}`);
    console.error(`\n${failures.length} problem(s) — not fit to release\n`);
    process.exit(1);
}
console.log(`\n${notes.length} checks passed\n`);
