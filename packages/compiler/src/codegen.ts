import type { ParsedComponent, ParsedFile, ParsedImport, ViewNode } from "./parser.js";
import { rewriteFnBody, rewriteExpr, rewritePropExpr } from "./rewrite.js";

export interface CodegenOptions {
  runtimeImport?: string;
  /** Rewrite imports of `./Foo.jslop` into the compiled file extension. Defaults to `.compiled.mjs`. */
  compiledExtension?: string;
}

export function generate(input: ParsedFile | ParsedComponent, opts: CodegenOptions = {}): string {
  const runtimeImport = opts.runtimeImport ?? "@jslop/runtime";
  const compiledExt = opts.compiledExtension ?? ".compiled.mjs";
  // Accept a bare ParsedComponent as shorthand for "single-component file with
  // no imports" — keeps small-test ergonomics working without forcing every
  // caller through parseFile.
  const file: ParsedFile =
    "components" in input ? input : { imports: [], components: [input] };

  const importLines = file.imports.map((imp) => emitImport(imp, compiledExt)).join("\n");

  const styleRegistrations: string[] = [];
  const blocks = file.components
    .map((c) => generateComponent(c, styleRegistrations))
    .join("\n\n");
  // The first declared component is the file's default — keeps single-component
  // files (the existing convention, including all routes/layouts) working
  // unchanged when a consumer does `import Comp from "./File.jslop"`.
  const first = file.components[0]!;
  const defaultLine = `export default ${first.name};`;
  // Route load() lives on the file's default component. We deliberately do
  // not emit load() for trailing components (e.g. a Stat helper alongside
  // PresetDetail) — only the default is exported as the route.
  const loadLine = first.load
    ? `export async function load(params) {\n${first.load}\n}`
    : "";

  return `import { cell, derived, isReactive, registerStyles, notFound } from "${runtimeImport}";
${importLines}

${styleRegistrations.join("\n")}
${blocks}

${defaultLine}
${loadLine}
`;
}

function emitImport(imp: ParsedImport, compiledExt: string): string {
  const path = imp.path.endsWith(".jslop")
    ? imp.path.slice(0, -".jslop".length) + compiledExt
    : imp.path;
  const clause: string[] = [];
  if (imp.defaultName) clause.push(imp.defaultName);
  if (imp.named.length > 0) {
    const specs = imp.named
      .map((s) => (s.imported === s.local ? s.imported : `${s.imported} as ${s.local}`))
      .join(", ");
    clause.push(`{ ${specs} }`);
  }
  return `import ${clause.join(", ")} from ${JSON.stringify(path)};`;
}

