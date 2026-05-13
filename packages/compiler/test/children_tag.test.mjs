import { test } from "node:test";
import assert from "node:assert/strict";
import { parseComponent, parseFile } from "../dist/parser.js";
import { generate } from "../dist/codegen.js";

test("parses <children/> as kind:children", () => {
  const c = parseComponent(`component L {
    view { <main><children/></main> }
  }`);
  assert.equal(c.view.tag, "main");
  assert.equal(c.view.children.length, 1);
  assert.equal(c.view.children[0].kind, "children");
});

test("<children> rejects inner content", () => {
  assert.throws(
    () => parseComponent(`component L { view { <main><children>oops</children></main> } }`),
    /<children> must be self-closing/
  );
});

test("codegen emits children literal", () => {
  const out = generate(parseFile(`component L {
    view { <main><children/></main> }
  }`));
  assert.match(out, /\{ kind: "children" \}/);
});
