import type {
  AstPath,
  Parser,
  ParserOptions,
  Plugin,
  Printer,
  SupportLanguage,
} from "prettier";
import {
  parseFile,
  type ParsedComponent,
  type ParsedFile,
  type ParsedImport,
  type ViewNode,
} from "@jslop/compiler";

const LANGUAGE = "jslop";
const AST_FORMAT = "jslop-ast";

const languages: SupportLanguage[] = [
  {
    name: "JSlop",
    parsers: [LANGUAGE],
    extensions: [".jslop"],
    vscodeLanguageIds: ["jslop"],
  },
];

const jslopParser: Parser<ParsedFile> = {
  astFormat: AST_FORMAT,
  parse: (text) => parseFile(text),
  locStart: () => -1,
  locEnd: () => -1,
};

const parsers: Record<string, Parser> = { [LANGUAGE]: jslopParser };

interface Ctx {
  indent: string;
  printWidth: number;
  singleQuote: boolean;
}

function makeCtx(options: ParserOptions): Ctx {
  return {
    indent: options.useTabs ? "\t" : " ".repeat(options.tabWidth ?? 2),
    printWidth: options.printWidth ?? 80,
    singleQuote: options.singleQuote ?? false,
  };
}

const jslopPrinter: Printer<ParsedFile> = {
  print(path: AstPath<ParsedFile>, options) {
    return printFile(path.getValue(), makeCtx(options as ParserOptions));
  },
};

const printers: Record<string, Printer> = { [AST_FORMAT]: jslopPrinter };

const plugin: Plugin = { languages, parsers, printers };
export default plugin;
export { languages, parsers, printers };

function printFile(file: ParsedFile, ctx: Ctx): string {
  const blocks: string[] = [];
  if (file.imports.length > 0) {
    blocks.push(file.imports.map((i) => printImport(i, ctx)).join("\n"));
  }
  for (const comp of file.components) {
    blocks.push(printComponent(comp, ctx));
  }
  return blocks.join("\n\n") + "\n";
}

function printImport(imp: ParsedImport, ctx: Ctx): string {
  const parts: string[] = [];
  if (imp.defaultName) parts.push(imp.defaultName);
  if (imp.named.length > 0) {
    const list = imp.named
      .map((n) => (n.imported === n.local ? n.imported : `${n.imported} as ${n.local}`))
      .join(", ");
    parts.push(`{ ${list} }`);
  }
  return `import ${parts.join(", ")} from ${quote(imp.path, ctx)};`;
}

function printComponent(comp: ParsedComponent, ctx: Ctx): string {
  const pad = ctx.indent;
  const sections: string[][] = [];

  if (comp.props.length > 0) {
    sections.push(
      comp.props.map((p) =>
        p.defaultExpr ? `prop ${p.name} = ${p.defaultExpr}` : `prop ${p.name}`
      )
    );
  }
  if (comp.states.length > 0) {
    sections.push(comp.states.map((s) => `state ${s.name} = ${s.init}`));
  }
  if (comp.lets.length > 0) {
    sections.push(comp.lets.map((l) => `let ${l.name} = ${l.init}`));
  }
  if (comp.fns.length > 0) {
    sections.push(comp.fns.map((f) => printFunction(f.name, f.params, f.body)));
  }
  sections.push([printViewBlock(comp.view, ctx)]);

  const body = sections
    .map((sec) => sec.map((s) => indentBlock(s, pad)).join("\n"))
    .join("\n\n");

  return `component ${comp.name} {\n${body}\n}`;
}

function printFunction(name: string, params: string, body: string): string {
  const p = params.trim();
  const b = stripOuterBlankLines(body);
  if (b.trim().length === 0) return `function ${name}(${p}) {}`;
  return `function ${name}(${p}) {\n${reindent(b, "  ")}\n}`;
}

function printViewBlock(view: ViewNode, ctx: Ctx): string {
  const inner = printNode(view, ctx, 1);
  return `view {\n${inner}\n}`;
}

