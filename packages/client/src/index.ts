import { effect } from "@rift/runtime";

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

    const inst = mod.create(entry.props ?? {});
    inst.restoreState(entry.state);
    const view = inst.buildView();
    attach(root, view, inst.actions);
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

function mountEach(wrapper: Element, node: EachNode, actions: Actions): void {
  const ssrCount = Number(wrapper.getAttribute("data-rift-count") ?? "0");
  let mounted = false;

  effect(() => {
    const list = Array.from(node.each() as Iterable<unknown>);
    if (!mounted) {
      mounted = true;
      const existingItems = Array.from(wrapper.children).filter(
        (c) => c.tagName.toLowerCase() === "rift-each-item"
      );
      if (list.length === ssrCount && list.length === existingItems.length) {
        for (let i = 0; i < list.length; i++) {
          const itemView = node.build(list[i], i);
          attachChildList(existingItems[i]!, itemView, actions);
        }
        return;
      }
    }
    rebuildEach(wrapper, node, list, actions);
  });
}

function rebuildEach(wrapper: Element, node: EachNode, list: unknown[], actions: Actions): void {
  while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild);
  for (let i = 0; i < list.length; i++) {
    const itemWrapper = document.createElement("rift-each-item");
    const itemView = node.build(list[i], i);
    for (const child of itemView) {
      const built = buildNode(child, actions);
      if (built) itemWrapper.appendChild(built);
    }
    wrapper.appendChild(itemWrapper);
  }
  wrapper.setAttribute("data-rift-count", String(list.length));
}

function mountIf(wrapper: Element, node: IfNode, actions: Actions): void {
  const ssrActive = wrapper.getAttribute("data-rift-active") === "t";
  let mounted = false;
  let lastBranch: boolean | null = null;

  effect(() => {
    const active = !!node.test();
    if (active === lastBranch) return;
    lastBranch = active;

    if (!mounted) {
      mounted = true;
      if (active === ssrActive) {
        const branch = active ? node.consequent : node.alternate;
        attachChildList(wrapper, branch, actions);
        return;
      }
    }

    rebuildIf(wrapper, node, active, actions);
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
    const active = !!node.test();
    w.setAttribute("data-rift-active", active ? "t" : "f");
    const branch = active ? node.consequent : node.alternate;
    for (const child of branch) {
      const built = buildNode(child, actions);
      if (built) w.appendChild(built);
    }
    // Subscribe to future changes
    let lastBranch: boolean = active;
    effect(() => {
      const nowActive = !!node.test();
      if (nowActive === lastBranch) return;
      lastBranch = nowActive;
      rebuildIf(w, node, nowActive, actions);
    });
    return w;
  }
  if (node.kind === "each") {
    const w = document.createElement("rift-each");
    const list = Array.from(node.each() as Iterable<unknown>);
    rebuildEach(w, node, list, actions);
    let lastLen = list.length;
    let firstRun = true;
    effect(() => {
      const cur = Array.from(node.each() as Iterable<unknown>);
      if (firstRun) {
        firstRun = false;
        return;
      }
      rebuildEach(w, node, cur, actions);
      lastLen = cur.length;
    });
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
