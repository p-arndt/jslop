import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { renderPage } from "@jslop/server";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { __jslop_component: App } = await import(
  pathToFileURL(resolve(__dirname, "dist/App.compiled.mjs")).href
);

class Node {
  constructor(tag) {
    this.tagName = (tag ?? "").toUpperCase();
    this.children = [];
    this.parent = null;
    this.attrs = {};
    this.listeners = {};
    this._text = "";
    this.nodeType = 1;
  }
  get textContent() {
    if (this.children.length === 0) return this._text;
    return this.children.map((c) => c.textContent).join("");
  }
  set textContent(v) {
    this._text = String(v);
    this.children = [];
  }
  appendChild(c) {
    c.parent = this;
    this.children.push(c);
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
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return this.attrs[k] ?? null;
  }
  addEventListener(evt, fn) {
    (this.listeners[evt] ??= []).push(fn);
  }
  dispatchEvent(evt, payload) {
    for (const fn of this.listeners[evt] ?? []) fn(payload ?? {});
  }
  querySelector(sel) {
    const m = /^\[data-jslop-cid="([^"]+)"\]$/.exec(sel);
    if (m) return findFirst(this, (n) => n.attrs["data-jslop-cid"] === m[1]);
    throw new Error(`unsupported selector ${sel}`);
  }
}

function findFirst(root, pred) {
  if (pred(root)) return root;
  for (const c of root.children) {
    const f = findFirst(c, pred);
    if (f) return f;
  }
  return null;
}

const document = {
  _ids: new Map(),
  getElementById(id) {
    return this._ids.get(id) ?? null;
  },
  querySelector(sel) {
    return root.querySelector(sel);
  },
  createElement(tag) {
    return new Node(tag);
  },
  createTextNode(v) {
    const n = new Node("#text");
    n.tagName = "#text";
    n.nodeType = 3;
    n._text = v;
    return n;
  },
};

function parseHtml(src) {
  let i = 0;
  function skipUntil(s) {
    const idx = src.indexOf(s, i);
    if (idx === -1) throw new Error(`no ${s}`);
    i = idx + s.length;
  }
  skipUntil("<body>");
  const body = new Node("BODY");
  const stack = [body];
  while (i < src.length) {
    if (src.startsWith("</body>", i)) break;
    if (src[i] === "<") {
      if (src.startsWith("<!--", i)) {
        const end = src.indexOf("-->", i);
        i = end + 3;
        continue;
      }
      if (src[i + 1] === "/") {
        const end = src.indexOf(">", i);
        i = end + 1;
        stack.pop();
        continue;
      }
      const end = src.indexOf(">", i);
      const raw = src.slice(i + 1, end);
      i = end + 1;
      const selfClose = raw.endsWith("/");
      const cleaned = selfClose ? raw.slice(0, -1).trim() : raw.trim();
      const space = cleaned.indexOf(" ");
      const tag = space === -1 ? cleaned : cleaned.slice(0, space);
      const attrStr = space === -1 ? "" : cleaned.slice(space + 1);
      const el = new Node(tag);
      const re = /([A-Za-z_:][A-Za-z0-9_:\-]*)(?:=("([^"]*)"|'([^']*)'))?/g;
      let m;
      while ((m = re.exec(attrStr))) {
        const k = m[1];
        const v = m[3] ?? m[4] ?? "";
        el.attrs[k] = v;
        if (k === "id") document._ids.set(v, el);
      }
      stack[stack.length - 1].appendChild(el);
      if (tag === "script" && el.attrs.id === "__jslop_capsule") {
        const close = src.indexOf("</script>", i);
        el._text = src.slice(i, close);
        i = close + "</script>".length;
        continue;
      }
      const voidEls = ["br", "img", "meta", "link", "hr", "input"];
      if (!selfClose && !voidEls.includes(tag.toLowerCase())) {
        stack.push(el);
      }
    } else {
      const nextLt = src.indexOf("<", i);
      const text = src.slice(i, nextLt === -1 ? src.length : nextLt);
      if (text.trim().length > 0) {
        const t = new Node("#text");
        t.tagName = "#text";
        t.nodeType = 3;
        t._text = text;
        stack[stack.length - 1].appendChild(t);
      }
      i = nextLt === -1 ? src.length : nextLt;
    }
  }
  return body;
}

const html = renderPage({
  title: "Counter",
  component: App,
  appScriptUrl: "/static/app.js",
});

const root = parseHtml(html);
globalThis.document = document;

const { boot } = await import("@jslop/client");
boot({ [App.name]: App });

function collectButtons(n, out = []) {
  if (n.tagName === "BUTTON") out.push(n);
  for (const c of n.children) collectButtons(c, out);
  return out;
}

function listItems(n) {
  const out = [];
  function walk(node) {
    if (node.tagName === "LI") out.push(node.textContent.trim());
    for (const c of node.children) walk(c);
  }
  walk(n);
  return out;
}

const buttons = collectButtons(root);
const labels = buttons.map((b) => b.textContent.trim());
console.log("buttons:", labels);

// Find the input element
function findInput(n) {
  if (n.tagName === "INPUT") return n;
  for (const c of n.children) {
    const f = findInput(c);
    if (f) return f;
  }
  return null;
}
const input = findInput(root);

console.log("=== initial list ===");
console.log(listItems(root));

// Simulate typing "buy milk" and pressing add
input.dispatchEvent("input", { target: { value: "buy milk" } });
const addBtn = buttons.find((b) => b.textContent.trim() === "add");
addBtn.dispatchEvent("click");

console.log("=== after add 'buy milk' ===");
console.log(listItems(root));

input.dispatchEvent("input", { target: { value: "feed cat" } });
addBtn.dispatchEvent("click");
console.log("=== after add 'feed cat' ===");
console.log(listItems(root));

const clearBtn = buttons.find((b) => b.textContent.trim() === "clear");
clearBtn.dispatchEvent("click");
console.log("=== after clear ===");
console.log(listItems(root));
