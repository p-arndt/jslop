import { effect, createScope, runInScope, disposeScope, type Scope } from "@jslop/runtime";

type Actions = Record<string, (...args: unknown[]) => unknown>;

type BindNode = { kind: "bind"; get: () => string };
type PropNode = { kind: "prop"; get: () => unknown };
type TextNode = { kind: "text"; value: string };
type ElNode = {
  kind: "element";
  tag: string;
  attrs: Record<string, string | BindNode | PropNode>;
  events: Record<string, (e: Event) => unknown>;
  children: ViewNode[];
};
type IfNode = {
  kind: "if";
  test: () => unknown;
  consequent: ViewNode[];
  alternate: ViewNode[];
};
type EachNode = {
  kind: "each";
  each: () => Iterable<unknown>;
  build: (item: unknown, index: number) => ViewNode[];
  key?: (item: unknown, index: number) => unknown;
};
type ComponentNode = {
  kind: "component";
  name: string;
  instance: JSlopInstance;
  view: ElNode;
};
type ChildrenNode = { kind: "children" };
type ViewNode = ElNode | TextNode | BindNode | ComponentNode | IfNode | EachNode | ChildrenNode;

interface JSlopInstance {
  actions: Actions;
  buildView(): ElNode;
  serializeState(): Record<string, unknown>;
  restoreState(s: Record<string, unknown>): void;
}

interface JSlopModule {
  name: string;
  create(props?: Record<string, unknown>): JSlopInstance;
}

interface Capsule {
  components: Array<{
    cid: string;
    name: string;
    props: Record<string, unknown>;
    state: Record<string, unknown>;
  }>;
}

let ROOT_SCOPES = new WeakMap<Element, Scope>();
// Track every root we've attached during the current page so SPA navigation
// can dispose them all at once before swapping #app's contents. WeakMap alone
// can't be iterated, and we need explicit teardown when leaving a page.
let attachedRoots: Element[] = [];
let bootedModules: Record<string, JSlopModule> | null = null;

export function boot(modules: Record<string, JSlopModule>): void {
  // First boot also wires up the SPA navigation layer (link interception +
  // popstate). Re-booting after a navigate() reuses the same modules without
  // re-installing those listeners.
  if (!bootedModules) installNavigationHandlers();
  bootedModules = modules;
  bootCurrentPage(modules);
}

function bootCurrentPage(modules: Record<string, JSlopModule>): void {
  const capsuleEl = document.getElementById("__jslop_capsule");
  if (!capsuleEl || !capsuleEl.textContent) return;
  const capsule = JSON.parse(capsuleEl.textContent) as Capsule;

  attachedRoots = [];

  for (const entry of capsule.components) {
    const mod = modules[entry.name];
    if (!mod) {
      console.warn(`[jslop] no module registered for component ${entry.name}`);
      continue;
    }
    const root = document.querySelector<HTMLElement>(`[data-jslop-cid="${entry.cid}"]`);
    if (!root) continue;

    const previous = ROOT_SCOPES.get(root);
    if (previous) disposeScope(previous);
    const scope = createScope(null);
    ROOT_SCOPES.set(root, scope);
    attachedRoots.push(root);

    runInScope(scope, () => {
      const inst = mod.create(entry.props ?? {});
      inst.restoreState(entry.state);
      const view = inst.buildView();
      attach(root, view, inst.actions);
    });
  }
}

/* ------------------------------------------------------------------ *
 * SPA navigation — intercept same-origin link clicks, fetch the new
 * page's HTML, swap #app's contents, merge missing <style> tags into
 * <head>, update <title>, and re-boot. Full-page reload behaviour is
 * preserved for external links, modified clicks, target=_blank, etc.
 * ------------------------------------------------------------------ */

function installNavigationHandlers(): void {
  if (typeof window === "undefined") return;
  document.addEventListener("click", onLinkClick);
  window.addEventListener("popstate", () => {
    void navigate(window.location.pathname + window.location.search, { push: false });
  });
}

function onLinkClick(e: MouseEvent): void {
  if (e.defaultPrevented) return;
  if (e.button !== 0) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const target = (e.target as Element | null)?.closest("a");
  if (!target) return;
  // Honor explicit opt-outs.
  if (target.hasAttribute("download")) return;
  if (target.target && target.target !== "_self") return;
  if (target.hasAttribute("data-jslop-reload")) return;
  const href = target.getAttribute("href");
  if (!href) return;
  // Cross-origin / protocol links → let the browser handle them.
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) {
    try {
      const u = new URL(target.href);
      if (u.origin !== window.location.origin) return;
    } catch {
      return;
    }
  }
  if (href.startsWith("#")) return;
  e.preventDefault();
  const url = new URL(target.href, window.location.href);
  void navigate(url.pathname + url.search + url.hash, { push: true });
}

