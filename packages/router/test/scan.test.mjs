import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanRoutes, matchRoute } from "../dist/index.js";

async function makeTree(spec) {
  const root = await mkdtemp(join(tmpdir(), "jslop-router-"));
  for (const [rel, content] of Object.entries(spec)) {
    const full = join(root, rel);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content);
  }
  return root;
}

test("scans routes, layouts, and 404", async () => {
  const dir = await makeTree({
    "index.jslop": "",
    "about.jslop": "",
    "posts/[slug].jslop": "",
    "_layout.jslop": "",
    "_404.jslop": "",
    "dashboard/index.jslop": "",
    "dashboard/settings.jslop": "",
    "dashboard/_layout.jslop": "",
  });
  const m = await scanRoutes(dir);
  assert.equal(m.routes.length, 5);
  assert.equal(m.layouts.length, 2);
  assert.ok(m.notFound, "expected _404 to be picked up");
  assert.equal(m.notFound.relPath, "_404.jslop");

  const dashSettings = m.routes.find((r) => r.relPath === "dashboard/settings.jslop");
  assert.ok(dashSettings);
  // Outer layout first, then nested layout.
  assert.deepEqual(dashSettings.layouts, ["_layout.jslop", "dashboard/_layout.jslop"]);

  const about = m.routes.find((r) => r.relPath === "about.jslop");
  assert.deepEqual(about.layouts, ["_layout.jslop"]);
});

test("non-root _404.jslop is ignored", async () => {
  const dir = await makeTree({
    "index.jslop": "",
    "dashboard/_404.jslop": "",
  });
  const m = await scanRoutes(dir);
  assert.equal(m.notFound, null);
});

test("files starting with _ that aren't layout/404 are skipped", async () => {
  const dir = await makeTree({
    "index.jslop": "",
    "_helper.jslop": "",
  });
  const m = await scanRoutes(dir);
  assert.equal(m.routes.length, 1);
});

test("matchRoute still works with new manifest", async () => {
  const dir = await makeTree({
    "index.jslop": "",
    "posts/[slug].jslop": "",
  });
  const m = await scanRoutes(dir);
  const match = matchRoute("/posts/hello", m.routes);
  assert.ok(match);
  assert.equal(match.params.slug, "hello");
});
