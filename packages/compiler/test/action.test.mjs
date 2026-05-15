import { test } from "node:test";
import assert from "node:assert/strict";
import { parseComponent, parseFile } from "../dist/parser.js";
import { generate } from "../dist/codegen.js";

test("action declaration parses into ParsedComponent.actions", () => {
  const c = parseComponent(`component X {
    action create(input) {
      const { createTask } = await import("../store.js")
      return await createTask(input)
    }
    view { <p/> }
  }`);
  assert.equal(c.actions.length, 1);
  assert.equal(c.actions[0].name, "create");
  assert.equal(c.actions[0].params.trim(), "input");
  assert.match(c.actions[0].body, /createTask\(input\)/);
});

test("action with no params parses", () => {
  const c = parseComponent(`component X {
    action ping() { return "pong" }
    view { <p/> }
  }`);
  assert.equal(c.actions.length, 1);
  assert.equal(c.actions[0].params.trim(), "");
});

test("client-mode codegen emits action stubs in component scope", () => {
  const c = parseComponent(`component X {
    action create(input) { return await db.create(input) }
    view { <p/> }
  }`);
  const out = generate(c);
  // Stub binding present in create() body
  assert.match(out, /const create = async \(\.\.\.args\) =>/);
  assert.match(out, /globalThis\.__jslop_callAction/);
  // No server bodies in client output
  assert.doesNotMatch(out, /db\.create\(input\)/);
  // No __actions export in client mode
  assert.doesNotMatch(out, /export const __actions/);
});

test("ssr-mode codegen emits __actions export with real bodies", () => {
  const c = parseComponent(`component X {
    action create(input) { return await db.create(input) }
    view { <p/> }
  }`);
  const out = generate(c, { ssr: true });
  assert.match(out, /export const __actions = \{/);
  assert.match(out, /"create": async function \(input, __ctx\)/);
  assert.match(out, /db\.create\(input\)/);
  // Stubs still present too (the in-component reference uses the stub; the
  // __actions export is only invoked by the server dispatcher).
  assert.match(out, /const create = async \(\.\.\.args\) =>/);
});

test("action body sees params/url/request via prelude", () => {
  const c = parseComponent(`component X {
    action create(input) { return params.id }
    view { <p/> }
  }`);
  const out = generate(c, { ssr: true });
  assert.match(out, /const \{ params, url, request \} = __ctx/);
});

test("action with no params still emits __ctx parameter", () => {
  const c = parseComponent(`component X {
    action ping() { return "pong" }
    view { <p/> }
  }`);
  const out = generate(c, { ssr: true });
  assert.match(out, /"ping": async function \(__ctx\)/);
});

test("duplicate action name across components throws", () => {
  const file = parseFile(`component A {
    action foo() { return 1 }
    view { <p/> }
  }
  component B {
    action foo() { return 2 }
    view { <p/> }
  }`);
  assert.throws(() => generate(file), /duplicate action 'foo'/);
});

test("action is listed alongside functions in the component's actions map", () => {
  const c = parseComponent(`component X {
    function localFn() {}
    action remoteFn() { return 1 }
    view { <p/> }
  }`);
  const out = generate(c);
  // Both names appear in the `const actions = { … }` registry that powers
  // event-handler lookup.
  assert.match(out, /const actions = \{[\s\S]*localFn[\s\S]*remoteFn[\s\S]*\}/);
});

test("event handler referring to an action by name leaves the name as-is", () => {
  // The rewriter treats action stubs as plain local bindings; no .get() or
  // .set() injection should happen around them.
  const c = parseComponent(`component X {
    state count = 0
    action save(v) { return v }
    view { <button onclick={() => save(count)}>{count}</button> }
  }`);
  const out = generate(c);
  // `save` left bare; `count` rewritten to a reactive read (peek inside event
  // handlers, so the handler doesn't subscribe).
  assert.match(out, /save\(count\.(get|peek)\(\)\)/);
});

test("client mode elides imports only used inside action bodies", () => {
  const out = generate(
    parseFile(`import { createTask } from "../store.js"
    import { redirect } from "@jslop/runtime"
    component X {
      action create(input) { return await createTask(input) }
      action remove() { redirect("/") }
      view { <p/> }
    }`),
    { ssr: false }
  );
  // Server-only import gone from the client bundle.
  assert.doesNotMatch(out, /from "\.\.\/store\.js"/);
  // `redirect` from runtime is similarly server-only here.
  assert.doesNotMatch(out, /import \{ redirect \} from "@jslop\/runtime"/);
});

test("ssr mode keeps server-only imports intact", () => {
  const out = generate(
    parseFile(`import { createTask } from "../store.js"
    component X {
      action create(input) { return await createTask(input) }
      view { <p/> }
    }`),
    { ssr: true }
  );
  assert.match(out, /from "\.\.\/store\.js"/);
});

test("client mode keeps imports used in event handlers", () => {
  const out = generate(
    parseFile(`import { greet } from "./util.js"
    component X {
      action save() { return 1 }
      function click() { greet("hi") }
      view { <button onclick={click}/> }
    }`),
    { ssr: false }
  );
  assert.match(out, /from "\.\/util\.js"/);
});

test("partial elision: drop named specifiers used only server-side, keep the rest", () => {
  const out = generate(
    parseFile(`import { a, b } from "./mod.js"
    component X {
      state s = a()
      action srv() { return b() }
      view { <p>{s}</p> }
    }`),
    { ssr: false }
  );
  // a kept (state init), b dropped (only in action body).
  assert.match(out, /import \{ a \} from "\.\/mod\.js"/);
  assert.doesNotMatch(out, /\{ a, b \}/);
  assert.doesNotMatch(out, /\bb\b.*from "\.\/mod\.js"/);
});

test("action with no args parses with newlines between body statements", () => {
  const c = parseComponent(`component X {
    action complex() {
      const x = 1
      const y = 2
      return x + y
    }
    view { <p/> }
  }`);
  assert.equal(c.actions.length, 1);
  assert.match(c.actions[0].body, /const x = 1/);
  assert.match(c.actions[0].body, /const y = 2/);
});