export async function navigate(
  url: string,
  { push = true }: { push?: boolean } = {}
): Promise<void> {
  const modules = bootedModules;
  if (!modules) {
    window.location.href = url;
    return;
  }
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "text/html" } });
  } catch (err) {
    console.error("[jslop] navigate failed:", err);
    window.location.href = url;
    return;
  }
  // Don't try to swap on non-HTML responses (e.g. a redirect to an asset);
  // fall back to a full reload so the browser handles it correctly.
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("text/html")) {
    window.location.href = url;
    return;
  }
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const newApp = doc.getElementById("app");
  const newCapsule = doc.getElementById("__jslop_capsule");
  if (!newApp || !newCapsule) {
    window.location.href = url;
    return;
  }

  // Tear down the previous page's reactive scopes so their effects stop
  // firing before we throw away their DOM. Without this, an unrelated cell
  // update could try to write into a node that no longer exists.
  for (const root of attachedRoots) {
    const scope = ROOT_SCOPES.get(root);
    if (scope) disposeScope(scope);
  }
  ROOT_SCOPES = new WeakMap();
  attachedRoots = [];

  if (push) {
    history.pushState(null, "", url);
  }

  // Update document.title from the new page.
  const newTitle = doc.querySelector("title")?.textContent;
  if (newTitle != null) document.title = newTitle;

  // Merge per-component scoped <style> tags. Each has a stable
  // data-jslop-style scope id; skip ones already present so the head doesn't
  // grow unbounded across navigations.
  for (const styleEl of doc.querySelectorAll("style[data-jslop-style]")) {
    const scope = styleEl.getAttribute("data-jslop-style");
    if (!scope) continue;
    if (!document.head.querySelector(`style[data-jslop-style="${cssEscape(scope)}"]`)) {
      document.head.appendChild(styleEl.cloneNode(true));
    }
  }

  // Swap content and capsule.
  const app = document.getElementById("app");
  const oldCapsule = document.getElementById("__jslop_capsule");
  if (!app || !oldCapsule) {
    window.location.href = url;
    return;
  }
  app.innerHTML = newApp.innerHTML;
  oldCapsule.textContent = newCapsule.textContent;

  // Scroll to top on forward navigations; back/forward keep their position.
  if (push) window.scrollTo(0, 0);

  bootCurrentPage(modules);
}

