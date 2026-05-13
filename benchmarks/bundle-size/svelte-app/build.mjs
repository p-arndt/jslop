// Bundle the Svelte 5 counter fixture with esbuild + an on-the-fly Svelte
// compiler plugin. Same bundler + minifier settings as the JSlop fixture so
// the comparison is apples-to-apples.
import { build } from "esbuild";
import { compile } from "svelte/compiler";
import { readFile, mkdir } from "node:fs/promises";
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
      const result = compile(src, {
        generate: "client",
        dev: false,
        filename: args.path,
      });
      return {
        contents: result.js.code,
        loader: "js",
        resolveDir: dirname(args.path),
      };
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
  // Svelte 5's runtime references browser globals; mark them external in case
  // esbuild trips on conditional dev-only paths.
  conditions: ["browser"],
});

const sizes = Object.entries(result.metafile.outputs)
  .map(([p, info]) => `  ${p}: ${info.bytes} bytes`)
  .join("\n");
process.stdout.write(`built svelte fixture:\n${sizes}\n`);
