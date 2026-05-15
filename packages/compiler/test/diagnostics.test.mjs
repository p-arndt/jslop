import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, JSlopParseError, formatParseError, parseFile } from "../dist/index.js";

test("compile() with a filename produces a file:line:col header", () => {
  const src = `component Hello {\n  bogus foo = 1\n  view { <p/> }\n}\n`;
  let caught;
  try {
    compile(src, { filename: "src/routes/index.jslop" });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, "expected compile to throw");
  // file:line:col header
  assert.match(caught.message, /^src\/routes\/index\.jslop:2:3: /m);
  // code frame with a caret line
  assert.match(caught.message, /> 2 \|\s+bogus/);
  assert.match(caught.message, /\^/);
  // hint line
  assert.match(caught.message, /hint: /);
  // wrapped JSlopParseError exposed via cause
  assert.ok(caught.cause instanceof JSlopParseError);
});

test("closing tag mismatch points at the offending </tag> with a hint", () => {
  const src = `component X {\n  view {\n    <div>\n      <span></div>\n    </div>\n  }\n}\n`;
  let caught;
  try {
    compile(src, { filename: "X.jslop" });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught);
  assert.match(caught.message, /closing tag <\/div> does not match opening <span>/);
  assert.match(caught.message, /hint:.*<span\/>/);
});

test("unterminated children of a tag points at the open tag", () => {
  // <div> opens but never closes — children walker hits EOF on the slice
  const src = `component X { view { <div><span/> } }`;
  let caught;
  try {
    compile(src, { filename: "X.jslop" });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught);
  assert.match(caught.message, /unterminated children of <div>|reached end of input/);
});

test("formatParseError works against a raw JSlopParseError + source", () => {
  const src = `component X {\n  oops xyz\n  view { <p/> }\n}\n`;
  let caught;
  try {
    parseFile(src);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof JSlopParseError);
  const formatted = formatParseError(caught, src, "demo.jslop");
  assert.match(formatted, /^demo\.jslop:2:3: /);
  assert.match(formatted, /unknown declaration/);
  assert.match(formatted, /hint: /);
});

test("missing top-level component hints at the file shape", () => {
  let caught;
  try {
    compile(`let nope = 1\n`, { filename: "weird.jslop" });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught);
  assert.match(caught.message, /expected 'component' at top level/);
  assert.match(caught.message, /hint:.*component Name/);
});
