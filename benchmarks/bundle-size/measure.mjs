// Build both fixtures and report raw / gzip / brotli sizes side by side.
// Run with: pnpm --filter @rift/benchmarks run bench:bundle
import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

const fixtures = [
  { name: "Rift", buildScript: "rift-app/build.mjs", out: "rift-app/dist/main.js" },
  { name: "Svelte 5", buildScript: "svelte-app/build.mjs", out: "svelte-app/dist/main.js" },
];

function runBuild(script) {
  const r = spawnSync(process.execPath, [resolve(here, script)], {
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  });
  if (r.status !== 0) {
    throw new Error(`build failed: ${script}`);
  }
  return r.stdout;
}

async function measure(file) {
  const buf = await readFile(file);
  const raw = buf.byteLength;
  const gz = gzipSync(buf, { level: 9 }).byteLength;
  const br = brotliCompressSync(buf, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).byteLength;
  return { raw, gz, br };
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(2)} KiB`;
}

const rows = [];
for (const f of fixtures) {
  runBuild(f.buildScript);
  const m = await measure(resolve(here, f.out));
  rows.push({ name: f.name, ...m });
}

const baseline = rows[0];
const pad = (s, n) => s + " ".repeat(Math.max(0, n - s.length));

const lines = [];
lines.push("");
lines.push("Bundle size — counter app (same fixture in both frameworks)");
lines.push("Built with esbuild, minify=true, target=es2020, format=esm");
lines.push("");
lines.push(
  `| ${pad("Framework", 10)} | ${pad("Raw", 10)} | ${pad("Gzip", 10)} | ${pad("Brotli", 10)} | ${pad("vs Rift (gzip)", 16)} |`
);
lines.push(
  `| ${"-".repeat(10)} | ${"-".repeat(10)} | ${"-".repeat(10)} | ${"-".repeat(10)} | ${"-".repeat(16)} |`
);
for (const r of rows) {
  const ratio =
    r === baseline
      ? "1.00×"
      : `${(r.gz / baseline.gz).toFixed(2)}×`;
  lines.push(
    `| ${pad(r.name, 10)} | ${pad(fmtBytes(r.raw), 10)} | ${pad(fmtBytes(r.gz), 10)} | ${pad(fmtBytes(r.br), 10)} | ${pad(ratio, 16)} |`
  );
}
lines.push("");

process.stdout.write(lines.join("\n"));

// Emit machine-readable JSON next to this script for the run-all aggregator.
import { writeFile } from "node:fs/promises";
await writeFile(
  resolve(here, "results.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2)
);