function printNode(node: ViewNode, ctx: Ctx, level: number): string {
  const pad = ctx.indent.repeat(level);
  switch (node.kind) {
    case "text":
      return pad + escapeText(node.value);
    case "expr":
      return pad + "{" + node.expr + "}";
    case "children":
      return pad + "<children/>";
    case "if":
      return printIf(node, ctx, level);
    case "each":
      return printEach(node, ctx, level);
    case "element":
      return printElement(node, ctx, level);
    case "component":
      return printComponentTag(node, ctx, level);
  }
}

function printIf(
  node: Extract<ViewNode, { kind: "if" }>,
  ctx: Ctx,
  level: number
): string {
  const pad = ctx.indent.repeat(level);
  const cons = node.consequent.map((c) => printNode(c, ctx, level + 1)).join("\n");
  let out = `${pad}{#if ${node.test}}\n${cons}`;
  if (node.alternate.length > 0) {
    const alt = node.alternate.map((c) => printNode(c, ctx, level + 1)).join("\n");
    out += `\n${pad}{:else}\n${alt}`;
  }
  out += `\n${pad}{/if}`;
  return out;
}

function printEach(
  node: Extract<ViewNode, { kind: "each" }>,
  ctx: Ctx,
  level: number
): string {
  const pad = ctx.indent.repeat(level);
  let head = `{#each ${node.each} as ${node.as}`;
  if (node.index) head += `, ${node.index}`;
  if (node.key) head += ` (${node.key})`;
  head += "}";
  const kids = node.children.map((c) => printNode(c, ctx, level + 1)).join("\n");
  return `${pad}${head}\n${kids}\n${pad}{/each}`;
}

function printElement(
  node: Extract<ViewNode, { kind: "element" }>,
  ctx: Ctx,
  level: number
): string {
  const pad = ctx.indent.repeat(level);
  const attrs = formatElementAttrs(node, ctx);
  const isVoid = VOID_ELEMENTS.has(node.tag) && node.children.length === 0;

  const openInline = `<${node.tag}${attrs.length > 0 ? " " + attrs.join(" ") : ""}`;
  const inlineHead = pad + openInline + (isVoid ? " />" : ">");

  const wrap = inlineHead.length > ctx.printWidth && attrs.length > 0;
  const open = wrap ? wrapAttrs(node.tag, attrs, pad, ctx.indent, isVoid) : inlineHead;

  if (isVoid) return open;

  if (node.children.length === 0) {
    return open + `</${node.tag}>`;
  }

  if (
    !wrap &&
    node.children.length === 1 &&
    (node.children[0]!.kind === "text" || node.children[0]!.kind === "expr")
  ) {
    const k = node.children[0]!;
    const inner = k.kind === "text" ? escapeText(k.value) : "{" + k.expr + "}";
    const oneLine = open + inner + `</${node.tag}>`;
    if (oneLine.length <= ctx.printWidth) return oneLine;
  }

  const kids = node.children.map((c) => printNode(c, ctx, level + 1)).join("\n");
  return `${open}\n${kids}\n${pad}</${node.tag}>`;
}

function printComponentTag(
  node: Extract<ViewNode, { kind: "component" }>,
  ctx: Ctx,
  level: number
): string {
  const pad = ctx.indent.repeat(level);
  const attrs = formatComponentProps(node.props, ctx);
  const openInline = `<${node.name}${attrs.length > 0 ? " " + attrs.join(" ") : ""}`;
  const inlineHead = pad + openInline + (node.children.length === 0 ? " />" : ">");
  const wrap = inlineHead.length > ctx.printWidth && attrs.length > 0;
  const open = wrap
    ? wrapAttrs(node.name, attrs, pad, ctx.indent, node.children.length === 0)
    : inlineHead;
  if (node.children.length === 0) return open;
  const kids = node.children.map((c) => printNode(c, ctx, level + 1)).join("\n");
  return `${open}\n${kids}\n${pad}</${node.name}>`;
}

