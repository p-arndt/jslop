import { test } from "node:test";
import assert from "node:assert/strict";
import { parseComponent } from "../dist/parser.js";
import { generate } from "../dist/codegen.js";

test("load block parses into ParsedComponent.load", () => {
  const c = parseComponent(`component X {
    prop slug = ""
    load {
      const data = await fetch(slug)
      if (!data) notFound()
      return { data }
    }
    view { <p/> }
  }`);
  assert.match(c.load ?? "", /await fetch\(slug\)/);
  assert.match(c.load ?? "", /notFound\(\)/);
});

test("load codegen emits exported async function with params", () => {
  const c = parseComponent(`component X {
    load { return { hello: "world" } }
    view { <p/> }
  }`);
  const out = generate(c);
  assert.match(out, /export async function load\(\{ params, url \}\)/);
  assert.match(out, /return \{ hello: "world" \}/);
});

test("notFound is auto-imported from runtime", () => {
  const c = parseComponent(`component X {
    load { notFound() }
    view { <p/> }
  }`);
  const out = generate(c);
  assert.match(out, /import \{ [^}]*\bnotFound\b[^}]*\} from "@jslop\/runtime"/);
});

test("component without load emits no load function", () => {
  const c = parseComponent(`component X { view { <p/> } }`);
  const out = generate(c);
  assert.doesNotMatch(out, /export async function load/);
});
