// Reactivity microbenchmark.
//
// Scenarios are mirrored across the two frameworks (see jslop-source.mjs and
// svelte-source.svelte.js). Each scenario allocates its primitives, runs N
// synchronous propagation steps, and tears the scope down. We measure wall
// time and report ops/sec.
//
// CAVEAT: Svelte 5's reactivity is normally compile-time and runs on a
// microtask queue. We force synchronous propagation with `flushSync()` after
// every set so the two frameworks are doing the same unit of work per
// iteration. Real Svelte apps batch automatically, which is typically faster.
//
// Run: pnpm --filter @jslop/benchmarks run bench:reactivity
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { writeFile } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const importPath = (p) => pathToFileURL(resolve(here, p)).href;

// Ensure the svelte source is compiled.
{
  const r = spawnSync(process.execPath, [resolve(here, "build-svelte.mjs")], {
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error("svelte compile failed");
}

const jslop = await import(importPath("jslop-source.mjs"));
const svelte = await import(importPath("dist/svelte-source.mjs"));

const SCENARIOS = [
  {
    id: "set-single",
    label: "1 cell × 1 effect, N sets",
    args: [50_000],
    work: (args) => args[0],
  },
  {
    id: "set-fanout",
    label: "1 cell × 100 effects, N sets",
    args: [5_000, 100],
    work: (args) => args[0] * args[1],
  },
  {
    id: "wide-reader",
    label: "100 cells × 1 reader, N sets",
    args: [10_000, 100],
    work: (args) => args[0],
  },
  {
    id: "create-dispose",
    label: "cell+effect+dispose, N cycles",
    args: [10_000],
    work: (args) => args[0],
  },
];

function bench(fn, args, work) {
  // Warmup.
  fn(...args.map((a, i) => (i === 0 ? Math.min(a, 200) : a)));
  // Three runs, take median.
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    fn(...args);
    const t1 = performance.now();
    samples.push(t1 - t0);
  }
  samples.sort((a, b) => a - b);
  const median = samples[1];
  return { ms: median, opsPerSec: work / (median / 1000) };
}

const fmt = (n) => {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return `${n.toFixed(0)}`;
};

const pad = (s, n) => String(s) + " ".repeat(Math.max(0, n - String(s).length));

const rows = [];
for (const s of SCENARIOS) {
  const w = s.work(s.args);
  const r = bench(jslop[camel(s.id)], s.args, w);
  const v = bench(svelte[camel(s.id)], s.args, w);
  rows.push({
    id: s.id,
    label: s.label,
    jslop: r,
    svelte: v,
    ratio: r.opsPerSec / v.opsPerSec,
  });
}

function camel(id) {
  switch (id) {
    case "set-single":
      return "singleCellSingleEffect";
    case "set-fanout":
      return "singleCellFanout";
    case "wide-reader":
      return "manyCellsOneReader";
    case "create-dispose":
      return "createDispose";
    default:
      throw new Error(id);
  }
}

const lines = [];
lines.push("");
lines.push("Reactivity microbenchmark");
lines.push("Synchronous propagation; Svelte uses flushSync() per set (see caveat).");
lines.push("");
lines.push(
  `| ${pad("Scenario", 34)} | ${pad("JSlop ops/s", 12)} | ${pad("Svelte ops/s", 12)} | ${pad("JSlop / Svelte", 14)} |`
);
lines.push(
  `| ${"-".repeat(34)} | ${"-".repeat(12)} | ${"-".repeat(12)} | ${"-".repeat(14)} |`
);
for (const r of rows) {
  lines.push(
    `| ${pad(r.label, 34)} | ${pad(fmt(r.jslop.opsPerSec), 12)} | ${pad(fmt(r.svelte.opsPerSec), 12)} | ${pad(r.ratio.toFixed(2) + "×", 14)} |`
  );
}
lines.push("");
process.stdout.write(lines.join("\n"));

await writeFile(
  resolve(here, "results.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2)
);
