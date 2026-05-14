import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPage, renderRouteChain } from "../dist/index.js";

function makeComp(name, headNodes, viewNode) {
  return {
    name,
    create() {
      return {
        actions: {},
        buildView: () => viewNode,
        buildHead: () => headNodes,
        serializeState: () => ({}),
        restoreState: () => {},
      };
    },
  };
}

test("renderPage uses component <title> over the fallback opts.title", () => {
  const comp = makeComp(
    "X",
    [{ kind: "element", tag: "title", attrs: {}, events: {}, children: [{ kind: "text", value: "from component" }] }],
    { kind: "element", tag: "div", attrs: {}, events: {}, children: [] }
  );
  const html = renderPage({ title: "fallback", component: comp, appScriptUrl: "/app.js" });
  assert.match(html, /<title>from component<\/title>/);
  assert.doesNotMatch(html, /<title>fallback<\/title>/);
});

test("renderRouteChain merges layout + route head; route head comes last", () => {
  const layout = makeComp(
    "Layout",
    [{ kind: "element", tag: "meta", attrs: { name: "layout" }, events: {}, children: [] }],
    { kind: "element", tag: "div", attrs: {}, events: {}, children: [{ kind: "children" }] }
  );
  const route = makeComp(
    "Route",
    [{ kind: "element", tag: "title", attrs: {}, events: {}, children: [{ kind: "text", value: "route" }] }],
    { kind: "element", tag: "main", attrs: {}, events: {}, children: [] }
  );
  const result = renderRouteChain({ route, layouts: [layout] });
  assert.match(result.head, /<meta name="layout">/);
  assert.match(result.head, /<title>route<\/title>/);
  // route head must come after layout head
  assert.ok(result.head.indexOf("layout") < result.head.indexOf("route"));
});

test("head fragment rejects unsupported node kinds", () => {
  const comp = makeComp(
    "X",
    [{ kind: "if", test: () => true, consequent: [], alternate: [] }],
    { kind: "element", tag: "div", attrs: {}, events: {}, children: [] }
  );
  assert.throws(() => renderPage({ title: "t", component: comp, appScriptUrl: "/a.js" }), /head fragments/);
});
