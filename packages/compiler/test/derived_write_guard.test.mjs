import { test } from "node:test";
import assert from "node:assert/strict";
import { parseComponent } from "../dist/parser.js";
import { generate } from "../dist/codegen.js";

test("assigning to derived in a function throws at compile time", () => {
  const c = parseComponent(`component X {
    state n = 1
    derived doubled = n * 2
    function reset() { doubled = 0 }
    view { <p/> }
  }`);
  assert.throws(() => generate(c), /cannot assign to derived 'doubled'/);
});

test("compound assign to derived throws", () => {
  const c = parseComponent(`component X {
    state n = 1
    derived doubled = n * 2
    function reset() { doubled += 5 }
    view { <p/> }
  }`);
  assert.throws(() => generate(c), /cannot assign to derived 'doubled'/);
});

test("++ on derived throws", () => {
  const c = parseComponent(`component X {
    state n = 1
    derived doubled = n * 2
    function bump() { doubled++ }
    view { <p/> }
  }`);
  assert.throws(() => generate(c), /cannot \+\+ a derived: 'doubled'/);
});

test("writing to state with same shape still works", () => {
  const c = parseComponent(`component X {
    state n = 1
    derived doubled = n * 2
    function reset() { n = 0 }
    view { <p>{doubled}</p> }
  }`);
  const out = generate(c);
  assert.match(out, /n\.set\(0\)/);
});

test("assigning to derived inside event handler also throws", () => {
  const c = parseComponent(`component X {
    state n = 1
    derived doubled = n * 2
    view { <button onclick={() => doubled = 99}>x</button> }
  }`);
  assert.throws(() => generate(c), /cannot assign to derived 'doubled'/);
});
