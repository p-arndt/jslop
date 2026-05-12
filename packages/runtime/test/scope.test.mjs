import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cell,
  effect,
  createScope,
  runInScope,
  disposeScope,
  onCleanup,
} from "../dist/index.js";

test("effect created inside a scope is disposed when scope is disposed", () => {
  const c = cell(0);
  const scope = createScope();
  let runs = 0;
  runInScope(scope, () => {
    effect(() => {
      c.get();
      runs++;
    });
  });
  assert.equal(runs, 1);
  c.set(1);
  assert.equal(runs, 2);
  disposeScope(scope);
  c.set(2);
  // Effect should no longer fire.
  assert.equal(runs, 2);
});

test("disposing parent disposes nested child scope effects", () => {
  const c = cell(0);
  const parent = createScope();
  const child = runInScope(parent, () => {
    const inner = createScope();
    runInScope(inner, () => {
      effect(() => {
        c.get();
      });
    });
    return inner;
  });
  let extRuns = 0;
  runInScope(parent, () => {
    effect(() => {
      c.get();
      extRuns++;
    });
  });
  assert.equal(extRuns, 1);
  c.set(1);
  assert.equal(extRuns, 2);
  disposeScope(parent);
  assert.equal(child.disposed, true);
  c.set(2);
  assert.equal(extRuns, 2);
});

test("onCleanup runs when scope is disposed", () => {
  const scope = createScope();
  let cleaned = 0;
  runInScope(scope, () => {
    onCleanup(() => {
      cleaned++;
    });
  });
  assert.equal(cleaned, 0);
  disposeScope(scope);
  assert.equal(cleaned, 1);
  // Idempotent.
  disposeScope(scope);
  assert.equal(cleaned, 1);
});

test("effect outside any scope still works and returns disposer", () => {
  const c = cell(0);
  let runs = 0;
  const dispose = effect(() => {
    c.get();
    runs++;
  });
  assert.equal(runs, 1);
  c.set(1);
  assert.equal(runs, 2);
  dispose();
  c.set(2);
  assert.equal(runs, 2);
});

test("nested runInScope restores previous scope", () => {
  const a = createScope();
  const b = createScope();
  let aRuns = 0;
  let bRuns = 0;
  const c = cell(0);
  runInScope(a, () => {
    effect(() => {
      c.get();
      aRuns++;
    });
    runInScope(b, () => {
      effect(() => {
        c.get();
        bRuns++;
      });
    });
    // Back in scope a after the nested call.
    effect(() => {
      c.get();
      aRuns++;
    });
  });
  c.set(1);
  // a has 2 effects (first + third), b has 1.
  assert.equal(aRuns, 4);
  assert.equal(bRuns, 2);
  disposeScope(b);
  c.set(2);
  assert.equal(aRuns, 6);
  assert.equal(bRuns, 2);
  disposeScope(a);
  c.set(3);
  assert.equal(aRuns, 6);
});
