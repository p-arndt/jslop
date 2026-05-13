import type { ParsedComponent, ParsedFile, ParsedImport, ViewNode } from "./parser.js";
import { rewriteFnBody, rewriteExpr } from "./rewrite.js";

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

  const blocks = file.components.map((c) => generateComponent(c)).join("\n\n");
  // The first declared component is the file's default — keeps single-component
  // files (the existing convention, including all routes/layouts) working
  // unchanged when a consumer does `import Comp from "./File.jslop"`.
  const first = file.components[0]!;
  const defaultLine = `export default ${first.name};`;

  return `import { cell, isReactive } from "${runtimeImport}";
${importLines}

${blocks}

${defaultLine}
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

function generateComponent(comp: ParsedComponent): string {
  const reactiveNames = [...comp.props.map((p) => p.name), ...comp.states.map((s) => s.name)];

  const propDecls = comp.props
    .map((p) => {
      const fallback = p.defaultExpr ?? "undefined";
      return `    const ${p.name} = isReactive(props?.${p.name}) ? props.${p.name} : cell(props?.${p.name} ?? (${fallback}));`;
    })
    .join("\n");

  const stateDecls = comp.states
    .map((s) => `    const ${s.name} = cell(${s.init});`)
    .join("\n");

  const letDecls = comp.lets
    .map((l) => `    let ${l.name} = ${l.init};`)
    .join("\n");

  const fnDecls = comp.fns
    .map(
      (f) =>
        `    function ${f.name}(${f.params}) {\n${indent(rewriteFnBody(f.body, reactiveNames), 6)}\n    }`
    )
    .join("\n");

  const actionEntries = comp.fns.map((f) => `      ${f.name}`).join(",\n");

  const childCtx: ChildCtx = { counter: 0, decls: [], inlineDecls: null };
  const viewExpr = emitNode(comp.view, reactiveNames, 6, childCtx);
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
${stateDecls}
${letDecls}
${fnDecls}
    const actions = {
${actionEntries}
    };
${childCtx.decls.join("\n")}
    const __children = ${childrenArr};
    function buildView() {
      return ${viewExpr};
    }
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
    return { actions, buildView, serializeState, restoreState, children: __children };
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
  childCtx: ChildCtx
): string {
  const pad = " ".repeat(depth);
  if (node.kind === "text") {
    return `{ kind: "text", value: ${JSON.stringify(node.value)} }`;
  }
  if (node.kind === "children") {
    return `{ kind: "children" }`;
  }
  if (node.kind === "expr") {
    const e = rewriteExpr(node.expr, reactiveNames);
    return `{ kind: "bind", get: () => String(${e}) }`;
  }
  if (node.kind === "if") {
    const test = rewriteExpr(node.test, reactiveNames);
    const cons = node.consequent.map((ch) => emitNode(ch, reactiveNames, depth + 2, childCtx));
    const alt = node.alternate.map((ch) => emitNode(ch, reactiveNames, depth + 2, childCtx));
    const consStr =
      cons.length === 0 ? "[]" : `[\n${pad}  ${cons.join(`,\n${pad}  `)}\n${pad}]`;
    const altStr =
      alt.length === 0 ? "[]" : `[\n${pad}  ${alt.join(`,\n${pad}  `)}\n${pad}]`;
    return `{ kind: "if", test: () => (${test}), consequent: ${consStr}, alternate: ${altStr} }`;
  }
  if (node.kind === "each") {
    const eachExpr = rewriteExpr(node.each, reactiveNames);
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
    const childStrs = node.children.map((ch) => emitNode(ch, innerReactive, depth + 2, subCtx));
    childCtx.counter = subCtx.counter;
    const childrenLit =
      childStrs.length === 0 ? "[]" : `[\n${pad}    ${childStrs.join(`,\n${pad}    `)}\n${pad}  ]`;
    const paramList = node.index ? `(${node.as}, ${node.index})` : `(${node.as})`;
    const buildBody =
      buildLocals.length === 0
        ? `(${childrenLit})`
        : `{\n${pad}    ${buildLocals.join(`\n${pad}    `)}\n${pad}    return ${childrenLit};\n${pad}  }`;
    const keyPart = node.key
      ? `, key: ${paramList} => (${rewriteExpr(node.key, innerReactive)})`
      : "";
    return `{ kind: "each", each: () => (${eachExpr}), build: ${paramList} => ${buildBody}${keyPart} }`;
  }
  if (node.kind === "component") {
    const idx = childCtx.counter++;
    const propEntries = Object.entries(node.props).map(([k, v]) => {
      if (v.startsWith("__expr:")) {
        // Pass props through unchanged: parent cells are passed by reference
        // (so the child reacts to changes), and item bindings inside an each
        // are plain values from the build callback's params.
        return `${JSON.stringify(k)}: (${v.slice("__expr:".length)})`;
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
      const e = rewriteExpr(v.slice("__expr:".length), reactiveNames);
      return `${JSON.stringify(k)}: { kind: "bind", get: () => String(${e}) }`;
    }
    if (v.startsWith("__prop:")) {
      // Property bind: forward the value directly to the IDL property; no
      // String() coercion (so booleans stay booleans for `checked`).
      const e = rewriteExpr(v.slice("__prop:".length), reactiveNames);
      return `${JSON.stringify(k)}: { kind: "prop", get: () => (${e}) }`;
    }
    return `${JSON.stringify(k)}: ${v}`;
  });
  const eventEntries = Object.entries(node.events).map(
    ([evt, handler]) => `${JSON.stringify(evt)}: (${rewriteFnBody(handler, reactiveNames)})`
  );
  const children = node.children.map((ch) => emitNode(ch, reactiveNames, depth + 2, childCtx));

  const attrsStr = attrEntries.length > 0 ? `{ ${attrEntries.join(", ")} }` : "{}";
  const eventsStr = eventEntries.length > 0 ? `{ ${eventEntries.join(", ")} }` : "{}";
  const childrenStr =
    children.length === 0
      ? "[]"
      : `[\n${pad}  ${children.join(`,\n${pad}  `)}\n${pad}]`;

  return `{ kind: "element", tag: ${JSON.stringify(node.tag)}, attrs: ${attrsStr}, events: ${eventsStr}, children: ${childrenStr} }`;
}
