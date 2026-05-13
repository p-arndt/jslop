import { test } from "node:test";
import assert from "node:assert/strict";
import { parseComponent } from "../dist/parser.js";
import { generate } from "../dist/codegen.js";

test("state declaration is reactive: parsed into states[]", () => {
  const c = parseComponent(`component X {
    state count = 0
    view { <p>{count}</p> }
  }`);
  assert.deepEqual(c.states, [{ name: "count", init: "0" }]);
  assert.deepEqual(c.lets, []);
});

test("let declaration is non-reactive: parsed into lets[]", () => {
  const c = parseComponent(`component X {
    let cache = new Map()
    state count = 0
    view { <p>{count}</p> }
  }`);
  assert.deepEqual(c.lets, [{ name: "cache", init: "new Map()" }]);
  assert.deepEqual(c.states, [{ name: "count", init: "0" }]);
});

test("state codegen emits cell()", () => {
  const c = parseComponent(`component X {
    state count = 0
    view { <p>{count}</p> }
  }`);
  const out = generate(c);
  assert.match(out, /const count = cell\(0\);/);
});

test("let codegen emits plain `let` binding, not a cell()", () => {
  const c = parseComponent(`component X {
    let lastId = 0
    state count = 0
    view { <p>{count}</p> }
  }`);
  const out = generate(c);
  assert.match(out, /  let lastId = 0;/);
  // lastId must never appear as the LHS of a cell(...) assignment, nor wrapped.
  assert.doesNotMatch(out, /const\s+lastId\s*=\s*cell\(/);
  assert.doesNotMatch(out, /cell\(\s*lastId/);
});

test("let identifiers are NOT rewritten in function bodies", () => {
  const c = parseComponent(`component X {
    let lastId = 0
    state count = 0
    function inc() {
      lastId++
      count++
    }
    view { <p>{count}</p> }
  }`);
  const out = generate(c);
  assert.match(out, /lastId\+\+/);
  assert.match(out, /count\.set\(count\.peek\(\) \+ 1\)/);
  assert.doesNotMatch(out, /lastId\.set\(/);
  assert.doesNotMatch(out, /lastId\.peek\(\)/);
});

test("let identifiers are NOT rewritten in view expressions", () => {
  const c = parseComponent(`component X {
    let tag = "v1"
    state count = 0
    view { <p>{tag}: {count}</p> }
  }`);
  const out = generate(c);
  assert.match(out, /String\(tag\)/);
  assert.match(out, /String\(count\.get\(\)\)/);
});

test("serializeState covers state but not let", () => {
  const c = parseComponent(`component X {
    let cache = new Map()
    state count = 0
    view { <p>{count}</p> }
  }`);
  const out = generate(c);
  assert.match(out, /count: count\.peek\(\)/);
  assert.doesNotMatch(out, /cache: cache\.peek\(\)/);
  assert.doesNotMatch(out, /"cache" in s/);
});

test("unknown declaration mentions state and let", () => {
  assert.throws(
    () => parseComponent(`component X { bogus foo = 1; view { <p/> } }`),
    /'prop', 'state', 'let'/
  );
});
