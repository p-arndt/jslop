// Compiles RowsApp.jslop, SSRs the initial (empty) page via @jslop/server,
// and bundles the client boot module with esbuild. Output:
//   dist/index.html     SSR shell + capsule
//   dist/main.js        client bundle that boot()s on load
import { build } from "esbuild";
import { compile } from "@jslop/compiler";
import { renderPage } from "@jslop/server";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "dist");
await mkdir(outDir, { recursive: true });

// Plugin: compile .jslop on the fly so RowsApp imports work both for the
// client bundle below and the SSR step (we round-trip through a temp .mjs
// file because @jslop/server expects a JS-callable component object).
const jslopPlugin = {
  name: "jslop",
  setup(b) {
    b.onResolve({ filter: /\.jslop$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path),
      namespace: "jslop",
    }));
    b.onLoad({ filter: /.*/, namespace: "jslop" }, async (args) => {
      const src = await readFile(args.path, "utf8");
      const js = compile(src, { compiledExtension: ".jslop" });
      return { contents: js, loader: "js", resolveDir: dirname(args.path) };
    });
  },
};

// --- SSR step ---------------------------------------------------------------
// Compile RowsApp.jslop to a temp JS module, dynamic-import it, and feed the
// resulting component to renderPage. The compiled JS imports @jslop/runtime
// from node_modules (resolved by Node), so no bundling needed for SSR.
const rowsAppSrc = await readFile(resolve(here, "src/RowsApp.jslop"), "utf8");
const compiledTmp = resolve(here, "dist/_RowsApp.tmp.mjs");
await writeFile(compiledTmp, compile(rowsAppSrc, { compiledExtension: ".js" }));
const { default: RowsApp } = await import(pathToFileURL(compiledTmp).href);

const html = renderPage({
  title: "JSlop rows bench",
  component: RowsApp,
  appScriptUrl: "./main.js",
});
await writeFile(resolve(outDir, "index.html"), html);

// --- client bundle ----------------------------------------------------------
const result = await build({
  entryPoints: [resolve(here, "src/main.mjs")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  minify: true,
  treeShaking: true,
  outfile: resolve(outDir, "main.js"),
  plugins: [jslopPlugin],
  logLevel: "warning",
  metafile: true,
});

const sizes = Object.entries(result.metafile.outputs)
  .map(([p, info]) => `  ${p}: ${info.bytes} bytes`)
  .join("\n");
process.stdout.write(`built jslop dom fixture:\n${sizes}\n`);