function cssEscape(s: string): string {
  // Minimal escape for the attribute-selector context we use it in. The scope
  // ids we generate are always `[a-z0-9-]+` so this is mostly belt-and-braces.
  return s.replace(/["\\]/g, "\\$&");
}

function attachElement(el: Element, node: ElNode, actions: Actions): void {
  for (const [evt, handler] of Object.entries(node.events)) {
    if (typeof handler !== "function") continue;
    el.addEventListener(evt, handler as EventListener);
  }
  for (const [k, v] of Object.entries(node.attrs)) {
    if (typeof v === "object" && v) {
      bindAttr(el, k, v as BindNode | PropNode);
    }
  }
  attachChildList(el, node.children, actions);
}

function bindAttr(el: Element, k: string, v: BindNode | PropNode): void {
  if (v.kind === "bind") {
    effect(() => {
      el.setAttribute(k, v.get());
    });
  } else {
    // Property bind: drive the IDL property directly so user-edited inputs
    // reflect programmatic cell changes (setAttribute('value') doesn't, after
    // the user has typed).
    effect(() => {
      const next = v.get();
      // Avoid a self-write loop when the user is typing: the input event
      // updates the cell, the cell triggers this effect, which would write
      // back the (now identical) value but in some browsers reset the caret
      // position. Skip when nothing would change.
      const cur = (el as unknown as Record<string, unknown>)[k];
      if (cur !== next) {
        (el as unknown as Record<string, unknown>)[k] = next as unknown;
      }
    });
  }
}

function attach(el: Element, node: ElNode, actions: Actions): void {
  attachElement(el, node, actions);
}

function attachChildList(parent: Element, viewChildren: ViewNode[], actions: Actions): void {
  const direct = Array.from(parent.children);
  const bindEls: Element[] = [];
  const ifEls: Element[] = [];
  const eachEls: Element[] = [];
  const elEls: Element[] = [];
  for (const c of direct) {
    const tag = c.tagName.toLowerCase();
    if (tag === "jslop-b") bindEls.push(c);
    else if (tag === "jslop-if") ifEls.push(c);
    else if (tag === "jslop-each") eachEls.push(c);
    else elEls.push(c);
  }
  let bI = 0;
  let ifI = 0;
  let eachI = 0;
  let eI = 0;
  for (const child of viewChildren) {
    if (child.kind === "text") continue;
    if (child.kind === "bind") {
      const target = bindEls[bI++];
      if (!target) continue;
      const bind = child;
      effect(() => {
        target.textContent = bind.get();
      });
    } else if (child.kind === "if") {
      const target = ifEls[ifI++];
      if (!target) continue;
      mountIf(target, child, actions);
    } else if (child.kind === "each") {
      const target = eachEls[eachI++];
      if (!target) continue;
      mountEach(target, child, actions);
    } else if (child.kind === "component") {
      const target = elEls[eI++];
      if (!target) continue;
      attach(target, child.view, child.instance.actions);
    } else if (child.kind === "children") {
      // The <children/> placeholder was replaced at SSR with the routed child's
      // root element. Skip past it without recursing: the child component owns
      // its own attach via its data-jslop-cid in the capsule.
      eI++;
    } else {
      const target = elEls[eI++];
      if (!target) continue;
      attach(target, child, actions);
    }
  }
}

interface ItemEntry {
  el: Element;
  scope: Scope;
}

function mountEach(wrapper: Element, node: EachNode, actions: Actions): void {
  const ssrCount = Number(wrapper.getAttribute("data-jslop-count") ?? "0");
  const ssrKeyed = wrapper.getAttribute("data-jslop-keyed") === "t";
  const keyed = typeof node.key === "function";
  let mounted = false;
  // Live map of key (as string) → entry, for keyed reconciliation.
  // For unkeyed lists we just keep an ordered array of entries.
  const byKey = new Map<string, ItemEntry>();
  const ordered: ItemEntry[] = [];

  effect(() => {
    const list = Array.from(node.each() as Iterable<unknown>);

    if (!mounted) {
      mounted = true;
      const existingItems = Array.from(wrapper.children).filter(
        (c) => c.tagName.toLowerCase() === "jslop-each-item"
      );
      if (list.length === ssrCount && list.length === existingItems.length) {
        // Hydrate in place: adopt SSR DOM, attach effects per-item in its own scope.
        for (let i = 0; i < list.length; i++) {
          const itemEl = existingItems[i]!;
          const itemScope = createScope();
          const item = list[i];
          runInScope(itemScope, () => {
            const itemView = node.build(item, i);
            attachChildList(itemEl, itemView, actions);
          });
          const entry: ItemEntry = { el: itemEl, scope: itemScope };
          ordered.push(entry);
          if (keyed && ssrKeyed) {
            const k = String(node.key!(item, i));
            byKey.set(k, entry);
          }
        }
        return;
      }
      // SSR/runtime mismatch — fall through to a fresh build, discarding SSR DOM.
      while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild);
    }

    if (keyed) {
      reconcileKeyed(wrapper, node, list, actions, byKey, ordered);
    } else {
      reconcileUnkeyed(wrapper, node, list, actions, ordered);
    }
    wrapper.setAttribute("data-jslop-count", String(list.length));
  });
}

function reconcileKeyed(
  wrapper: Element,
  node: EachNode,
  list: unknown[],
  actions: Actions,
  byKey: Map<string, ItemEntry>,
  ordered: ItemEntry[]
): void {
  const nextKeys: string[] = new Array(list.length);
  for (let i = 0; i < list.length; i++) {
    nextKeys[i] = String(node.key!(list[i], i));
  }
  const nextSet = new Set(nextKeys);

  // Dispose entries that are gone.
  for (const [k, entry] of [...byKey]) {
    if (!nextSet.has(k)) {
      disposeScope(entry.scope);
      if (entry.el.parentNode === wrapper) wrapper.removeChild(entry.el);
      byKey.delete(k);
    }
  }

  // Build new entries; reorder existing ones to match `nextKeys`.
  // Simple anchor-based pass: walk left-to-right, ensure DOM child at index i
  // matches the expected entry; if not, insertBefore to move it into place.
  ordered.length = 0;
  for (let i = 0; i < nextKeys.length; i++) {
    const k = nextKeys[i]!;
    let entry = byKey.get(k);
    const item = list[i];
    if (!entry) {
      const itemEl = document.createElement("jslop-each-item");
      itemEl.setAttribute("data-jslop-key", k);
      itemEl.style.display = "contents";
      const scope = createScope();
      runInScope(scope, () => {
        const itemView = node.build(item, i);
        for (const child of itemView) {
          const built = buildNode(child, actions);
          if (built) itemEl.appendChild(built);
        }
      });
      entry = { el: itemEl, scope };
      byKey.set(k, entry);
    }
    // Ensure correct DOM position.
    const currentAt = wrapper.children[i] ?? null;
    if (currentAt !== entry.el) {
      wrapper.insertBefore(entry.el, currentAt);
    }
    ordered.push(entry);
  }
}

function reconcileUnkeyed(
  wrapper: Element,
  node: EachNode,
  list: unknown[],
  actions: Actions,
  ordered: ItemEntry[]
): void {
  for (const entry of ordered) {
    disposeScope(entry.scope);
    if (entry.el.parentNode === wrapper) wrapper.removeChild(entry.el);
  }
  ordered.length = 0;
  for (let i = 0; i < list.length; i++) {
    const itemEl = document.createElement("jslop-each-item");
    itemEl.style.display = "contents";
    const scope = createScope();
    runInScope(scope, () => {
      const itemView = node.build(list[i], i);
      for (const child of itemView) {
        const built = buildNode(child, actions);
        if (built) itemEl.appendChild(built);
      }
    });
    wrapper.appendChild(itemEl);
    ordered.push({ el: itemEl, scope });
  }
}

function mountIf(wrapper: Element, node: IfNode, actions: Actions): void {
  const ssrActive = wrapper.getAttribute("data-jslop-active") === "t";
  let mounted = false;
  let lastBranch: boolean | null = null;
  let branchScope: Scope | null = null;

  effect(() => {
    const active = !!node.test();
    if (active === lastBranch) return;
    lastBranch = active;

    if (!mounted) {
      mounted = true;
      if (active === ssrActive) {
        const branch = active ? node.consequent : node.alternate;
        branchScope = createScope();
        runInScope(branchScope, () => attachChildList(wrapper, branch, actions));
        return;
      }
    }

    if (branchScope) disposeScope(branchScope);
    branchScope = createScope();
    runInScope(branchScope, () => rebuildIf(wrapper, node, active, actions));
  });
}

function rebuildIf(wrapper: Element, node: IfNode, active: boolean, actions: Actions): void {
  while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild);
  const branch = active ? node.consequent : node.alternate;
  for (const child of branch) {
    const built = buildNode(child, actions);
    if (built) wrapper.appendChild(built);
  }
  wrapper.setAttribute("data-jslop-active", active ? "t" : "f");
}

