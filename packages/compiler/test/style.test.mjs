import { test } from "node:test";
import assert from "node:assert/strict";
import { parseComponent } from "../dist/parser.js";
import { generate } from "../dist/codegen.js";

test("style block parses into ParsedComponent.style", () => {
  const c = parseComponent(`component X {
    style {
      .row { color: red; }
    }
    view { <div class="row">hi</div> }
  }`);
  assert.match(c.style ?? "", /\.row \{ color: red; \}/);
});

test("style codegen emits registerStyles with scoped selectors", () => {
  const c = parseComponent(`component X {
    style { .row { color: red; } }
    view { <div class="row">hi</div> }
  }`);
  const out = generate(c);
  assert.match(out, /registerStyles\("X", "jslop-x-[a-z0-9]+",/);
  assert.match(out, /\.jslop-x-[a-z0-9]+ \.row\s*\{/);
});

test("style codegen appends scope class to root element", () => {
  const c = parseComponent(`component X {
    style { p { color: red; } }
    view { <div class="root"><p/></div> }
  }`);
  const out = generate(c);
  assert.match(out, /tag: "div", attrs: \{ "class": "root jslop-x-[a-z0-9]+" \}/);
});

test("style codegen adds scope class when root has no class attribute", () => {
  const c = parseComponent(`component X {
    style { p { color: red; } }
    view { <div><p/></div> }
  }`);
  const out = generate(c);
  assert.match(out, /tag: "div", attrs: \{ "class": "jslop-x-[a-z0-9]+" \}/);
});

test("style codegen scopes selectors inside @media", () => {
  const c = parseComponent(`component X {
    style {
      .row { color: red; }
      @media (min-width: 600px) {
        .row { color: blue; }
      }
    }
    view { <div class="row"/> }
  }`);
  const out = generate(c);
  // Both .row rules should be prefixed with the scope class
  const matches = out.match(/\.jslop-x-[a-z0-9]+ \.row\s*\{/g);
  assert.equal(matches?.length, 2);
  // @media wrapper survives
  assert.match(out, /@media \(min-width: 600px\)\s*\{/);
});

test("style codegen preserves @keyframes stops untouched", () => {
  const c = parseComponent(`component X {
    style {
      @keyframes pulse {
        0% { opacity: 0 }
        100% { opacity: 1 }
      }
    }
    view { <div/> }
  }`);
  const out = generate(c);
  // The keyframe stops (0%, 100%) must NOT be scoped.
  assert.doesNotMatch(out, /\.jslop-x-[a-z0-9]+ 0%/);
  assert.match(out, /@keyframes pulse\s*\{/);
});

test("component without style still compiles, no registerStyles for it", () => {
  const c = parseComponent(`component X { view { <p/> } }`);
  const out = generate(c);
  assert.doesNotMatch(out, /registerStyles\("X"/);
});
