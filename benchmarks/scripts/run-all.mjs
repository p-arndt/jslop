// Run every benchmark sequentially. Each sub-script prints its own table and
// writes a `results.json` next to itself.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const steps = [
  { label: "Bundle size", script: "bundle-size/measure.mjs" },
  { label: "Reactivity",  script: "reactivity/run.mjs" },
];

for (const step of steps) {
  process.stdout.write(`\n=== ${step.label} ===\n`);
  const r = spawnSync(process.execPath, [resolve(root, step.script)], {
    stdio: "inherit",
  });
  if (r.status !== 0) {
    process.stderr.write(`\n${step.label} failed (exit ${r.status})\n`);
    process.exit(r.status ?? 1);
  }
}