function generateComponent(comp: ParsedComponent, styleRegistrations: string[]): string {
  // Compute the per-component scope class from the style content. Stable
  // across builds, unique per (name, css) pair, and short enough not to bloat
  // the DOM. Using a small fnv hash here to avoid a node:crypto import — the
  // collision risk between two components in the same app is negligible.
  let scopeClass: string | null = null;
  if (comp.style != null) {
    const id = fnv1a32(comp.name + "::" + comp.style).toString(36);
    scopeClass = `jslop-${comp.name.toLowerCase()}-${id}`;
    const scoped = scopeCss(comp.style, scopeClass);
    styleRegistrations.push(
      `registerStyles(${JSON.stringify(comp.name)}, ${JSON.stringify(scopeClass)}, ${JSON.stringify(scoped)});`
    );
  }

  const reactiveNames = [
    ...comp.props.map((p) => p.name),
    ...comp.states.map((s) => s.name),
    ...comp.deriveds.map((d) => d.name),
  ];
  // Derived names are reactive (so reads go through .get()) but read-only at
  // the language level — assigning to one is a compile error, not a runtime
  // surprise.
  const derivedNames = comp.deriveds.map((d) => d.name);

  const propDecls = comp.props
    .map((p) => {
      const fallback = p.defaultExpr ?? "undefined";
      return `    const ${p.name} = isReactive(props?.${p.name}) ? props.${p.name} : cell(props?.${p.name} ?? (${fallback}));`;
    })
    .join("\n");

  const stateDecls = comp.states
    .map((s) => `    const ${s.name} = cell(${s.init});`)
    .join("\n");

  // Derived inits must be rewritten so reads of other reactive bindings track
  // as deps; otherwise the derived would never re-run when its inputs change.
  const derivedDecls = comp.deriveds
    .map((d) => `    const ${d.name} = derived(() => (${rewriteExpr(d.init, reactiveNames, derivedNames)}));`)
    .join("\n");

  const letDecls = comp.lets
    .map((l) => `    let ${l.name} = ${l.init};`)
    .join("\n");

  const fnDecls = comp.fns
    .map(
      (f) =>
        `    function ${f.name}(${f.params}) {\n${indent(rewriteFnBody(f.body, reactiveNames, derivedNames), 6)}\n    }`
    )
    .join("\n");

  const actionEntries = comp.fns.map((f) => `      ${f.name}`).join(",\n");

  const childCtx: ChildCtx = { counter: 0, decls: [], inlineDecls: null };
  const rootView = scopeClass ? injectScopeClass(comp.view, scopeClass) : comp.view;
  const viewExpr = emitNode(rootView, reactiveNames, 6, childCtx, derivedNames);
  // Head fragments are server-only metadata; they share the rewrite/emit
  // pipeline but live in their own child counter so head <Component/> tags
  // (rare but possible) don't collide with body children.
  const headCtx: ChildCtx = { counter: 1000, decls: [], inlineDecls: null };
  const headExprs = (comp.head ?? []).map((n) => emitNode(n, reactiveNames, 6, headCtx, derivedNames));
  const headFn = comp.head
    ? `    function buildHead() {\n      return [${headExprs.join(", ")}];\n    }`
    : `    function buildHead() { return []; }`;
  const childrenArr = childCtx.decls.length
    ? `[${childCtx.decls.map((_, i) => `__child_${i}`).join(", ")}]`
    : "[]";

  const stateSerializeEntries = comp.states.map((s) => `${s.name}: ${s.name}.peek()`);
  stateSerializeEntries.push("children: __children.map((c) => c.serializeState())");
  const stateSerialize = stateSerializeEntries.join(", ");

  const stateRestore = comp.states
    .map((s) => `        if ("${s.name}" in s) ${s.name}.set(s.${s.name});`)
    .join("\n");

  return `export const ${comp.name} = {
  name: ${JSON.stringify(comp.name)},
  create(props = {}) {
${propDecls}
${letDecls}
${stateDecls}
${derivedDecls}
${fnDecls}
    const actions = {
${actionEntries}
    };
${childCtx.decls.join("\n")}
    const __children = ${childrenArr};
    function buildView() {
      return ${viewExpr};
    }
${headFn}
    function serializeState() {
      return { ${stateSerialize} };
    }
    function restoreState(s) {
      if (!s) return;
${stateRestore}
      if (Array.isArray(s.children)) {
        for (let i = 0; i < __children.length; i++) {
          if (s.children[i]) __children[i].restoreState(s.children[i]);
        }
      }
    }
    return { actions, buildView, buildHead, serializeState, restoreState, children: __children };
  }
};`;
}

function indent(s: string, n: number): string {
  const pad = " ".repeat(n);
  return s.split("\n").map((line) => (line.length > 0 ? pad + line : line)).join("\n");
}

interface ChildCtx {
  counter: number;
  /**
   * Hoisted component declarations emitted at the parent component's create()
   * scope. Used for components in static positions so their instances persist
   * for the parent's lifetime and their state is serialized in __children.
   */
  decls: string[];
  /**
   * When non-null, component declarations are emitted inline as statements
   * inside the surrounding build callback (e.g. an each block), so each
   * iteration gets its own instance with item-bound props.
   */
  inlineDecls: string[] | null;
}

