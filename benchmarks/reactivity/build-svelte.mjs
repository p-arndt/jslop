// Compile + bundle the svelte-source.svelte.js (runes outside a component) into
// a single ESM module that can be imported from Node.
import { build } from "esbuild";
import { compile, compileModule } from "svelte/compiler";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
await mkdir(resolve(here, "dist"), { recursive: true });

const sveltePlugin = {
  name: "svelte",
  setup(b) {
    b.onResolve({ filter: /\.svelte$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path),
      namespace: "svelte-component",
    }));
    b.onLoad({ filter: /.*/, namespace: "svelte-component" }, async (args) => {
      const src = await readFile(args.path, "utf8");
      const result = compile(src, {
        generate: "client",
        dev: false,
        filename: args.path,
      });
      return { contents: result.js.code, loader: "js", resolveDir: dirname(args.path) };
    });
    // `.svelte.js` files: runes outside a component. Use compileModule.
    b.onLoad({ filter: /\.svelte\.js$/ }, async (args) => {
      const src = await readFile(args.path, "utf8");
      const result = compileModule(src, {
        generate: "client",
        dev: false,
        filename: args.path,
      });
      return { contents: result.js.code, loader: "js" };
    });
  },
};

await build({
  entryPoints: [resolve(here, "svelte-source.svelte.js")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  // Allow Svelte's internal client to be imported; resolve from this dir.
  mainFields: ["module", "main"],
  conditions: ["browser", "module", "import"],
  target: "es2022",
  outfile: resolve(here, "dist/svelte-source.mjs"),
  plugins: [sveltePlugin],
  logLevel: "warning",
});

process.stdout.write("compiled svelte source to dist/svelte-source.mjs\n");
