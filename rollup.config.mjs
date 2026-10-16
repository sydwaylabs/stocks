import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import path from "node:path";
import url from "node:url";

const isWatching = !!process.env.ROLLUP_WATCH;

/** The only line to change when instantiating this template. */
const sdPlugin = "com.sydwaylabs.stocks.sdPlugin";

/** @type {import('rollup').RollupOptions} */
const config = {
	input: "src/plugin.ts",
	output: {
		file: `${sdPlugin}/bin/plugin.js`,
		// Maps in development, never in a release — verify-package.mjs rejects a bundle that
		// references one, since that means a watch build leaked into the archive.
		sourcemap: isWatching,
		sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
			return url.pathToFileURL(path.resolve(path.dirname(sourcemapPath), relativeSourcePath)).href;
		}
	},
	plugins: [
		{
			// Without this, editing manifest.json triggers no rebuild and appears to do nothing.
			name: "watch-externals",
			buildStart: function () {
				this.addWatchFile(`${sdPlugin}/manifest.json`);
			},
		},
		typescript({
			mapRoot: isWatching ? "./" : undefined
		}),
		nodeResolve({
			// This runs in Node, not a browser. Getting it wrong pulls browser builds of deps.
			browser: false,
			exportConditions: ["node"],
			// Leaves fs/http/crypto external. No hand-maintained `external` array needed.
			preferBuiltins: true
		}),
		commonjs(),
		!isWatching && terser(),
		{
			// Output is ESM. Without this Node parses it as CommonJS and the plugin never starts.
			name: "emit-module-package-file",
			generateBundle() {
				this.emitFile({ fileName: "package.json", source: `{ "type": "module" }`, type: "asset" });
			}
		}
	]
};

export default config;
