import { test } from "node:test";
import assert from "node:assert/strict";
import { parseComponent } from "../dist/parser.js";
import { generate } from "../dist/codegen.js";

test("bind:value on input synthesizes value attr + input handler", () => {
  const c = parseComponent(`component X {
    state draft = ''
    view { <input bind:value={draft} /> }
  }`);
  const root = c.view;
  assert.equal(root.tag, "input");
  assert.equal(root.attrs.value, "__prop:draft");
  assert.equal(root.events.input, "(e) => { draft = e.target.value; }");
});

test("bind:value on select uses change event", () => {
  const c = parseComponent(`component X {
    state pick = 'a'
    view { <select bind:value={pick}><option value='a'>A</option></select> }
  }`);
  assert.equal(c.view.events.change, "(e) => { pick = e.target.value; }");
  assert.equal(c.view.attrs.value, "__prop:pick");
});

test("bind:checked uses change event and reads e.target.checked", () => {
  const c = parseComponent(`component X {
    state agreed = false
    view { <input type='checkbox' bind:checked={agreed} /> }
  }`);
  assert.equal(c.view.attrs.checked, "__prop:agreed");
  assert.equal(c.view.events.change, "(e) => { agreed = e.target.checked; }");
});

test("bind: rejects unknown kinds", () => {
  assert.throws(
    () =>
      parseComponent(`component X {
        state x = ''
        view { <input bind:foo={x} /> }
      }`),
    /unsupported bind:foo/
  );
});

test("bind: conflicts with explicit attribute or handler", () => {
  assert.throws(
    () =>
      parseComponent(`component X {
        state x = ''
        view { <input value='hi' bind:value={x} /> }
      }`),
    /conflicts with explicit value/
  );
  assert.throws(
    () =>
      parseComponent(`component X {
        state x = ''
        view { <input bind:value={x} oninput={() => {}} /> }
      }`),
    /conflicts with explicit oninput/
  );
});

test("codegen emits prop bind, no String() wrap, with rewriter applied", () => {
  const c = parseComponent(`component X {
    state draft = ''
    view { <input bind:value={draft} /> }
  }`);
  const out = generate(c);
  // Read side: prop bind, no String() coercion, draft.get() in the getter.
  assert.match(
    out,
    /"value": \{ kind: "prop", get: \(\) => \(draft\.get\(\)\) \}/
  );
  // Write side: handler turns the assignment into draft.set(...).
  assert.match(
    out,
    /"input": \(\(e\) => \{ draft\.set\(e\.target\.value\); \}\)/
  );
});

test("codegen for bind:checked yields a boolean prop bind", () => {
  const c = parseComponent(`component X {
    state agreed = false
    view { <input type='checkbox' bind:checked={agreed} /> }
  }`);
  const out = generate(c);
  assert.match(
    out,
    /"checked": \{ kind: "prop", get: \(\) => \(agreed\.get\(\)\) \}/
  );
  assert.match(
    out,
    /"change": \(\(e\) => \{ agreed\.set\(e\.target\.checked\); \}\)/
  );
});
