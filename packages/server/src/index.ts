import { getRegisteredStyle } from "@jslop/runtime";

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
  buildHead?(): RenderNode[];
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
  /** Rendered HTML for the page <head>, from each component's `head { … }` block. */
  head: string;
  /** Every component name rendered in this tree (used to inject scoped styles). */
  nestedComponents: Set<string>;
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
  // Track every nested component name encountered while rendering this tree
  // so renderPage can emit a <style> tag for each unique name. Without this,
  // a route's <PresetCard/>s in an each block would inherit no styles.
  const nestedComponents = new Set<string>([component.name]);
  const html = renderElement(view, { cid, componentName: component.name }, nestedComponents);
  const head = renderHeadNodes(instance.buildHead?.() ?? []);
  return {
    html,
    head,
    nestedComponents,
    capsule: {
      components: [{ cid, name: component.name, props, state: instance.serializeState() }],
    },
  };
}

function renderHeadNodes(nodes: RenderNode[]): string {
  return nodes.map((n) => renderHeadNode(n)).join("");
}

/**
 * Render a head fragment node WITHOUT the <jslop-b> bind wrapper that the body
 * renderer emits — head text bindings (e.g. inside <title>) must produce raw
 * text so the browser sees a clean tag. Head is server-only anyway; there is
 * no client-side reactivity to hydrate against.
 */
function renderHeadNode(node: RenderNode): string {
  if (node.kind === "text") return escapeHtml(node.value);
  if (node.kind === "bind") return escapeHtml(node.get());
  if (node.kind === "element") {
    const attrParts: string[] = [];
    for (const [k, v] of Object.entries(node.attrs)) {
      if (typeof v === "string") attrParts.push(`${k}="${escapeAttr(v)}"`);
      else if (v.kind === "bind") attrParts.push(`${k}="${escapeAttr(v.get())}"`);
      else if (v.kind === "prop") attrParts.push(`${k}="${escapeAttr(String(v.get() ?? ""))}"`);
    }
    const open = `<${node.tag}${attrParts.length ? " " + attrParts.join(" ") : ""}>`;
    if (VOID_ELEMENTS.has(node.tag)) return open;
    const inner = node.children.map(renderHeadNode).join("");
    return `${open}${inner}</${node.tag}>`;
  }
  throw new Error(`head fragments only support static elements, text, and {expr} — got '${node.kind}'`);
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
  /**
   * Props passed to every layout in the chain. Typically the merged result
   * of each layout's `load()`, so a layout can declare `prop user = null`
   * and have it injected by its own loader.
   */
  layoutProps?: Record<string, unknown>;
}): RenderResult {
  const layouts = opts.layouts ?? [];
  let cidCounter = 0;
  const nextCid = (): string => `c${cidCounter++}`;

  const routeResult = renderComponent(opts.route, opts.routeProps ?? {}, nextCid());
  let html = routeResult.html;
  const components = [...routeResult.capsule.components];
  const nestedComponents = new Set(routeResult.nestedComponents);
  // Layouts contribute their head first (outermost → innermost), then the
  // route's head — so the route's <title>/meta ends up last in the document
  // head and wins for any duplicate tags the browser de-dupes by position.
  const headParts: string[] = [];

  // Wrap innermost-first so each replacement targets the *current* outermost
  // placeholder. The CHILDREN_PLACEHOLDER constant is unique enough that a
  // literal string replace is safe here (we never emit it for user content).
  for (let i = layouts.length - 1; i >= 0; i--) {
    const layout = layouts[i]!;
    const layoutResult = renderComponent(layout, opts.layoutProps ?? {}, nextCid());
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
    for (const n of layoutResult.nestedComponents) nestedComponents.add(n);
    headParts.unshift(layoutResult.head);
  }
  headParts.push(routeResult.head);

  return { html, head: headParts.join(""), nestedComponents, capsule: { components } };
}

interface ElMarker {
  cid?: string;
  componentName?: string;
}

function renderNode(node: RenderNode, registry: Set<string>): string {
  if (node.kind === "text") return escapeHtml(node.value);
  if (node.kind === "children") return CHILDREN_PLACEHOLDER;
  if (node.kind === "bind") {
    return `<jslop-b>${escapeHtml(node.get())}</jslop-b>`;
  }
  if (node.kind === "if") {
    const active = !!node.test();
    const branch = active ? node.consequent : node.alternate;
    const inner = branch.map((c) => renderNode(c, registry)).join("");
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
        `<jslop-each-item${keyAttr} style="display:contents">${itemChildren.map((c) => renderNode(c, registry)).join("")}</jslop-each-item>`
      );
      i++;
    }
    const keyedAttr = keyed ? ` data-jslop-keyed="t"` : "";
    return `<jslop-each data-jslop-count="${i}"${keyedAttr} style="display:contents">${itemsHtml.join("")}</jslop-each>`;
  }
  if (node.kind === "component") {
    if (node.view.kind !== "element") {
      throw new Error(`component ${node.name}: root view must be an element`);
    }
    registry.add(node.name);
    return renderElement(node.view, { componentName: node.name }, registry);
  }
  return renderElement(node, {}, registry);
}

function renderElement(
  node: Extract<RenderNode, { kind: "element" }>,
  marker: ElMarker,
  registry: Set<string>
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
  const inner = node.children.map((c) => renderNode(c, registry)).join("");
  return `${open}${inner}</${node.tag}>`;
}

export function renderPage(opts: {
  title: string;
  component: JSlopComponent;
  /** Layouts wrapping the route, outermost first. Each must have `<children/>`. */
  layouts?: JSlopComponent[];
  appScriptUrl: string;
  props?: Record<string, unknown>;
  /** Props passed to every layout (typically a merged layout-load result). */
  layoutProps?: Record<string, unknown>;
  stylesheets?: string[];
  head?: string;
}): string {
  const { html, head: componentHead, nestedComponents, capsule } =
    opts.layouts && opts.layouts.length > 0
      ? renderRouteChain({
          route: opts.component,
          routeProps: opts.props ?? {},
          layouts: opts.layouts,
          layoutProps: opts.layoutProps ?? {},
        })
      : renderComponent(opts.component, opts.props ?? {});
  const capsuleJson = JSON.stringify(capsule).replace(/</g, "\\u003c");
  const linkTags = (opts.stylesheets ?? [])
    .map((href) => `<link rel="stylesheet" href="${escapeAttr(href)}">`)
    .join("");
  const extraHead = opts.head ?? "";
  // If the component emitted its own <title>, use it as the document title and
  // suppress the fallback (browsers honor the *last* <title>, but emitting two
  // is sloppy). Search the rendered head for a <title>…</title> tag.
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/.exec(componentHead);
  const fallbackTitle = titleMatch ? "" : `<title>${escapeHtml(opts.title)}</title>\n`;
  // Collect one <style> per unique component name rendered on this page. The
  // capsule lists every mounted component in order; dedup by name so a list of
  // 100 <Card/>s only emits the Card style once.
  const styleTags: string[] = [];
  const emittedStyleScopes = new Set<string>();
  for (const name of nestedComponents) {
    const reg = getRegisteredStyle(name);
    if (!reg || emittedStyleScopes.has(reg.scope)) continue;
    emittedStyleScopes.add(reg.scope);
    styleTags.push(`<style data-jslop-style="${escapeAttr(reg.scope)}">${reg.css}</style>`);
  }
  const componentStyles = styleTags.join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${fallbackTitle}${linkTags}${componentStyles}${componentHead}${extraHead}</head>
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
