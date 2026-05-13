import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanRoutes, matchRoute } from "../dist/index.js";

async function makeTree(spec) {
  const root = await mkdtemp(join(tmpdir(), "rift-router-"));
  for (const [rel, content] of Object.entries(spec)) {
    const full = join(root, rel);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content);
  }
  return root;
}

test("scans routes, layouts, and 404", async () => {
  const dir = await makeTree({
    "index.rift": "",
    "about.rift": "",
    "posts/[slug].rift": "",
    "_layout.rift": "",
    "_404.rift": "",
    "dashboard/index.rift": "",
    "dashboard/settings.rift": "",
    "dashboard/_layout.rift": "",
  });
  const m = await scanRoutes(dir);
  assert.equal(m.routes.length, 5);
  assert.equal(m.layouts.length, 2);
  assert.ok(m.notFound, "expected _404 to be picked up");
  assert.equal(m.notFound.relPath, "_404.rift");

  const dashSettings = m.routes.find((r) => r.relPath === "dashboard/settings.rift");
  assert.ok(dashSettings);
  // Outer layout first, then nested layout.
  assert.deepEqual(dashSettings.layouts, ["_layout.rift", "dashboard/_layout.rift"]);

  const about = m.routes.find((r) => r.relPath === "about.rift");
  assert.deepEqual(about.layouts, ["_layout.rift"]);
});

test("non-root _404.rift is ignored", async () => {
  const dir = await makeTree({
    "index.rift": "",
    "dashboard/_404.rift": "",
  });
  const m = await scanRoutes(dir);
  assert.equal(m.notFound, null);
});

test("files starting with _ that aren't layout/404 are skipped", async () => {
  const dir = await makeTree({
    "index.rift": "",
    "_helper.rift": "",
  });
  const m = await scanRoutes(dir);
  assert.equal(m.routes.length, 1);
});

test("matchRoute still works with new manifest", async () => {
  const dir = await makeTree({
    "index.rift": "",
    "posts/[slug].rift": "",
  });
  const m = await scanRoutes(dir);
  const match = matchRoute("/posts/hello", m.routes);
  assert.ok(match);
  assert.equal(match.params.slug, "hello");
});
