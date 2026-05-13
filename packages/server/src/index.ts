export type RenderAttr =
  | string
  | { kind: "bind"; get: () => string }
  | { kind: "prop"; get: () => unknown };

export type RenderNode =
  | { kind: "text"; value: string }
  | { kind: "bind"; get: () => string }
  | { kind: "component"; name: string; instance: JSlopInstance; view: RenderNode }
  | { kind: "if"; test: () => unknown; consequent: RenderNode[]; alternate: RenderNode[] }
  | {
      kind: "each";
      each: () => Iterable<unknown>;
      build: (item: unknown, index: number) => RenderNode[];
      key?: (item: unknown, index: number) => unknown;
    }
  | { kind: "children" }
  | {
      kind: "element";
      tag: string;
      attrs: Record<string, RenderAttr>;
      events: Record<string, (e: Event) => unknown>;
      children: RenderNode[];
    };

export interface JSlopInstance {
  actions: Record<string, (...args: unknown[]) => unknown>;
  buildView(): RenderNode;
  serializeState(): Record<string, unknown>;
  restoreState(s: Record<string, unknown>): void;
  children?: JSlopInstance[];
}

export interface JSlopComponent {
  name: string;
  create(props?: Record<string, unknown>): JSlopInstance;
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

const CHILDREN_PLACEHOLDER = "<jslop-children></jslop-children>";

// HTML boolean attributes: presence implies true, absence implies false.
const BOOLEAN_ATTRS = new Set([
  "checked", "disabled", "readonly", "required", "selected", "multiple",
  "hidden", "autofocus", "autoplay", "controls", "loop", "muted",
  "open", "reversed", "default",
]);

export function renderComponent(
  component: JSlopComponent,
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

/**
 * Render a route nested inside zero or more layouts. Each layout must contain
 * exactly one `<children/>` placeholder; the inner HTML is substituted in.
 * Capsule entries are merged with unique cids so the client can boot each
 * island independently.
 */
export function renderRouteChain(opts: {
  route: JSlopComponent;
  routeProps?: Record<string, unknown>;
  /** Outermost layout first. Each layout must have a `<children/>`. */
  layouts?: JSlopComponent[];
}): RenderResult {
  const layouts = opts.layouts ?? [];
  let cidCounter = 0;
  const nextCid = (): string => `c${cidCounter++}`;

  const routeResult = renderComponent(opts.route, opts.routeProps ?? {}, nextCid());
  let html = routeResult.html;
  const components = [...routeResult.capsule.components];

  // Wrap innermost-first so each replacement targets the *current* outermost
  // placeholder. The CHILDREN_PLACEHOLDER constant is unique enough that a
  // literal string replace is safe here (we never emit it for user content).
  for (let i = layouts.length - 1; i >= 0; i--) {
    const layout = layouts[i]!;
    const layoutResult = renderComponent(layout, {}, nextCid());
    const idx = layoutResult.html.indexOf(CHILDREN_PLACEHOLDER);
    if (idx === -1) {
      throw new Error(
        `layout ${layout.name} has no <children/> element — required for routed content`
      );
    }
    html =
      layoutResult.html.slice(0, idx) +
      html +
      layoutResult.html.slice(idx + CHILDREN_PLACEHOLDER.length);
    components.push(...layoutResult.capsule.components);
  }

  return { html, capsule: { components } };
}

interface ElMarker {
  cid?: string;
  componentName?: string;
}

function renderNode(node: RenderNode): string {
  if (node.kind === "text") return escapeHtml(node.value);
  if (node.kind === "children") return CHILDREN_PLACEHOLDER;
  if (node.kind === "bind") {
    return `<jslop-b>${escapeHtml(node.get())}</jslop-b>`;
  }
  if (node.kind === "if") {
    const active = !!node.test();
    const branch = active ? node.consequent : node.alternate;
    const inner = branch.map(renderNode).join("");
    return `<jslop-if data-jslop-active="${active ? "t" : "f"}">${inner}</jslop-if>`;
  }
  if (node.kind === "each") {
    const source = node.each();
    let i = 0;
    const itemsHtml: string[] = [];
    const keyed = typeof node.key === "function";
    for (const item of source) {
      const itemChildren = node.build(item, i);
      const keyAttr = keyed
        ? ` data-jslop-key="${escapeAttr(String(node.key!(item, i)))}"`
        : "";
      itemsHtml.push(
        `<jslop-each-item${keyAttr}>${itemChildren.map(renderNode).join("")}</jslop-each-item>`
      );
      i++;
    }
    const keyedAttr = keyed ? ` data-jslop-keyed="t"` : "";
    return `<jslop-each data-jslop-count="${i}"${keyedAttr}>${itemsHtml.join("")}</jslop-each>`;
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
    } else if (v.kind === "bind") {
      const val = v.get();
      attrParts.push(`${k}="${escapeAttr(val)}" data-jslop-attr-${k}=""`);
    } else {
      // kind: "prop" — boolean attributes render presence-based, others
      // stringify their value into the attribute.
      const val = v.get();
      if (BOOLEAN_ATTRS.has(k)) {
        if (val) attrParts.push(`${k}="" data-jslop-prop-${k}=""`);
      } else {
        attrParts.push(`${k}="${escapeAttr(String(val ?? ""))}" data-jslop-prop-${k}=""`);
      }
    }
  }
  for (const evt of Object.keys(node.events)) {
    attrParts.push(`data-jslop-on-${evt}=""`);
  }
  if (marker.cid) {
    attrParts.push(`data-jslop-cid="${escapeAttr(marker.cid)}"`);
  }
  if (marker.componentName) {
    attrParts.push(`data-jslop-component="${escapeAttr(marker.componentName)}"`);
  }
  const open = `<${node.tag}${attrParts.length ? " " + attrParts.join(" ") : ""}>`;
  if (VOID_ELEMENTS.has(node.tag)) return open;
  const inner = node.children.map(renderNode).join("");
  return `${open}${inner}</${node.tag}>`;
}

export function renderPage(opts: {
  title: string;
  component: JSlopComponent;
  /** Layouts wrapping the route, outermost first. Each must have `<children/>`. */
  layouts?: JSlopComponent[];
  appScriptUrl: string;
  props?: Record<string, unknown>;
  stylesheets?: string[];
  head?: string;
}): string {
  const { html, capsule } =
    opts.layouts && opts.layouts.length > 0
      ? renderRouteChain({
          route: opts.component,
          routeProps: opts.props ?? {},
          layouts: opts.layouts,
        })
      : renderComponent(opts.component, opts.props ?? {});
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
<script type="application/jslop+json" id="__jslop_capsule">${capsuleJson}</script>
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
