import type { ParsedComponent, ViewNode } from "./parser.js";
import { rewriteFnBody, rewriteExpr } from "./rewrite.js";

export interface CodegenOptions {
  runtimeImport?: string;
  /** Rewrite imports of `./Foo.rift` into the compiled file extension. Defaults to `.compiled.mjs`. */
  compiledExtension?: string;
}

export function generate(comp: ParsedComponent, opts: CodegenOptions = {}): string {
  const runtimeImport = opts.runtimeImport ?? "@rift/runtime";
  const compiledExt = opts.compiledExtension ?? ".compiled.mjs";

  const reactiveNames = [...comp.props.map((p) => p.name), ...comp.lets.map((l) => l.name)];

  const importLines = comp.imports
    .map((imp) => {
      const path = imp.path.endsWith(".rift")
        ? imp.path.slice(0, -".rift".length) + compiledExt
        : imp.path;
      return `import ${imp.name} from ${JSON.stringify(path)};`;
    })
    .join("\n");

  const propDecls = comp.props
    .map((p) => {
      const fallback = p.defaultExpr ?? "undefined";
      return `  const ${p.name} = isReactive(props?.${p.name}) ? props.${p.name} : cell(props?.${p.name} ?? (${fallback}));`;
    })
    .join("\n");

  const letDecls = comp.lets
    .map((l) => `  const ${l.name} = cell(${l.init});`)
    .join("\n");

  const fnDecls = comp.fns
    .map(
      (f) =>
        `  function ${f.name}(${f.params}) {\n${indent(rewriteFnBody(f.body, reactiveNames), 4)}\n  }`
    )
    .join("\n");

  const actionEntries = comp.fns.map((f) => `    ${f.name}`).join(",\n");

  const childCtx = { counter: 0, decls: [] as string[] };
  const viewExpr = emitNode(comp.view, reactiveNames, 4, childCtx);
  const childrenArr = childCtx.decls.length
    ? `[${childCtx.decls.map((_, i) => `__child_${i}`).join(", ")}]`
    : "[]";

  const stateSerializeEntries = comp.lets.map((l) => `${l.name}: ${l.name}.peek()`);
  stateSerializeEntries.push("children: __children.map((c) => c.serializeState())");
  const stateSerialize = stateSerializeEntries.join(", ");

  const stateRestore = comp.lets
    .map((l) => `      if ("${l.name}" in s) ${l.name}.set(s.${l.name});`)
    .join("\n");

  return `import { cell, isReactive } from "${runtimeImport}";
${importLines}

export const __rift_component = {
  name: ${JSON.stringify(comp.name)},
  create(props = {}) {
${propDecls}
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
};

export default __rift_component;
`;
}

function indent(s: string, n: number): string {
  const pad = " ".repeat(n);
  return s.split("\n").map((line) => (line.length > 0 ? pad + line : line)).join("\n");
}

interface ChildCtx {
  counter: number;
  decls: string[];
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
    const subCtx: ChildCtx = { counter: childCtx.counter, decls: childCtx.decls };
    const childStrs = node.children.map((ch) => emitNode(ch, innerReactive, depth + 2, subCtx));
    childCtx.counter = subCtx.counter;
    const childrenLit =
      childStrs.length === 0 ? "[]" : `[\n${pad}    ${childStrs.join(`,\n${pad}    `)}\n${pad}  ]`;
    const paramList = node.index ? `(${node.as}, ${node.index})` : `(${node.as})`;
    return `{ kind: "each", each: () => (${eachExpr}), build: ${paramList} => (${childrenLit}) }`;
  }
  if (node.kind === "component") {
    const idx = childCtx.counter++;
    const varName = `__child_${idx}`;
    const propEntries = Object.entries(node.props).map(([k, v]) => {
      if (v.startsWith("__expr:")) {
        return `${JSON.stringify(k)}: (${v.slice("__expr:".length)})`;
      }
      return `${JSON.stringify(k)}: ${v}`;
    });
    const propsLit = `{ ${propEntries.join(", ")} }`;
    childCtx.decls.push(`    const ${varName} = ${node.name}.create(${propsLit});`);
    return `{ kind: "component", name: ${JSON.stringify(node.name)}, instance: ${varName}, view: ${varName}.buildView() }`;
  }
  const attrEntries = Object.entries(node.attrs).map(([k, v]) => {
    if (v.startsWith("__expr:")) {
      const e = rewriteExpr(v.slice("__expr:".length), reactiveNames);
      return `${JSON.stringify(k)}: { kind: "bind", get: () => String(${e}) }`;
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

