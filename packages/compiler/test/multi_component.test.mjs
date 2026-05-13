import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFile } from "../dist/parser.js";
import { generate, compile } from "../dist/index.js";

test("parses multiple component blocks in one file", () => {
  const file = parseFile(`
    component Display {
      prop value = 0
      view { <span>{value}</span> }
    }
    component Stepper {
      prop onstep = () => {}
      view { <button onclick={onstep}>step</button> }
    }
  `);
  assert.equal(file.components.length, 2);
  assert.equal(file.components[0].name, "Display");
  assert.equal(file.components[1].name, "Stepper");
});

test("codegen emits one named export per component and a default for the first", () => {
  const out = compile(`
    component A { view { <p/> } }
    component B { view { <p/> } }
  `);
  assert.match(out, /export const A = \{/);
  assert.match(out, /export const B = \{/);
  assert.match(out, /export default A;/);
});

test("named import syntax is parsed and re-emitted", () => {
  const file = parseFile(`
    import { Display, Stepper as S } from './widgets.rift'
    component Page {
      view { <div><Display value={1}/><S/></div> }
    }
  `);
  assert.equal(file.imports.length, 1);
  assert.equal(file.imports[0].defaultName, null);
  assert.deepEqual(file.imports[0].named, [
    { imported: "Display", local: "Display" },
    { imported: "Stepper", local: "S" },
  ]);
  const out = generate(file);
  // .rift extension rewritten + both specifiers preserved + alias preserved.
  assert.match(out, /import \{ Display, Stepper as S \} from "\.\/widgets\.compiled\.mjs";/);
});

test("default + named combined import is supported", () => {
  const file = parseFile(`
    import Page, { Display } from './widgets.rift'
    component X { view { <p/> } }
  `);
  assert.equal(file.imports[0].defaultName, "Page");
  assert.deepEqual(file.imports[0].named, [{ imported: "Display", local: "Display" }]);
  const out = generate(file);
  assert.match(out, /import Page, \{ Display \} from "\.\/widgets\.compiled\.mjs";/);
});

test("same-file component reference resolves to the sibling export", () => {
  const out = compile(`
    component Inner {
      prop label = "?"
      view { <span>{label}</span> }
    }
    component Outer {
      view { <div><Inner label="hi"/></div> }
    }
  `);
  // Outer's view should call Inner.create — Inner is declared as `export const`
  // in the same module, so the reference resolves to the sibling.
  assert.match(out, /const __child_0 = Inner\.create\(\{ "label": "hi" \}\)/);
});

test("empty file (no components) is rejected", () => {
  assert.throws(() => parseFile(`import X from './x.rift'`), /at least one component/);
});
