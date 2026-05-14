import { test } from "node:test";
import assert from "node:assert/strict";
import { parseComponent } from "../dist/parser.js";
import { generate } from "../dist/codegen.js";

test("derived parses into deriveds[]", () => {
  const c = parseComponent(`component X {
    state n = 1
    derived doubled = n * 2
    view { <p>{doubled}</p> }
  }`);
  assert.deepEqual(c.deriveds, [{ name: "doubled", init: "n * 2" }]);
});

test("derived codegen emits derived(() => ...) with dep reads rewritten", () => {
  const c = parseComponent(`component X {
    state n = 1
    derived doubled = n * 2
    view { <p>{doubled}</p> }
  }`);
  const out = generate(c);
  assert.match(out, /const doubled = derived\(\(\) => \(n\.get\(\) \* 2\)\);/);
  // and reading `doubled` in view goes through .get() like any reactive
  assert.match(out, /String\(doubled\.get\(\)\)/);
});

test("derived referencing another derived works", () => {
  const c = parseComponent(`component X {
    state n = 1
    derived doubled = n * 2
    derived quad = doubled * 2
    view { <p>{quad}</p> }
  }`);
  const out = generate(c);
  assert.match(out, /const quad = derived\(\(\) => \(doubled\.get\(\) \* 2\)\);/);
});

test("multi-line derived init is preserved", () => {
  const c = parseComponent(`component X {
    state items = []
    derived total = items.reduce(
      (acc, it) => acc + it.cost,
      0
    )
    view { <p>{total}</p> }
  }`);
  assert.equal(c.deriveds.length, 1);
  assert.match(c.deriveds[0].init, /reduce/);
  assert.match(c.deriveds[0].init, /acc \+ it\.cost/);
});
