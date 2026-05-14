import { test } from "node:test";
import assert from "node:assert/strict";
import { renderRouteChain } from "../dist/index.js";

function makeComp(name, viewFn) {
  return {
    name,
    create(props = {}) {
      return {
        actions: {},
        buildView: () => viewFn(props),
        buildHead: () => [],
        serializeState: () => ({}),
        restoreState: () => {},
      };
    },
  };
}

test("layoutProps is forwarded to every layout in the chain", () => {
  const layout = makeComp("Layout", (props) => ({
    kind: "element",
    tag: "div",
    attrs: { "data-user": String(props.user ?? "") },
    events: {},
    children: [{ kind: "children" }],
  }));
  const route = makeComp("Route", () => ({
    kind: "element",
    tag: "main",
    attrs: {},
    events: {},
    children: [],
  }));
  const r = renderRouteChain({
    route,
    layouts: [layout],
    layoutProps: { user: "ada" },
  });
  assert.match(r.html, /data-user="ada"/);
});

test("layouts receive the same merged layoutProps blob (multi-layout)", () => {
  const outer = makeComp("Outer", (props) => ({
    kind: "element",
    tag: "div",
    attrs: { "data-from": "outer", "data-user": String(props.user ?? "") },
    events: {},
    children: [{ kind: "children" }],
  }));
  const inner = makeComp("Inner", (props) => ({
    kind: "element",
    tag: "section",
    attrs: { "data-from": "inner", "data-user": String(props.user ?? "") },
    events: {},
    children: [{ kind: "children" }],
  }));
  const route = makeComp("Route", () => ({
    kind: "element",
    tag: "main",
    attrs: {},
    events: {},
    children: [],
  }));
  const r = renderRouteChain({
    route,
    layouts: [outer, inner],
    layoutProps: { user: "ada" },
  });
  // Both layouts saw user="ada"
  const userMatches = r.html.match(/data-user="ada"/g) ?? [];
  assert.equal(userMatches.length, 2);
});
