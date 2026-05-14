import { test } from "node:test";
import assert from "node:assert/strict";
import { parseComponent } from "../dist/parser.js";
import { generate } from "../dist/codegen.js";

test("head block parses into ParsedComponent.head", () => {
  const c = parseComponent(`component X {
    state title = "hi"
    head {
      <title>{title}</title>
      <meta name="description" content="static"/>
    }
    view { <p>{title}</p> }
  }`);
  assert.equal(c.head?.length, 2);
  assert.equal(c.head?.[0]?.kind, "element");
  assert.equal(c.head?.[0]?.tag, "title");
});

test("head codegen emits buildHead() with reactive reads", () => {
  const c = parseComponent(`component X {
    state title = "hi"
    head {
      <title>{title}</title>
    }
    view { <p/> }
  }`);
  const out = generate(c);
  assert.match(out, /function buildHead\(\)/);
  assert.match(out, /String\(title\.get\(\)\)/);
});

test("component without head still exposes buildHead returning []", () => {
  const c = parseComponent(`component X {
    view { <p/> }
  }`);
  const out = generate(c);
  assert.match(out, /function buildHead\(\)\s*\{\s*return \[\];\s*\}/);
});
