import { test } from "node:test";
import assert from "node:assert/strict";
import { renderRouteChain } from "../dist/index.js";

function stub(name, buildView) {
  return {
    name,
    create() {
      return {
        actions: {},
        buildView,
        serializeState: () => ({}),
        restoreState: () => {},
      };
    },
  };
}

const routeStub = stub("Route", () => ({
  kind: "element",
  tag: "section",
  attrs: {},
  events: {},
  children: [{ kind: "text", value: "page" }],
}));

const layoutStub = (name, label) =>
  stub(name, () => ({
    kind: "element",
    tag: "div",
    attrs: { "data-l": label },
    events: {},
    children: [
      { kind: "text", value: `${label}-pre` },
      { kind: "children" },
      { kind: "text", value: `${label}-post` },
    ],
  }));

test("renderRouteChain with no layouts behaves like renderComponent", () => {
  const { html, capsule } = renderRouteChain({ route: routeStub });
  assert.match(html, /<section[^>]*data-rift-cid="c0"/);
  assert.equal(capsule.components.length, 1);
  assert.equal(capsule.components[0].cid, "c0");
});

test("renderRouteChain nests route inside one layout via <children/>", () => {
  const { html, capsule } = renderRouteChain({
    route: routeStub,
    layouts: [layoutStub("Layout", "L")],
  });
  // Layout wraps the route; placeholder is replaced.
  assert.ok(!html.includes("rift-children"));
  // Route HTML appears between layout's pre and post text.
  const preIdx = html.indexOf("L-pre");
  const routeIdx = html.indexOf("<section");
  const postIdx = html.indexOf("L-post");
  assert.ok(preIdx < routeIdx && routeIdx < postIdx, `order: ${preIdx},${routeIdx},${postIdx}`);
  // Two capsule entries with distinct cids.
  assert.equal(capsule.components.length, 2);
  const cids = capsule.components.map((c) => c.cid).sort();
  assert.deepEqual(cids, ["c0", "c1"]);
});

test("renderRouteChain composes outermost-first across multiple layouts", () => {
  const { html, capsule } = renderRouteChain({
    route: routeStub,
    layouts: [layoutStub("Outer", "O"), layoutStub("Inner", "I")],
  });
  const o = html.indexOf("O-pre");
  const i = html.indexOf("I-pre");
  const r = html.indexOf("<section");
  assert.ok(o < i && i < r, `outer must wrap inner: ${o},${i},${r}`);
  assert.equal(capsule.components.length, 3);
});

test("layout missing <children/> throws a clear error", () => {
  const broken = stub("Broken", () => ({
    kind: "element",
    tag: "div",
    attrs: {},
    events: {},
    children: [{ kind: "text", value: "no slot" }],
  }));
  assert.throws(
    () => renderRouteChain({ route: routeStub, layouts: [broken] }),
    /layout Broken has no <children\/>/
  );
});
