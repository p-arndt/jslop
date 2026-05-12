import { effect, createScope, runInScope, disposeScope, type Scope } from "@rift/runtime";

type Actions = Record<string, (...args: unknown[]) => unknown>;

type BindNode = { kind: "bind"; get: () => string };
type TextNode = { kind: "text"; value: string };
type ElNode = {
  kind: "element";
  tag: string;
  attrs: Record<string, string | BindNode>;
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
  instance: RiftInstance;
  view: ElNode;
};
type ViewNode = ElNode | TextNode | BindNode | ComponentNode | IfNode | EachNode;

interface RiftInstance {
  actions: Actions;
  buildView(): ElNode;
  serializeState(): Record<string, unknown>;
  restoreState(s: Record<string, unknown>): void;
}

interface RiftModule {
  name: string;
  create(props?: Record<string, unknown>): RiftInstance;
}

interface Capsule {
  components: Array<{
    cid: string;
    name: string;
    props: Record<string, unknown>;
    state: Record<string, unknown>;
  }>;
}

const ROOT_SCOPES = new WeakMap<Element, Scope>();

export function boot(modules: Record<string, RiftModule>): void {
  const capsuleEl = document.getElementById("__rift_capsule");
  if (!capsuleEl || !capsuleEl.textContent) return;
  const capsule = JSON.parse(capsuleEl.textContent) as Capsule;

  for (const entry of capsule.components) {
    const mod = modules[entry.name];
    if (!mod) {
      console.warn(`[rift] no module registered for component ${entry.name}`);
      continue;
    }
    const root = document.querySelector<HTMLElement>(`[data-rift-cid="${entry.cid}"]`);
    if (!root) continue;

    const previous = ROOT_SCOPES.get(root);
    if (previous) disposeScope(previous);
    const scope = createScope(null);
    ROOT_SCOPES.set(root, scope);

    runInScope(scope, () => {
      const inst = mod.create(entry.props ?? {});
      inst.restoreState(entry.state);
      const view = inst.buildView();
      attach(root, view, inst.actions);
    });
  }
}

function attachElement(el: Element, node: ElNode, actions: Actions): void {
  for (const [evt, handler] of Object.entries(node.events)) {
    if (typeof handler !== "function") continue;
    el.addEventListener(evt, handler as EventListener);
  }
  for (const [k, v] of Object.entries(node.attrs)) {
    if (typeof v === "object" && v && (v as BindNode).kind === "bind") {
      const bind = v as BindNode;
      effect(() => {
        el.setAttribute(k, bind.get());
      });
    }
  }
  attachChildList(el, node.children, actions);
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
    if (tag === "rift-b") bindEls.push(c);
    else if (tag === "rift-if") ifEls.push(c);
    else if (tag === "rift-each") eachEls.push(c);
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
  const ssrCount = Number(wrapper.getAttribute("data-rift-count") ?? "0");
  const ssrKeyed = wrapper.getAttribute("data-rift-keyed") === "t";
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
        (c) => c.tagName.toLowerCase() === "rift-each-item"
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
    wrapper.setAttribute("data-rift-count", String(list.length));
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
      const itemEl = document.createElement("rift-each-item");
      itemEl.setAttribute("data-rift-key", k);
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
    const itemEl = document.createElement("rift-each-item");
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
  const ssrActive = wrapper.getAttribute("data-rift-active") === "t";
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
  wrapper.setAttribute("data-rift-active", active ? "t" : "f");
}

function buildNode(node: ViewNode, actions: Actions): Node | null {
  if (node.kind === "text") return document.createTextNode(node.value);
  if (node.kind === "bind") {
    const w = document.createElement("rift-b");
    const b = node;
    effect(() => {
      w.textContent = b.get();
    });
    return w;
  }
  if (node.kind === "if") {
    const w = document.createElement("rift-if");
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
    const w = document.createElement("rift-each");
    if (typeof node.key === "function") w.setAttribute("data-rift-keyed", "t");
    mountEach(w, node, actions);
    return w;
  }
  if (node.kind === "component") {
    const view = node.view;
    const el = document.createElement(view.tag);
    el.setAttribute("data-rift-component", node.name);
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
      const bind = v as BindNode;
      effect(() => {
        el.setAttribute(k, bind.get());
      });
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
