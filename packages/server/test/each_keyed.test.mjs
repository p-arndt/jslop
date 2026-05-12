import { test } from "node:test";
import assert from "node:assert/strict";
import { renderComponent } from "../dist/index.js";

function makeListComponent({ keyed }) {
  return {
    name: "List",
    create(props = {}) {
      const items = props.items ?? [];
      return {
        actions: {},
        buildView() {
          const eachNode = {
            kind: "each",
            each: () => items,
            build: (item) => [{ kind: "text", value: item.label }],
          };
          if (keyed) eachNode.key = (item) => item.id;
          return {
            kind: "element",
            tag: "ul",
            attrs: {},
            events: {},
            children: [eachNode],
          };
        },
        serializeState() {
          return {};
        },
        restoreState() {},
      };
    },
  };
}

test("unkeyed each renders without data-rift-keyed/data-rift-key", () => {
  const comp = makeListComponent({ keyed: false });
  const { html } = renderComponent(comp, {
    items: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
  });
  assert.ok(html.includes('data-rift-count="2"'));
  assert.ok(!html.includes("data-rift-keyed"));
  assert.ok(!html.includes("data-rift-key="));
  assert.ok(html.includes("<rift-each-item>A</rift-each-item>"));
});

test("keyed each renders data-rift-keyed and per-item data-rift-key", () => {
  const comp = makeListComponent({ keyed: true });
  const { html } = renderComponent(comp, {
    items: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
  });
  assert.ok(html.includes('data-rift-count="2"'));
  assert.ok(html.includes('data-rift-keyed="t"'));
  assert.ok(html.includes('data-rift-key="a"'));
  assert.ok(html.includes('data-rift-key="b"'));
});

test("each containing a child component renders the component's HTML per item", () => {
  const Child = {
    name: "Child",
    create(props) {
      return {
        actions: {},
        buildView() {
          return {
            kind: "element",
            tag: "span",
            attrs: { "data-id": String(props.id) },
            events: {},
            children: [{ kind: "text", value: String(props.label) }],
          };
        },
        serializeState: () => ({}),
        restoreState: () => {},
      };
    },
  };
  const Parent = {
    name: "Parent",
    create(props) {
      const items = props.items ?? [];
      return {
        actions: {},
        buildView() {
          return {
            kind: "element",
            tag: "ul",
            attrs: {},
            events: {},
            children: [
              {
                kind: "each",
                each: () => items,
                build: (item) => {
                  const __c0 = Child.create({ id: item.id, label: item.label });
                  return [
                    {
                      kind: "component",
                      name: "Child",
                      instance: __c0,
                      view: __c0.buildView(),
                    },
                  ];
                },
                key: (item) => item.id,
              },
            ],
          };
        },
        serializeState: () => ({}),
        restoreState: () => {},
      };
    },
  };
  const { html } = renderComponent(Parent, {
    items: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
  });
  assert.match(html, /<rift-each-item data-rift-key="a"><span data-id="a" data-rift-component="Child">A<\/span><\/rift-each-item>/);
  assert.match(html, /<rift-each-item data-rift-key="b"><span data-id="b" data-rift-component="Child">B<\/span><\/rift-each-item>/);
});

test("keyed each escapes key values for the HTML attribute", () => {
  const comp = makeListComponent({ keyed: true });
  const { html } = renderComponent(comp, {
    items: [{ id: 'x"&y', label: "X" }],
  });
  assert.ok(html.includes('data-rift-key="x&quot;&amp;y"'));
});
