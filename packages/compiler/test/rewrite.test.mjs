import { test } from "node:test";
import assert from "node:assert/strict";
import { rewriteFnBody, rewriteExpr } from "../dist/rewrite.js";

const N = ["count", "value"];

test("identifier read in expr becomes .get()", () => {
  assert.equal(rewriteExpr("count", N), "count.get()");
});

test("expr leaves non-reactive identifiers alone", () => {
  assert.equal(rewriteExpr("foo + bar", N), "foo + bar");
});

test("fn body: ++ becomes .set(.peek() + 1)", () => {
  assert.equal(
    rewriteFnBody("count++", N).trim(),
    "count.set(count.peek() + 1)"
  );
});

test("fn body: -- becomes .set(.peek() - 1)", () => {
  assert.equal(
    rewriteFnBody("count--", N).trim(),
    "count.set(count.peek() - 1)"
  );
});

test("fn body: simple assignment", () => {
  assert.equal(rewriteFnBody("count = 5", N).trim(), "count.set(5)");
});

test("fn body: compound assignment", () => {
  assert.equal(
    rewriteFnBody("count += 5", N).trim(),
    "count.set(count.peek() + (5))"
  );
});

test("fn body: read on RHS rewritten before LHS wrap", () => {
  assert.equal(
    rewriteFnBody("count = count + 1", N).trim(),
    "count.set(count.peek() + 1)"
  );
});

test("member access on reactive name is left alone", () => {
  // `obj.count` should NOT rewrite count (it's a property access)
  assert.equal(rewriteExpr("obj.count + 1", N), "obj.count + 1");
});

test("computed member access on reactive name IS rewritten", () => {
  // obj[count] — count is used as an expression
  assert.equal(rewriteExpr("obj[count]", N), "obj[count.get()]");
});

test("string literal containing identifier is untouched", () => {
  assert.equal(
    rewriteExpr('"count is " + count', N),
    '"count is " + count.get()'
  );
});

test("local shadowing prevents rewrite", () => {
  const out = rewriteFnBody("const count = 5; return count + 1;", N).trim();
  assert.match(out, /const count = 5/);
  assert.match(out, /return count \+ 1/);
  assert.doesNotMatch(out, /count\.peek\(\)/);
});

test("function parameter shadowing prevents rewrite", () => {
  const out = rewriteFnBody("[1,2].map(count => count * 2)", N).trim();
  assert.match(out, /count => count \* 2/);
  assert.doesNotMatch(out, /count\.get\(\)/);
});

test("nested function param shadows in inner scope only", () => {
  const out = rewriteFnBody(
    "count++; [1].forEach(count => use(count));",
    N
  ).trim();
  assert.match(out, /count\.set\(count\.peek\(\) \+ 1\)/);
  assert.match(out, /forEach\(count => use\(count\)\)/);
});

test("property shorthand is not rewritten as key", () => {
  // { count } is shorthand; this is a read of count, value should be rewritten
  assert.equal(rewriteExpr("({ count })", N), "({ count: count.get() })");
});

test("object literal: non-shorthand key not rewritten, value is", () => {
  assert.equal(
    rewriteExpr("({ count: count + 1 })", N),
    "({ count: count.get() + 1 })"
  );
});

test("multiple reactive names handled together", () => {
  assert.equal(
    rewriteExpr("count + value", N),
    "count.get() + value.get()"
  );
});

test("regression: avoid breaking obj.count = 5", () => {
  // The old regex would mangle this. AST version must leave it alone.
  assert.equal(
    rewriteFnBody("obj.count = 5", N).trim(),
    "obj.count = 5"
  );
});

test("ternary in expr", () => {
  assert.equal(
    rewriteExpr("count > 0 ? count : -1", N),
    "count.get() > 0 ? count.get() : -1"
  );
});

test("template literal: interpolated reactive reads", () => {
  assert.equal(
    rewriteExpr("`x=${count}`", N),
    "`x=${count.get()}`"
  );
});
