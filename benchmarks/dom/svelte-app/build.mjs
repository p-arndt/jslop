// Build the Svelte 5 row-bench fixture. Client-only mount (no SSR) — same as
// what krausest's bench does — so the comparison measures runtime perf, not
// resumability mechanics.
import { build } from "esbuild";
import { compile } from "svelte/compiler";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "dist");
await mkdir(outDir, { recursive: true });

const sveltePlugin = {
  name: "svelte",
  setup(b) {
    b.onResolve({ filter: /\.svelte$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path),
      namespace: "svelte",
    }));
    b.onLoad({ filter: /.*/, namespace: "svelte" }, async (args) => {
      const src = await readFile(args.path, "utf8");
      const result = compile(src, { generate: "client", dev: false, filename: args.path });
      return { contents: result.js.code, loader: "js", resolveDir: dirname(args.path) };
    });
  },
};

const result = await build({
  entryPoints: [resolve(here, "src/main.mjs")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  minify: true,
  treeShaking: true,
  outfile: resolve(outDir, "main.js"),
  plugins: [sveltePlugin],
  logLevel: "warning",
  metafile: true,
  conditions: ["browser"],
});

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Svelte rows bench</title>
</head>
<body>
<div id="app"></div>
<script type="module" src="./main.js"></script>
</body>
</html>`;
await writeFile(resolve(outDir, "index.html"), html);

const sizes = Object.entries(result.metafile.outputs)
  .map(([p, info]) => `  ${p}: ${info.bytes} bytes`)
  .join("\n");
process.stdout.write(`built svelte dom fixture:\n${sizes}\n`);
