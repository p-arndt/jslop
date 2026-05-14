import { test } from "node:test";
import assert from "node:assert/strict";
import { parseComponent } from "../dist/parser.js";
import { generate } from "../dist/codegen.js";
import { rewritePropExpr } from "../dist/rewrite.js";

test("rewritePropExpr: bare reactive identifier passes through (cell by reference)", () => {
  // For `value={count}` on a child component we want the child to receive the
  // cell itself, not its unwrapped value.
  assert.equal(rewritePropExpr("count", ["count"]), "count");
});

test("rewritePropExpr: assignment inside nested arrow is rewritten to .set()", () => {
  // For `oninput={e => count = Number(e.target.value)}` the assignment must be
  // rewritten or the browser throws 'Assignment to constant variable'.
  assert.equal(
    rewritePropExpr("e => count = Number(e.target.value)", ["count"]),
    "e => count.set(Number(e.target.value))"
  );
});

test("rewritePropExpr: ++ inside nested arrow is rewritten", () => {
  assert.equal(rewritePropExpr("() => count++", ["count"]), "() => count.set(count.peek() + 1)");
});

test("rewritePropExpr: bare reads inside nested arrow stay bare (so cells are forwarded as references)", () => {
  // Reading a state cell inside a callback that's being passed as a prop should
  // not get pre-evaluated at component-create time; leave it for the runtime.
  assert.equal(rewritePropExpr("() => count", ["count"]), "() => count");
});

test("component-prop arrow with assignment compiles correctly end-to-end", () => {
  const c = parseComponent(`component X {
    state count = 0
    view {
      <Slider oninput={e => count = Number(e.target.value)} />
    }
  }`);
  const out = generate(c);
  assert.match(out, /oninput.*count\.set\(Number/);
  assert.doesNotMatch(out, /oninput.*count = Number/);
});

test("multi-line array initializer parses correctly", () => {
  const c = parseComponent(`component X {
    let items = [
      { id: 1, name: "a" },
      { id: 2, name: "b" }
    ]
    state count = 0
    view { <p>{count}</p> }
  }`);
  assert.equal(c.lets.length, 1);
  assert.equal(c.lets[0].name, "items");
  assert.match(c.lets[0].init, /id: 1.*id: 2/s);
});

test("multi-line state initializer parses correctly", () => {
  const c = parseComponent(`component X {
    state user = {
      name: "ada",
      age: 36
    }
    view { <p>{user.name}</p> }
  }`);
  assert.equal(c.states.length, 1);
  assert.equal(c.states[0].name, "user");
  assert.match(c.states[0].init, /name: "ada".*age: 36/s);
});

test("state can reference let in its initializer (codegen order)", () => {
  // Previously emitted state decls before let decls; reading a let from a state
  // initializer threw 'Cannot access X before initialization' at runtime.
  const c = parseComponent(`component X {
    let preset = { hue: 320 }
    state hue = preset.hue
    view { <p>{hue}</p> }
  }`);
  const out = generate(c);
  const letIdx = out.indexOf("let preset = { hue: 320 }");
  const stateIdx = out.indexOf("const hue = cell(preset.hue)");
  assert.ok(letIdx > 0, "let decl should be present");
  assert.ok(stateIdx > 0, "state decl should be present");
  assert.ok(letIdx < stateIdx, "let must come before state");
});

test("rewrite still treats let identifiers as non-reactive", () => {
  // The let/state semantics should remain unchanged even with the new ordering.
  const c = parseComponent(`component X {
    let cache = new Map()
    state count = 0
    function inc() { cache.set("k", count); count++ }
    view { <p>{count}</p> }
  }`);
  const out = generate(c);
  assert.match(out, /count\.set\(count\.peek\(\) \+ 1\)/);
  assert.doesNotMatch(out, /cache\.peek\(\)/);
  assert.doesNotMatch(out, /cache\.set\("k"\)/);
});