function emitNode(
  node: ViewNode,
  reactiveNames: string[],
  depth: number,
  childCtx: ChildCtx,
  derivedNames: string[] = []
): string {
  const pad = " ".repeat(depth);
  if (node.kind === "text") {
    return `{ kind: "text", value: ${JSON.stringify(node.value)} }`;
  }
  if (node.kind === "children") {
    return `{ kind: "children" }`;
  }
  if (node.kind === "expr") {
    const e = rewriteExpr(node.expr, reactiveNames, derivedNames);
    return `{ kind: "bind", get: () => String(${e}) }`;
  }
  if (node.kind === "if") {
    const test = rewriteExpr(node.test, reactiveNames, derivedNames);
    const cons = node.consequent.map((ch) => emitNode(ch, reactiveNames, depth + 2, childCtx, derivedNames));
    const alt = node.alternate.map((ch) => emitNode(ch, reactiveNames, depth + 2, childCtx, derivedNames));
    const consStr =
      cons.length === 0 ? "[]" : `[\n${pad}  ${cons.join(`,\n${pad}  `)}\n${pad}]`;
    const altStr =
      alt.length === 0 ? "[]" : `[\n${pad}  ${alt.join(`,\n${pad}  `)}\n${pad}]`;
    return `{ kind: "if", test: () => (${test}), consequent: ${consStr}, alternate: ${altStr} }`;
  }
  if (node.kind === "each") {
    const eachExpr = rewriteExpr(node.each, reactiveNames, derivedNames);
    // Shadow `as` and optional `index` names so they're not rewritten as cells.
    const innerReactive = reactiveNames.filter(
      (n) => n !== node.as && n !== node.index
    );
    // Open a new inline-declaration scope so any components nested inside the
    // each are instantiated per-item rather than hoisted.
    const buildLocals: string[] = [];
    const subCtx: ChildCtx = {
      counter: childCtx.counter,
      decls: childCtx.decls,
      inlineDecls: buildLocals,
    };
    // Shadowing extends to derivedNames too (an item binding can shadow a
    // derived of the same name within the each scope).
    const innerDerived = derivedNames.filter((n) => n !== node.as && n !== node.index);
    const childStrs = node.children.map((ch) => emitNode(ch, innerReactive, depth + 2, subCtx, innerDerived));
    childCtx.counter = subCtx.counter;
    const childrenLit =
      childStrs.length === 0 ? "[]" : `[\n${pad}    ${childStrs.join(`,\n${pad}    `)}\n${pad}  ]`;
    const paramList = node.index ? `(${node.as}, ${node.index})` : `(${node.as})`;
    const buildBody =
      buildLocals.length === 0
        ? `(${childrenLit})`
        : `{\n${pad}    ${buildLocals.join(`\n${pad}    `)}\n${pad}    return ${childrenLit};\n${pad}  }`;
    const keyPart = node.key
      ? `, key: ${paramList} => (${rewriteExpr(node.key, innerReactive, innerDerived)})`
      : "";
    return `{ kind: "each", each: () => (${eachExpr}), build: ${paramList} => ${buildBody}${keyPart} }`;
  }
  if (node.kind === "component") {
    const idx = childCtx.counter++;
    const propEntries = Object.entries(node.props).map(([k, v]) => {
      if (v.startsWith("__expr:")) {
        // Pass bare reactive identifiers through by reference (so the child
        // gets the cell and re-renders on change). But still rewrite assignments
        // inside nested arrows / functions, otherwise `oninput={e => count = ...}`
        // would emit a literal `count = ...` against a const cell binding.
        return `${JSON.stringify(k)}: (${rewritePropExpr(v.slice("__expr:".length), reactiveNames, derivedNames)})`;
      }
      return `${JSON.stringify(k)}: ${v}`;
    });
    const propsLit = `{ ${propEntries.join(", ")} }`;
    if (childCtx.inlineDecls) {
      const varName = `__c_${idx}`;
      childCtx.inlineDecls.push(`const ${varName} = ${node.name}.create(${propsLit});`);
      return `{ kind: "component", name: ${JSON.stringify(node.name)}, instance: ${varName}, view: ${varName}.buildView() }`;
    }
    const varName = `__child_${idx}`;
    childCtx.decls.push(`      const ${varName} = ${node.name}.create(${propsLit});`);
    return `{ kind: "component", name: ${JSON.stringify(node.name)}, instance: ${varName}, view: ${varName}.buildView() }`;
  }
  const attrEntries = Object.entries(node.attrs).map(([k, v]) => {
    if (v.startsWith("__expr:")) {
      const e = rewriteExpr(v.slice("__expr:".length), reactiveNames, derivedNames);
      return `${JSON.stringify(k)}: { kind: "bind", get: () => String(${e}) }`;
    }
    if (v.startsWith("__prop:")) {
      // Property bind: forward the value directly to the IDL property; no
      // String() coercion (so booleans stay booleans for `checked`).
      const e = rewriteExpr(v.slice("__prop:".length), reactiveNames, derivedNames);
      return `${JSON.stringify(k)}: { kind: "prop", get: () => (${e}) }`;
    }
    return `${JSON.stringify(k)}: ${v}`;
  });
  const eventEntries = Object.entries(node.events).map(
    ([evt, handler]) => `${JSON.stringify(evt)}: (${rewriteFnBody(handler, reactiveNames, derivedNames)})`
  );
  const children = node.children.map((ch) => emitNode(ch, reactiveNames, depth + 2, childCtx, derivedNames));

  const attrsStr = attrEntries.length > 0 ? `{ ${attrEntries.join(", ")} }` : "{}";
  const eventsStr = eventEntries.length > 0 ? `{ ${eventEntries.join(", ")} }` : "{}";
  const childrenStr =
    children.length === 0
      ? "[]"
      : `[\n${pad}  ${children.join(`,\n${pad}  `)}\n${pad}]`;

  return `{ kind: "element", tag: ${JSON.stringify(node.tag)}, attrs: ${attrsStr}, events: ${eventsStr}, children: ${childrenStr} }`;
}

/**
 * Clone the root element and append `scopeClass` to its `class` attribute.
 * Handles both static-string class (most common) and `{expr}` class. For an
 * expression form we concatenate at runtime via a template literal.
 */