function buildNode(node: ViewNode, actions: Actions): Node | null {
  if (node.kind === "text") return document.createTextNode(node.value);
  if (node.kind === "children") {
    // A <children/> placeholder rebuilt at runtime (e.g. inside an {#if} that
    // flipped after hydration) can't synthesize the routed page out of nothing.
    // For now this is unsupported — layouts should keep <children/> in a static
    // position. Emit a marker so it's visible in DOM and skipped on next attach.
    return document.createElement("jslop-children");
  }
  if (node.kind === "bind") {
    const w = document.createElement("jslop-b");
    const b = node;
    effect(() => {
      w.textContent = b.get();
    });
    return w;
  }
  if (node.kind === "if") {
    const w = document.createElement("jslop-if");
    let lastBranch: boolean | null = null;
    let branchScope: Scope | null = null;
    effect(() => {
      const active = !!node.test();
      if (active === lastBranch) return;
      lastBranch = active;
      if (branchScope) disposeScope(branchScope);
      branchScope = createScope();
      runInScope(branchScope, () => rebuildIf(w, node, active, actions));
    });
    return w;
  }
  if (node.kind === "each") {
    const w = document.createElement("jslop-each");
    w.style.display = "contents";
    if (typeof node.key === "function") w.setAttribute("data-jslop-keyed", "t");
    mountEach(w, node, actions);
    return w;
  }
  if (node.kind === "component") {
    const view = node.view;
    const el = document.createElement(view.tag);
    el.setAttribute("data-jslop-component", node.name);
    buildElementInto(el, view, node.instance.actions);
    return el;
  }
  const el = document.createElement(node.tag);
  buildElementInto(el, node, actions);
  return el;
}

function buildElementInto(el: Element, node: ElNode, actions: Actions): void {
  for (const [k, v] of Object.entries(node.attrs)) {
    if (typeof v === "string") {
      el.setAttribute(k, v);
    } else {
      bindAttr(el, k, v as BindNode | PropNode);
    }
  }
  for (const [evt, handler] of Object.entries(node.events)) {
    if (typeof handler !== "function") continue;
    el.addEventListener(evt, handler as EventListener);
  }
  for (const child of node.children) {
    const built = buildNode(child, actions);
    if (built) el.appendChild(built);
  }
}
