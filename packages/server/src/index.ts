export type RenderAttr = string | { kind: "bind"; get: () => string };

export type RenderNode =
  | { kind: "text"; value: string }
  | { kind: "bind"; get: () => string }
  | { kind: "component"; name: string; instance: RiftInstance; view: RenderNode }
  | { kind: "if"; test: () => unknown; consequent: RenderNode[]; alternate: RenderNode[] }
  | { kind: "each"; each: () => Iterable<unknown>; build: (item: unknown, index: number) => RenderNode[] }
  | {
      kind: "element";
      tag: string;
      attrs: Record<string, RenderAttr>;
      events: Record<string, (e: Event) => unknown>;
      children: RenderNode[];
    };

export interface RiftInstance {
  actions: Record<string, (...args: unknown[]) => unknown>;
  buildView(): RenderNode;
  serializeState(): Record<string, unknown>;
  restoreState(s: Record<string, unknown>): void;
  children?: RiftInstance[];
}

export interface RiftComponent {
  name: string;
  create(props?: Record<string, unknown>): RiftInstance;
}

export interface RenderResult {
  html: string;
  capsule: {
    components: Array<{
      cid: string;
      name: string;
      props: Record<string, unknown>;
      state: Record<string, unknown>;
    }>;
  };
}

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

export function renderComponent(
  component: RiftComponent,
  props: Record<string, unknown> = {},
  cid = "c0"
): RenderResult {
  const instance = component.create(props);
  const view = instance.buildView();
  if (view.kind !== "element") {
    throw new Error(`component ${component.name}: root view must be an element`);
  }
  const html = renderElement(view, { cid, componentName: component.name });
  return {
    html,
    capsule: {
      components: [{ cid, name: component.name, props, state: instance.serializeState() }],
    },
  };
}

interface ElMarker {
  cid?: string;
  componentName?: string;
}

function renderNode(node: RenderNode): string {
  if (node.kind === "text") return escapeHtml(node.value);
  if (node.kind === "bind") {
    return `<rift-b>${escapeHtml(node.get())}</rift-b>`;
  }
  if (node.kind === "if") {
    const active = !!node.test();
    const branch = active ? node.consequent : node.alternate;
    const inner = branch.map(renderNode).join("");
    return `<rift-if data-rift-active="${active ? "t" : "f"}">${inner}</rift-if>`;
  }
  if (node.kind === "each") {
    const source = node.each();
    let i = 0;
    const itemsHtml: string[] = [];
    for (const item of source) {
      const itemChildren = node.build(item, i);
      itemsHtml.push(`<rift-each-item>${itemChildren.map(renderNode).join("")}</rift-each-item>`);
      i++;
    }
    return `<rift-each data-rift-count="${i}">${itemsHtml.join("")}</rift-each>`;
  }
  if (node.kind === "component") {
    if (node.view.kind !== "element") {
      throw new Error(`component ${node.name}: root view must be an element`);
    }
    return renderElement(node.view, { componentName: node.name });
  }
  return renderElement(node, {});
}

function renderElement(
  node: Extract<RenderNode, { kind: "element" }>,
  marker: ElMarker
): string {
  const attrParts: string[] = [];
  for (const [k, v] of Object.entries(node.attrs)) {
    if (typeof v === "string") {
      attrParts.push(`${k}="${escapeAttr(v)}"`);
    } else {
      const val = v.get();
      attrParts.push(`${k}="${escapeAttr(val)}" data-rift-attr-${k}=""`);
    }
  }
  for (const evt of Object.keys(node.events)) {
    attrParts.push(`data-rift-on-${evt}=""`);
  }
  if (marker.cid) {
    attrParts.push(`data-rift-cid="${escapeAttr(marker.cid)}"`);
  }
  if (marker.componentName) {
    attrParts.push(`data-rift-component="${escapeAttr(marker.componentName)}"`);
  }
  const open = `<${node.tag}${attrParts.length ? " " + attrParts.join(" ") : ""}>`;
  if (VOID_ELEMENTS.has(node.tag)) return open;
  const inner = node.children.map(renderNode).join("");
  return `${open}${inner}</${node.tag}>`;
}

export function renderPage(opts: {
  title: string;
  component: RiftComponent;
  appScriptUrl: string;
  props?: Record<string, unknown>;
  stylesheets?: string[];
  head?: string;
}): string {
  const { html, capsule } = renderComponent(opts.component, opts.props ?? {});
  const capsuleJson = JSON.stringify(capsule).replace(/</g, "\\u003c");
  const linkTags = (opts.stylesheets ?? [])
    .map((href) => `<link rel="stylesheet" href="${escapeAttr(href)}">`)
    .join("");
  const extraHead = opts.head ?? "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
${linkTags}${extraHead}</head>
<body>
<div id="app">${html}</div>
<script type="application/rift+json" id="__rift_capsule">${capsuleJson}</script>
<script type="module" src="${opts.appScriptUrl}"></script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}
