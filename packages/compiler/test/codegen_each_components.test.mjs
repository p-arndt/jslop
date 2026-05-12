import { test } from "node:test";
import assert from "node:assert/strict";
import { parseComponent } from "../dist/parser.js";
import { generate } from "../dist/codegen.js";

test("component nested in each is emitted inline, not hoisted", () => {
  const src = `
import Item from './Item.rift'
component X {
  let items = []
  view {
    <ul>{#each items as item, i (item.id)}<Item value={item.label} idx={i} />{/each}</ul>
  }
}`;
  const out = generate(parseComponent(src));
  assert.match(out, /const __c_0 = Item\.create\(\{ "value": \(item\.label\), "idx": \(i\) \}\)/);
  // No hoisted decl for the each-nested component.
  assert.doesNotMatch(out, /const __child_0 = Item/);
  // __children stays empty (no top-level child components).
  assert.match(out, /const __children = \[\];/);
});

test("hoisted components outside each are unchanged", () => {
  const src = `
import Header from './Header.rift'
component X {
  let count = 0
  view {
    <div>
      <Header value={count} />
      <p>x</p>
    </div>
  }
}`;
  const out = generate(parseComponent(src));
  assert.match(out, /const __child_0 = Header\.create\(\{ "value": \(count\) \}\)/);
  assert.match(out, /const __children = \[__child_0\];/);
});

test("hoisted and inline can coexist with independent counters", () => {
  const src = `
import Header from './Header.rift'
import Item from './Item.rift'
component X {
  let items = []
  view {
    <div>
      <Header />
      <ul>{#each items as item (item.id)}<Item id={item.id} /><Item id={item.id} />{/each}</ul>
    </div>
  }
}`;
  const out = generate(parseComponent(src));
  // Header is hoisted as __child_0.
  assert.match(out, /const __child_0 = Header\.create\(/);
  // Two Item instances per item — counter advances independently inside each.
  assert.match(out, /const __c_1 = Item\.create\(\{ "id": \(item\.id\) \}\)/);
  assert.match(out, /const __c_2 = Item\.create\(\{ "id": \(item\.id\) \}\)/);
  assert.match(out, /const __children = \[__child_0\];/);
});

test("nested each: each inner each gets its own inline scope", () => {
  const src = `
import Cell from './Cell.rift'
component X {
  let rows = []
  view {
    <table>
      {#each rows as row, r (row.id)}
        <tr>{#each row.cols as col, c (col.id)}<Cell value={col.v} />{/each}</tr>
      {/each}
    </table>
  }
}`;
  const out = generate(parseComponent(src));
  // The inner Cell should be declared inside the inner build callback,
  // referring to col (the inner item binding) — not row.
  assert.match(out, /const __c_0 = Cell\.create\(\{ "value": \(col\.v\) \}\)/);
});
