// DOM benchmark: real Chromium, real layout, real paint. Each operation is
// driven by a button click inside the framework's own event system, so what
// we time is the full click → reactive update → DOM mutation → next-frame
// cycle (the slice a user perceives as latency).
//
// Caveats:
//  - System Chrome under Playwright. CPU throttling, GC, and background tabs
//    affect numbers; close other apps for a clean read.
//  - 1 warmup iteration is discarded; 5 timed runs per op; median reported.
//  - "Append 1k" runs after a fresh "create 10k", so its baseline is 10k rows.
//  - All ops include one rAF after the synchronous handler so layout/paint
//    cost is included — that's what users feel.
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, extname } from "node:path";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));

// --- 1. Build both fixtures -------------------------------------------------
for (const app of ["jslop-app", "svelte-app"]) {
  const r = spawnSync(process.execPath, [resolve(here, app, "build.mjs")], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (r.status !== 0) throw new Error(`${app} build failed`);
}

// --- 2. Tiny static server --------------------------------------------------
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css" };
const server = createServer(async (req, res) => {
  // URL shape: /jslop/... or /svelte/... → dom/{jslop|svelte}-app/dist/...
  const url = new URL(req.url, "http://localhost");
  const m = url.pathname.match(/^\/(jslop|svelte)(\/.*)?$/);
  if (!m) { res.statusCode = 404; res.end("not found"); return; }
  const app = m[1] === "jslop" ? "jslop-app" : "svelte-app";
  let p = m[2] ?? "/";
  if (p === "/" || p === "") p = "/index.html";
  try {
    const buf = await readFile(resolve(here, app, "dist", "." + p));
    res.setHeader("content-type", MIME[extname(p)] ?? "application/octet-stream");
    res.end(buf);
  } catch {
    res.statusCode = 404; res.end("not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const BASE = `http://127.0.0.1:${port}`;

// --- 3. Bench harness ------------------------------------------------------
// Run inside the page: click a button, wait for the next frame, return ms.
// Each call returns the synchronous handler+commit time AND the rAF time so
// we can report both "JS time" and "JS + paint" separately if useful.
const HARNESS = `
window.__bench_op = async (selector) => {
  const btn = document.querySelector(selector);
  if (!btn) throw new Error("missing button " + selector);
  const t0 = performance.now();
  btn.click();
  const t1 = performance.now();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const t2 = performance.now();
  return { js: t1 - t0, total: t2 - t0 };
};
window.__bench_count = () => document.querySelectorAll("#rows .row").length;
window.__bench_selectFirst = async () => {
  const a = document.querySelector("#rows .row .col-label a");
  if (!a) throw new Error("no rows to select");
  const t0 = performance.now();
  a.click();
  const t1 = performance.now();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { js: t1 - t0, total: performance.now() - t0 };
};
window.__bench_removeFirst = async () => {
  const x = document.querySelector("#rows .row .col-remove button");
  if (!x) throw new Error("no rows to remove");
  const t0 = performance.now();
  x.click();
  const t1 = performance.now();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { js: t1 - t0, total: performance.now() - t0 };
};
`;

const RUNS = 5;
const WARMUP = 1;

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function timeOp(page, label, prepare, op) {
  const totals = [];
  const jss = [];
  for (let i = 0; i < WARMUP + RUNS; i++) {
    if (prepare) await prepare(page);
    const r = await page.evaluate(op);
    if (i >= WARMUP) { totals.push(r.total); jss.push(r.js); }
  }
  return { label, js: median(jss), total: median(totals) };
}

// Operations. `prepare` resets the page to a known state before each iteration
// so we don't measure the cumulative effect of N earlier ops.
const OPS = [
  {
    label: "create 1k",
    prepare: (p) => p.evaluate(`document.querySelector("#run-clear").click()`),
    op: `window.__bench_op("#run-create-1k")`,
  },
  {
    label: "create 10k",
    prepare: (p) => p.evaluate(`document.querySelector("#run-clear").click()`),
    op: `window.__bench_op("#run-create-10k")`,
  },
  {
    label: "append 1k to 10k",
    prepare: async (p) => {
      await p.evaluate(`document.querySelector("#run-clear").click()`);
      await p.evaluate(`window.__bench_op("#run-create-10k")`);
    },
    op: `window.__bench_op("#run-append-1k")`,
  },
  {
    label: "update every 10th (1k)",
    prepare: async (p) => {
      await p.evaluate(`document.querySelector("#run-clear").click()`);
      await p.evaluate(`window.__bench_op("#run-create-1k")`);
    },
    op: `window.__bench_op("#run-update-10")`,
  },
  {
    label: "swap 2 (in 1k)",
    prepare: async (p) => {
      await p.evaluate(`document.querySelector("#run-clear").click()`);
      await p.evaluate(`window.__bench_op("#run-create-1k")`);
    },
    op: `window.__bench_op("#run-swap")`,
  },
  {
    label: "select first row",
    prepare: async (p) => {
      await p.evaluate(`document.querySelector("#run-clear").click()`);
      await p.evaluate(`window.__bench_op("#run-create-1k")`);
    },
    op: `window.__bench_selectFirst()`,
  },
  {
    label: "remove first row (1k)",
    prepare: async (p) => {
      await p.evaluate(`document.querySelector("#run-clear").click()`);
      await p.evaluate(`window.__bench_op("#run-create-1k")`);
    },
    op: `window.__bench_removeFirst()`,
  },
  {
    label: "clear 10k",
    prepare: async (p) => {
      await p.evaluate(`document.querySelector("#run-clear").click()`);
      await p.evaluate(`window.__bench_op("#run-create-10k")`);
    },
    op: `window.__bench_op("#run-clear")`,
  },
];

async function runFramework(browser, url) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => process.stderr.write(`[${url}] pageerror: ${e.message}\n`));
  await page.goto(url, { waitUntil: "load" });
  await page.evaluate(HARNESS);
  // Make sure the boot has installed handlers (jslop boots on script load).
  await page.waitForSelector("#run-create-1k");
  // Sanity: click create-1k once and verify rows appeared. Catches "framework
  // booted but reactivity is broken" before we spend N×iterations measuring
  // nothing.
  const sanity = await page.evaluate(`(async () => {
    document.querySelector("#run-create-1k").click();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return document.querySelectorAll("#rows .row").length;
  })()`);
  if (sanity < 1) throw new Error("sanity check: " + url + " produced " + sanity + " rows after create-1k");
  await page.evaluate(`document.querySelector("#run-clear").click()`);
  const results = [];
  for (const { label, prepare, op } of OPS) {
    results.push(await timeOp(page, label, prepare, op));
  }
  await page.close();
  return results;
}

const browser = await chromium.launch({ headless: true });
const jslop = await runFramework(browser, BASE + "/jslop/");
const svelte = await runFramework(browser, BASE + "/svelte/");
await browser.close();
server.close();

// --- 4. Report --------------------------------------------------------------
const fmt = (n) => n.toFixed(2);
const pad = (s, n) => String(s) + " ".repeat(Math.max(0, n - String(s).length));

const lines = [];
lines.push("");
lines.push("DOM benchmark (Playwright + Chromium headless)");
lines.push(`${RUNS} timed runs per op (median), 1 warmup discarded. Times include click → handler → rAF → rAF.`);
lines.push("");
lines.push(`| ${pad("Operation", 22)} | ${pad("JSlop ms", 10)} | ${pad("Svelte ms", 10)} | ${pad("Svelte / JSlop", 14)} |`);
lines.push(`| ${"-".repeat(22)} | ${"-".repeat(10)} | ${"-".repeat(10)} | ${"-".repeat(14)} |`);
for (let i = 0; i < jslop.length; i++) {
  const j = jslop[i];
  const s = svelte[i];
  const ratio = s.total / j.total;
  lines.push(`| ${pad(j.label, 22)} | ${pad(fmt(j.total), 10)} | ${pad(fmt(s.total), 10)} | ${pad(fmt(ratio) + "×", 14)} |`);
}
lines.push("");
process.stdout.write(lines.join("\n"));

await writeFile(resolve(here, "results.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  runs: RUNS, warmup: WARMUP,
  jslop, svelte,
}, null, 2));
