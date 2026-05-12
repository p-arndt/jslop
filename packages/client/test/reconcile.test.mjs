import { test } from "node:test";
import assert from "node:assert/strict";
import { cell } from "../../runtime/dist/index.js";

class StubElement {
  constructor(tag) {
    this.tagName = (tag ?? "").toUpperCase();
    this.children = [];
    this.parent = null;
    this.attrs = {};
    this.listeners = {};
    this._text = "";
    this.nodeType = 1;
    // Tag a stable id for assertion convenience.
    this.__id = StubElement._nextId++;
  }
  static _nextId = 1;
  appendChild(c) {
    if (c.parent) c.parent.removeChild(c);
    c.parent = this;
    this.children.push(c);
    return c;
  }
  insertBefore(c, ref) {
    if (c.parent) c.parent.removeChild(c);
    c.parent = this;
    if (ref == null) {
      this.children.push(c);
    } else {
      const i = this.children.indexOf(ref);
      this.children.splice(i < 0 ? this.children.length : i, 0, c);
    }
    return c;
  }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    c.parent = null;
    return c;
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
  get parentNode() {
    return this.parent;
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return this.attrs[k] ?? null;
  }
  addEventListener(evt, fn) {
    (this.listeners[evt] ??= []).push(fn);
  }
  set textContent(v) {
    this._text = String(v);
    this.children = [];
  }
  get textContent() {
    if (this.children.length === 0) return this._text;
    return this.children.map((c) => c.textContent).join("");
  }
}

const document = {
  createElement: (t) => new StubElement(t),
  createTextNode: (v) => {
    const n = new StubElement("#text");
    n.tagName = "#text";
    n.nodeType = 3;
    n._text = v;
    return n;
  },
  getElementById: () => null,
  querySelector: () => null,
};
globalThis.document = document;

const { boot } = await import("../dist/index.js");

// Drive mountEach indirectly through boot() with a synthetic capsule + module.
// Build a list component that uses a keyed each.

