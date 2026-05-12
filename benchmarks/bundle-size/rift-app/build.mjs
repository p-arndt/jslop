// Bundle the Rift counter fixture as if a real production build existed.
// Strategy: esbuild + a tiny on-the-fly plugin that calls @rift/compiler on
// every .rift import. Output is minified ESM, treeshaken, single file.
import { build } from "esbuild";
import { compile } from "@rift/compiler";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, extname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "dist");
await mkdir(outDir, { recursive: true });

const riftPlugin = {
  name: "rift",
  setup(b) {
    // Resolve .rift imports (with or without extension after compiler rewrite).
    b.onResolve({ filter: /\.rift$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path),
      namespace: "rift",
    }));
    b.onLoad({ filter: /.*/, namespace: "rift" }, async (args) => {
      const src = await readFile(args.path, "utf8");
      // Tell the codegen to keep .rift in import specifiers so the resolver
      // above keeps catching transitive imports.
      const js = compile(src, { compiledExtension: ".rift" });
      return {
        contents: js,
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
  plugins: [riftPlugin],
  logLevel: "warning",
  metafile: true,
});

const sizes = Object.entries(result.metafile.outputs)
  .map(([p, info]) => `  ${p}: ${info.bytes} bytes`)
  .join("\n");
process.stdout.write(`built rift fixture:\n${sizes}\n`);