function injectScopeClass(root: ViewNode, scopeClass: string): ViewNode {
  if (root.kind !== "element") return root;
  const attrs = { ...root.attrs };
  const existing = attrs.class;
  if (existing === undefined) {
    attrs.class = JSON.stringify(scopeClass);
  } else if (existing.startsWith("__expr:")) {
    const expr = existing.slice("__expr:".length);
    attrs.class = `__expr:((${expr}) + " ${scopeClass}")`;
  } else {
    // existing is a JSON-encoded string literal like `"foo bar"`
    const parsed = JSON.parse(existing) as string;
    attrs.class = JSON.stringify(parsed + " " + scopeClass);
  }
  return { ...root, attrs };
}

/**
 * Prepend `.${scope}` to every comma-separated selector in `css`, recursing
 * into at-rule bodies (`@media`, `@supports`) so their inner rules are scoped
 * too. Selectors inside `@keyframes` are left alone — those are keyframe
 * stops, not real DOM selectors.
 */
function scopeCss(css: string, scope: string): string {
  let i = 0;
  const out: string[] = [];
  const n = css.length;

  function readUntilTopLevel(stops: string[]): string {
    const start = i;
    let depth = 0;
    while (i < n) {
      const ch = css[i]!;
      if (ch === '"' || ch === "'") {
        const q = ch;
        i++;
        while (i < n && css[i] !== q) {
          if (css[i] === "\\") i++;
          i++;
        }
        i++;
        continue;
      }
      if (ch === "/" && css[i + 1] === "*") {
        const end = css.indexOf("*/", i + 2);
        i = end === -1 ? n : end + 2;
        continue;
      }
      if (ch === "(") { depth++; i++; continue; }
      if (ch === ")") { depth--; i++; continue; }
      if (depth === 0 && stops.includes(ch)) return css.slice(start, i);
      i++;
    }
    return css.slice(start, i);
  }

  function processBlock(end: string): void {
    while (i < n) {
      // skip leading whitespace (preserved as-is in output)
      const wsStart = i;
      while (i < n && /\s/.test(css[i]!)) i++;
      out.push(css.slice(wsStart, i));
      if (i >= n) return;
      if (end && css[i] === end) { return; }
      // comment
      if (css[i] === "/" && css[i + 1] === "*") {
        const e = css.indexOf("*/", i + 2);
        const stop = e === -1 ? n : e + 2;
        out.push(css.slice(i, stop));
        i = stop;
        continue;
      }
      // at-rule
      if (css[i] === "@") {
        const ruleStart = i;
        const sel = readUntilTopLevel(["{", ";"]);
        const name = /^@([A-Za-z-]+)/.exec(sel)?.[1] ?? "";
        if (i < n && css[i] === ";") {
          out.push(css.slice(ruleStart, i + 1));
          i++;
          continue;
        }
        // block at-rule: `@media (...) { ... }`
        out.push(sel + "{");
        i++; // skip {
        if (name === "keyframes" || name === "-webkit-keyframes") {
          // Pass the keyframe stops through verbatim.
          let depth = 1;
          const inner = i;
          while (i < n && depth > 0) {
            if (css[i] === "{") depth++;
            else if (css[i] === "}") depth--;
            if (depth > 0) i++;
          }
          out.push(css.slice(inner, i));
        } else {
          processBlock("}");
        }
        if (i < n && css[i] === "}") { out.push("}"); i++; }
        continue;
      }
      // regular rule: selector list, then { decls }
      const selList = readUntilTopLevel(["{", "}"]);
      if (i >= n || css[i] === "}") {
        // Trailing junk; preserve.
        out.push(selList);
        return;
      }
      // Scope each comma-separated selector.
      const scopedSel = selList
        .split(",")
        .map((s) => {
          const trimmed = s.trim();
          if (!trimmed) return s;
          // `:root` and bare html/body selectors don't make sense to scope —
          // leave them as authored. Most components wouldn't use them anyway.
          if (/^(?::root\b|html\b|body\b)/.test(trimmed)) return s;
          const lead = s.match(/^\s*/)?.[0] ?? "";
          const tail = s.match(/\s*$/)?.[0] ?? "";
          return `${lead}.${scope} ${trimmed}${tail}`;
        })
        .join(",");
      out.push(scopedSel + "{");
      i++; // skip {
      // declarations block: copy verbatim up to matching }
      let depth = 1;
      const blkStart = i;
      while (i < n && depth > 0) {
        if (css[i] === "{") depth++;
        else if (css[i] === "}") depth--;
        if (depth > 0) i++;
      }
      out.push(css.slice(blkStart, i));
      if (i < n && css[i] === "}") { out.push("}"); i++; }
    }
  }

  processBlock("");
  return out.join("");
}

/** Tiny FNV-1a 32-bit. Deterministic, dependency-free, good enough for css ids. */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
