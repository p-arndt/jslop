// Builds the browser/CDN bundles for @jslop/runtime.
// The standard `tsc` build still emits dist/index.js (used by Node tests and
// workspace consumers). This script adds three additional outputs:
//
//   dist/jslop-runtime.esm.js      — bundled ESM, unminified, source-map
//   dist/jslop-runtime.esm.min.js  — bundled ESM, minified
//   dist/jslop-runtime.global.js   — IIFE, exposes globalThis.JSlop
//   dist/jslop-runtime.global.min.js — IIFE, minified
//
// The IIFE bundles are what people get when they do
//   <script src="https://cdn.jsdelivr.net/npm/@jslop/runtime/dist/jslop-runtime.global.min.js"></script>
// and then use `JSlop.cell(0)` in a following <script> tag.

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = resolve(__dirname, "src/index.ts");
const outdir = resolve(__dirname, "dist");

const common = {
  entryPoints: [entry],
  bundle: true,
  platform: "browser",
  target: ["es2020"],
  legalComments: "none",
};

await Promise.all([
  build({ ...common, format: "esm", outfile: `${outdir}/jslop-runtime.esm.js`, sourcemap: true }),
  build({ ...common, format: "esm", outfile: `${outdir}/jslop-runtime.esm.min.js`, minify: true }),
  build({ ...common, format: "iife", globalName: "JSlop", outfile: `${outdir}/jslop-runtime.global.js`, sourcemap: true }),
  build({ ...common, format: "iife", globalName: "JSlop", outfile: `${outdir}/jslop-runtime.global.min.js`, minify: true }),
]);

console.log("[jslop-runtime] CDN bundles built");