function makeKeyedListModule(items) {
  // The compiled view structure expected by attach(): root is an element with
  // an each child. The each yields one <li> per item with a bound text node
  // for label.
  return {
    name: "List",
    create() {
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
                each: () => items.get(),
                build: (item) => [
                  {
                    kind: "element",
                    tag: "li",
                    attrs: { "data-id": String(item.id) },
                    events: {},
                    children: [{ kind: "bind", get: () => String(item.label) }],
                  },
                ],
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
}

function setupRoot() {
  // Manually wire: create a capsule + a fresh root <ul data-rift-cid="r"> with
  // an empty <rift-each data-rift-keyed="t" data-rift-count="0">. This mimics
  // an SSR-rendered empty list.
  const root = new StubElement("ul");
  root.attrs["data-rift-cid"] = "r";
  const each = new StubElement("rift-each");
  each.attrs["data-rift-count"] = "0";
  each.attrs["data-rift-keyed"] = "t";
  root.appendChild(each);

  document.querySelector = (sel) => {
    if (sel === '[data-rift-cid="r"]') return root;
    return null;
  };
  const capsuleEl = new StubElement("script");
  capsuleEl._text = JSON.stringify({
    components: [{ cid: "r", name: "List", props: {}, state: {} }],
  });
  document.getElementById = (id) => (id === "__rift_capsule" ? capsuleEl : null);
  return { root, each };
}

function liIds(eachEl) {
  return eachEl.children.map((c) => c.children[0]?.attrs["data-id"] ?? null);
}

test("keyed each: initial mount with empty list, then add items", () => {
  const items = cell([]);
  const { each } = setupRoot();
  boot({ List: makeKeyedListModule(items) });
  assert.deepEqual(liIds(each), []);
  items.set([{ id: "a", label: "A" }, { id: "b", label: "B" }]);
  assert.deepEqual(liIds(each), ["a", "b"]);
});

test("keyed each: reorder preserves DOM identity per key", () => {
  const items = cell([
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
  ]);
  const { each } = setupRoot();
  boot({ List: makeKeyedListModule(items) });
  // After mount, the DOM is fresh (SSR count was 0). Snapshot li identities.
  const before = each.children.slice();
  assert.deepEqual(before.map((c) => c.children[0].attrs["data-id"]), [
    "a", "b", "c",
  ]);

  // Reverse the list.
  items.set([
    { id: "c", label: "C" },
    { id: "b", label: "B" },
    { id: "a", label: "A" },
  ]);
  const after = each.children.slice();
  assert.deepEqual(after.map((c) => c.children[0].attrs["data-id"]), [
    "c", "b", "a",
  ]);
  // DOM identity preserved: same rift-each-item nodes, just reordered.
  assert.equal(after[0].__id, before[2].__id);
  assert.equal(after[1].__id, before[1].__id);
  assert.equal(after[2].__id, before[0].__id);
});

test("keyed each: removing an item disposes its DOM and inserts/keeps others", () => {
  const items = cell([
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
  ]);
  const { each } = setupRoot();
  boot({ List: makeKeyedListModule(items) });
  const before = each.children.slice();
  items.set([
    { id: "a", label: "A" },
    { id: "c", label: "C" },
  ]);
  assert.deepEqual(liIds(each), ["a", "c"]);
  assert.equal(each.children[0].__id, before[0].__id);
  assert.equal(each.children[1].__id, before[2].__id);
});

function makeUnkeyedListWithEffect(items, onItemMount) {
  return {
    name: "List",
    create() {
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
                each: () => items.get(),
                build: (item) => {
                  // The build() runs once per item per rebuild; we register
                  // a side-effect via a bind whose getter increments the
                  // mount counter. This proves bind effects are scoped.
                  return [
                    {
                      kind: "element",
                      tag: "li",
                      attrs: {},
                      events: {},
                      children: [
                        {
                          kind: "bind",
                          get: () => {
                            onItemMount(item.id);
                            return String(item.label);
                          },
                        },
                      ],
                    },
                  ];
                },
              },
            ],
          };
        },
        serializeState: () => ({}),
        restoreState: () => {},
      };
    },
  };
}

test("unkeyed each: rebuild disposes prior item bind effects (no leak)", () => {
  const items = cell([{ id: 1, label: "x" }]);
  const mounts = [];
  const { each } = setupRoot();
  // Strip the keyed marker so the list is treated as unkeyed.
  delete each.attrs["data-rift-keyed"];
  boot({ List: makeUnkeyedListWithEffect(items, (id) => mounts.push(id)) });
  // Initial mount path renders nothing visible (SSR count was 0 / empty list
  // mismatch). After list flips it triggers a fresh build.
  assert.deepEqual(mounts, [1]);
  // Mutate the label of the same item by replacing the array.
  items.set([{ id: 1, label: "y" }]);
  // In an unkeyed list, this rebuilds. Old bind effect must be disposed.
  // Total mounts so far: 1 (initial) + 1 (rebuild) = 2.
  // Crucially, mutating the items cell again should NOT re-fire the old
  // disposed effect — only the live one. We verify by checking the count
  // grows by exactly 1 per cell.set(), not by 2 (which would mean the prior
  // effect leaked).
  assert.equal(mounts.length, 2);
  items.set([{ id: 1, label: "z" }]);
  assert.equal(mounts.length, 3);
});

test("keyed each: inserting in the middle creates new DOM and keeps neighbors", () => {
  const items = cell([
    { id: "a", label: "A" },
    { id: "c", label: "C" },
  ]);
  const { each } = setupRoot();
  boot({ List: makeKeyedListModule(items) });
  const before = each.children.slice();
  items.set([
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
  ]);
  assert.deepEqual(liIds(each), ["a", "b", "c"]);
  assert.equal(each.children[0].__id, before[0].__id);
  assert.equal(each.children[2].__id, before[1].__id);
  // The new item's DOM should be a fresh element, not equal to either anchor.
  assert.notEqual(each.children[1].__id, before[0].__id);
  assert.notEqual(each.children[1].__id, before[1].__id);
});