function wrapAttrs(
  tag: string,
  attrs: string[],
  pad: string,
  indent: string,
  selfClose: boolean
): string {
  const attrPad = pad + indent;
  return (
    `${pad}<${tag}\n` +
    attrs.map((a) => attrPad + a).join("\n") +
    `\n${pad}${selfClose ? "/>" : ">"}`
  );
}

function formatElementAttrs(
  node: Extract<ViewNode, { kind: "element" }>,
  ctx: Ctx
): string[] {
  const out: string[] = [];
  const attrs = { ...node.attrs };
  const events = { ...node.events };

  // Recover bind: sugar where possible.
  for (const [prop, raw] of Object.entries(attrs)) {
    if (!raw.startsWith("__prop:")) continue;
    const expr = raw.slice("__prop:".length);
    const bindKind = prop === "value" ? "value" : prop === "checked" ? "checked" : null;
    if (!bindKind) continue;
    const evName = bindKind === "checked" ? "change" : node.tag === "select" ? "change" : "input";
    const reader = bindKind === "checked" ? "e.target.checked" : "e.target.value";
    const expected = `(e) => { ${expr} = ${reader}; }`;
    if (events[evName] === expected) {
      out.push(`bind:${bindKind}={${expr}}`);
      delete attrs[prop];
      delete events[evName];
    }
  }

  for (const [k, v] of Object.entries(attrs)) out.push(formatElementAttr(k, v, ctx));
  for (const [k, v] of Object.entries(events)) out.push(`on${k}={${v}}`);
  return out;
}

function formatElementAttr(name: string, encoded: string, ctx: Ctx): string {
  if (encoded.startsWith("__expr:")) return `${name}={${encoded.slice("__expr:".length)}}`;
  if (encoded.startsWith("__prop:")) return `${name}={${encoded.slice("__prop:".length)}}`;
  // String value, JSON-encoded.
  const value = safeJsonParseString(encoded);
  if (value === "") return name;
  return `${name}=${quote(value, ctx)}`;
}

function formatComponentProps(
  props: Record<string, string>,
  ctx: Ctx
): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(props)) {
    if (v.startsWith("__expr:")) {
      out.push(`${k}={${v.slice("__expr:".length)}}`);
      continue;
    }
    if (v.startsWith("__prop:")) {
      out.push(`${k}={${v.slice("__prop:".length)}}`);
      continue;
    }
    // JSON-encoded boolean/string.
    const parsed = safeJsonParse(v);
    if (parsed === true) out.push(k);
    else if (typeof parsed === "string") out.push(`${k}=${quote(parsed, ctx)}`);
    else out.push(`${k}={${v}}`);
  }
  return out;
}

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "source", "track", "wbr",
]);

function quote(s: string, ctx: Ctx): string {
  const q = ctx.singleQuote ? "'" : '"';
  const escaped = s.replace(/\\/g, "\\\\").replace(new RegExp(q, "g"), "\\" + q);
  return q + escaped + q;
}

function escapeText(value: string): string {
  return value;
}

function indentBlock(text: string, pad: string): string {
  return text
    .split("\n")
    .map((l) => (l.length === 0 ? "" : pad + l))
    .join("\n");
}

function reindent(text: string, pad: string): string {
  const lines = text.split("\n");
  const minIndent = lines
    .filter((l) => l.trim().length > 0)
    .reduce((m, l) => {
      const ws = /^[ \t]*/.exec(l)![0].length;
      return Math.min(m, ws);
    }, Infinity);
  const base = isFinite(minIndent) ? minIndent : 0;
  return lines
    .map((l) => (l.length === 0 ? "" : pad + l.slice(base)))
    .join("\n");
}

function stripOuterBlankLines(s: string): string {
  const lines = s.split("\n");
  while (lines.length > 0 && lines[0]!.trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
  return lines.join("\n");
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function safeJsonParseString(s: string): string {
  const v = safeJsonParse(s);
  return typeof v === "string" ? v : s;
}
