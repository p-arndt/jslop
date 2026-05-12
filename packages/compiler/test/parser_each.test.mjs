import { test } from "node:test";
import assert from "node:assert/strict";
import { parseComponent } from "../dist/parser.js";

function findEach(node) {
  if (node.kind === "each") return node;
  const kids = node.children ?? node.consequent ?? [];
  for (const c of kids) {
    const found = findEach(c);
    if (found) return found;
  }
  if (node.alternate) {
    for (const c of node.alternate) {
      const found = findEach(c);
      if (found) return found;
    }
  }
  return null;
}

test("each without key parses as before", () => {
  const src = `component X { let items = []; view { <ul>{#each items as item}<li>{item}</li>{/each}</ul> } }`;
  const c = parseComponent(src);
  const each = findEach(c.view);
  assert.equal(each.as, "item");
  assert.equal(each.index, null);
  assert.equal(each.key, null);
});

test("each with index, no key", () => {
  const src = `component X { let items = []; view { <ul>{#each items as item, i}<li>{item}</li>{/each}</ul> } }`;
  const c = parseComponent(src);
  const each = findEach(c.view);
  assert.equal(each.index, "i");
  assert.equal(each.key, null);
});

test("each with key only", () => {
  const src = `component X { let items = []; view { <ul>{#each items as item (item.id)}<li>{item.name}</li>{/each}</ul> } }`;
  const c = parseComponent(src);
  const each = findEach(c.view);
  assert.equal(each.as, "item");
  assert.equal(each.index, null);
  assert.equal(each.key, "item.id");
});

test("each with index and key", () => {
  const src = `component X { let items = []; view { <ul>{#each items as item, i (item.id)}<li>{item.name}</li>{/each}</ul> } }`;
  const c = parseComponent(src);
  const each = findEach(c.view);
  assert.equal(each.as, "item");
  assert.equal(each.index, "i");
  assert.equal(each.key, "item.id");
});

test("each key can contain parens", () => {
  const src = `component X { let items = []; view { <ul>{#each items as item (String(item.id))}<li/>{/each}</ul> } }`;
  const c = parseComponent(src);
  const each = findEach(c.view);
  assert.equal(each.key, "String(item.id)");
});
