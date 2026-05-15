export type ViewNode =
  | { kind: "element"; tag: string; attrs: Record<string, string>; events: Record<string, string>; children: ViewNode[] }
  | { kind: "component"; name: string; props: Record<string, string>; children: ViewNode[] }
  | { kind: "if"; test: string; consequent: ViewNode[]; alternate: ViewNode[] }
  | { kind: "each"; each: string; as: string; index: string | null; key: string | null; children: ViewNode[] }
  | { kind: "children" }
  | { kind: "text"; value: string }
  | { kind: "expr"; expr: string };

export interface ParsedImport {
  /** Default-import binding, or null when only named specifiers are present. */
  defaultName: string | null;
  /** Named specifiers: `{ A, B as Renamed }`. */
  named: Array<{ imported: string; local: string }>;
  path: string;
}

export interface ParsedProp {
  name: string;
  defaultExpr: string | null;
}

export interface ParsedComponent {
  name: string;
  props: ParsedProp[];
  /** Reactive cells, declared with `state`. */
  states: Array<{ name: string; init: string }>;
  /** Derived (memoized, read-only) cells, declared with `derived`. */
  deriveds: Array<{ name: string; init: string }>;
  /** Plain non-reactive bindings, declared with `let`. */
  lets: Array<{ name: string; init: string }>;
  fns: Array<{ name: string; params: string; body: string }>;
  /**
   * Server-side mutation handlers, declared with `action name(params) { body }`.
   * Compiled into two pieces: a client-side stub callable from event handlers
   * (which POSTs to the route URL), and — when codegen is invoked with
   * `ssr: true` — a `__actions` export the server dispatches POSTs to.
   * Bodies see `params`, `url`, `request` in scope (the load-style context).
   */
  actions: Array<{ name: string; params: string; body: string }>;
  view: ViewNode;
  /**
   * Optional document-head fragment. SSR merges these into the page <head>;
   * the route's head is rendered after layouts so its <title> / meta win.
   */
  head: ViewNode[] | null;
  /**
   * Optional raw CSS body from a `style { … }` block. The codegen scopes
   * selectors to a per-component class and adds that class to the root
   * element.
   */
  style: string | null;
  /**
   * Optional `load { body }` block. The codegen emits this as an exported
   * async function `load(params)` alongside the component. The server-side
   * router calls it before rendering and merges its return value into props.
   * Throwing `notFound()` from within bubbles up to the 404 chain.
   */
  load: string | null;
}

export interface ParsedFile {
  imports: ParsedImport[];
  components: ParsedComponent[];
}

class Cursor {
  constructor(public src: string, public i = 0) {}
  eof() { return this.i >= this.src.length; }
  peek(n = 0) { return this.src[this.i + n] ?? ""; }
  rest() { return this.src.slice(this.i); }
  consume(s: string): boolean {
    if (this.src.startsWith(s, this.i)) { this.i += s.length; return true; }
    return false;
  }
  consumeKeyword(s: string): boolean {
    if (!this.src.startsWith(s, this.i)) return false;
    const after = this.src[this.i + s.length] ?? "";
    if (/[A-Za-z0-9_]/.test(after)) return false;
    this.i += s.length;
    return true;
  }
  expect(s: string) {
    if (!this.consume(s)) throw this.err(`expected '${s}'`);
  }
  skipWs() {
    while (!this.eof()) {
      const c = this.peek();
      if (c === " " || c === "\t" || c === "\n" || c === "\r") this.i++;
      else if (c === "/" && this.peek(1) === "/") {
        while (!this.eof() && this.peek() !== "\n") this.i++;
      } else break;
    }
  }
  matchIdent(): string | null {
    this.skipWs();
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.rest());
    if (!m) return null;
    this.i += m[0].length;
    return m[0];
  }
  err(msg: string, hint?: string): JSlopParseError {
    return new JSlopParseError(msg, { offset: this.i, source: this.src, hint });
  }
}

/**
 * Structured parse error. Carries the offset into the *source string the parser
 * was working on* (which may be a sub-slice of the original file body — see the
 * `source` field) plus an optional `hint` with a remediation suggestion.
 *
 * To turn one of these into a human-friendly file:line:col + code-frame
 * message, call `formatParseError(err, originalSource, filename?)`.
 */
export class JSlopParseError extends Error {
  offset: number;
  hint: string | undefined;
  source: string;
  constructor(msg: string, opts: { offset: number; source: string; hint?: string }) {
    super(msg);
    this.name = "JSlopParseError";
    this.offset = opts.offset;
    this.source = opts.source;
    this.hint = opts.hint;
  }
}

function offsetToLineCol(src: string, offset: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, src.length));
  let line = 1, column = 1;
  for (let i = 0; i < clamped; i++) {
    if (src.charCodeAt(i) === 10) { line++; column = 1; }
    else column++;
  }
  return { line, column };
}

function codeFrame(src: string, line: number, column: number): string {
  const lines = src.split("\n");
  const start = Math.max(1, line - 2);
  const end = Math.min(lines.length, line + 2);
  const gutter = String(end).length;
  const out: string[] = [];
  for (let n = start; n <= end; n++) {
    const marker = n === line ? ">" : " ";
    const num = String(n).padStart(gutter, " ");
    out.push(`${marker} ${num} | ${lines[n - 1] ?? ""}`);
    if (n === line) {
      const pad = " ".repeat(gutter + 2 + 1 + Math.max(0, column - 1));
      out.push(`  ${" ".repeat(gutter)} | ${" ".repeat(Math.max(0, column - 1))}^`);
      void pad;
    }
  }
  return out.join("\n");
}

/**
 * Render a `JSlopParseError` as a file:line:col message with a code frame and
 * (when present) a hint. The `source` argument should be the full original file
 * text — the formatter resolves the error's offset against it directly when the
 * error came from the top-level parser, or falls back to the error's own
 * captured slice when it came from an inner cursor (e.g. a component body).
 */
export function formatParseError(err: JSlopParseError, source: string, filename?: string): string {
  // Inner cursors parse a sub-slice (e.g. a component body). Their offsets
  // index into that slice, not the original source. Detect this by checking
  // whether the error's captured `source` matches the file source — if not,
  // resolve the error against its own slice and label coordinates accordingly.
  const useSource = source.includes(err.source) ? source : err.source;
  let absoluteOffset = err.offset;
  if (useSource === source && err.source !== source) {
    const idx = source.indexOf(err.source);
    if (idx >= 0) absoluteOffset = idx + err.offset;
  }
  const { line, column } = offsetToLineCol(useSource, absoluteOffset);
  const fname = filename ?? "<input>";
  const head = `${fname}:${line}:${column}: ${err.message}`;
  const frame = codeFrame(useSource, line, column);
  return err.hint ? `${head}\n\n${frame}\n\nhint: ${err.hint}` : `${head}\n\n${frame}`;
}

// Read a declaration initializer that ends at a top-level newline or ';'. Tracks
// (), [], {}, strings, and template literals so that multi-line object / array
// literals, parenthesized expressions, etc. survive intact.
function readInitializer(c: Cursor): string {
  const start = c.i;
  let parens = 0, brackets = 0, braces = 0;
  while (!c.eof()) {
    const ch = c.peek();
    if (parens === 0 && brackets === 0 && braces === 0 && (ch === "\n" || ch === ";")) break;
    if (ch === '"' || ch === "'") {
      const q = ch;
      c.i++;
      while (!c.eof() && c.peek() !== q) {
        if (c.peek() === "\\") c.i++;
        c.i++;
      }
      if (!c.eof()) c.i++;
      continue;
    }
    if (ch === "`") {
      c.i++;
      while (!c.eof() && c.peek() !== "`") {
        if (c.peek() === "\\") { c.i += 2; continue; }
        if (c.peek() === "$" && c.peek(1) === "{") {
          c.i += 2;
          let d = 1;
          while (!c.eof() && d > 0) {
            const x = c.peek();
            if (x === "{") d++;
            else if (x === "}") d--;
            if (d > 0) c.i++;
          }
        }
        if (!c.eof() && c.peek() !== "`") c.i++;
      }
      if (!c.eof()) c.i++;
      continue;
    }
    if (ch === "/" && c.peek(1) === "/") {
      while (!c.eof() && c.peek() !== "\n") c.i++;
      continue;
    }
    if (ch === "(") parens++;
    else if (ch === ")") parens--;
    else if (ch === "[") brackets++;
    else if (ch === "]") brackets--;
    else if (ch === "{") braces++;
    else if (ch === "}") {
      if (braces === 0) break; // closing the enclosing component body
      braces--;
    }
    c.i++;
  }
  return c.src.slice(start, c.i).trim();
}

function readBalanced(c: Cursor, open: string, close: string): string {
  c.expect(open);
  const start = c.i;
  let depth = 1;
  while (!c.eof() && depth > 0) {
    const ch = c.peek();
    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch;
      c.i++;
      while (!c.eof() && c.peek() !== q) {
        // JS '/" strings cannot contain raw newlines. If we hit one, the
        // quote was JSX text (e.g. "You've") not a string opener — bail
        // out and resume brace counting from here. Template literals can
        // span lines, so the rule only applies to '/".
        if (q !== "`" && c.peek() === "\n") break;
        if (c.peek() === "\\") c.i++;
        c.i++;
      }
      if (!c.eof() && c.peek() === q) c.i++;
    } else if (ch === "/" && c.peek(1) === "/") {
      while (!c.eof() && c.peek() !== "\n") c.i++;
    } else if (ch === open) { depth++; c.i++; }
    else if (ch === close) { depth--; c.i++; }
    else c.i++;
  }
  if (depth !== 0) {
    throw c.err(
      `unbalanced '${open}…${close}' — reached end of input with ${depth} unclosed '${open}'`,
      `Check for a missing '${close}'. Counts can also drift if a string literal is unterminated.`
    );
  }
  return c.src.slice(start, c.i - 1);
}

function readJsExpr(c: Cursor): string {
  return readBalanced(c, "{", "}");
}

function readStringLiteral(c: Cursor): string {
  c.skipWs();
  const q = c.peek();
  if (q !== '"' && q !== "'") throw c.err("expected string literal");
  c.i++;
  const start = c.i;
  while (!c.eof() && c.peek() !== q) {
    if (c.peek() === "\\") c.i++;
    c.i++;
  }
  const out = c.src.slice(start, c.i);
  c.i++;
  return out;
}

export function parseFile(src: string): ParsedFile {
  const c = new Cursor(src);
  const imports: ParsedImport[] = [];

  while (true) {
    c.skipWs();
    if (!c.consumeKeyword("import")) break;
    c.skipWs();
    let defaultName: string | null = null;
    const named: ParsedImport["named"] = [];
    // Either `import Foo from "..."`, `import { A, B as C } from "..."`,
    // or `import Foo, { A } from "..."`.
    if (c.peek() === "{") {
      parseNamedSpecifiers(c, named);
    } else {
      const n = c.matchIdent();
      if (!n) throw c.err("expected import name or '{'");
      defaultName = n;
      c.skipWs();
      if (c.consume(",")) {
        c.skipWs();
        if (c.peek() !== "{") throw c.err("expected '{' after ',' in import");
        parseNamedSpecifiers(c, named);
      }
    }
    c.skipWs();
    if (!c.consumeKeyword("from")) throw c.err("expected 'from'");
    const path = readStringLiteral(c);
    c.consume(";");
    imports.push({ defaultName, named, path });
  }

  const components: ParsedComponent[] = [];
  while (true) {
    c.skipWs();
    if (c.eof()) break;
    if (!c.consumeKeyword("component")) {
      throw c.err(
        "expected 'component' at top level",
        "JSlop files contain `import` lines followed by one or more `component Name { … }` blocks. Each file must declare at least one component."
      );
    }
    components.push(parseComponentBody(c));
  }

  if (components.length === 0) throw new JSlopParseError("file must declare at least one component", { offset: 0, source: src });
  return { imports, components };
}

function parseNamedSpecifiers(c: Cursor, out: ParsedImport["named"]): void {
  c.expect("{");
  while (true) {
    c.skipWs();
    if (c.peek() === "}") { c.i++; return; }
    const imported = c.matchIdent();
    if (!imported) throw c.err("expected named import specifier");
    c.skipWs();
    let local = imported;
    if (c.consumeKeyword("as")) {
      c.skipWs();
      const a = c.matchIdent();
      if (!a) throw c.err("expected local name after 'as'");
      local = a;
      c.skipWs();
    }
    out.push({ imported, local });
    if (c.consume(",")) continue;
    c.skipWs();
    if (c.peek() !== "}") throw c.err("expected ',' or '}' in named import list");
  }
}

function parseComponentBody(c: Cursor): ParsedComponent {
  const name = c.matchIdent();
  if (!name) throw c.err("expected component name");
  c.skipWs();
  const body = readBalanced(c, "{", "}");

  const inner = new Cursor(body);
  const states: ParsedComponent["states"] = [];
  const deriveds: ParsedComponent["deriveds"] = [];
  const lets: ParsedComponent["lets"] = [];
  const fns: ParsedComponent["fns"] = [];
  const actions: ParsedComponent["actions"] = [];
  const props: ParsedProp[] = [];
  let view: ViewNode | null = null;
  let head: ViewNode[] | null = null;
  let style: string | null = null;
  let load: string | null = null;

  while (true) {
    inner.skipWs();
    if (inner.eof()) break;
    if (inner.consumeKeyword("prop")) {
      inner.skipWs();
      const pname = inner.matchIdent();
      if (!pname) throw inner.err("expected prop name");
      inner.skipWs();
      let defaultExpr: string | null = null;
      if (inner.consume("=")) {
        defaultExpr = readInitializer(inner);
      }
      inner.consume(";");
      props.push({ name: pname, defaultExpr });
    } else if (inner.consumeKeyword("state")) {
      inner.skipWs();
      const sname = inner.matchIdent();
      if (!sname) throw inner.err("expected state name");
      inner.skipWs();
      inner.expect("=");
      const init = readInitializer(inner);
      inner.consume(";");
      states.push({ name: sname, init });
    } else if (inner.consumeKeyword("derived")) {
      inner.skipWs();
      const dname = inner.matchIdent();
      if (!dname) throw inner.err("expected derived name");
      inner.skipWs();
      inner.expect("=");
      const init = readInitializer(inner);
      inner.consume(";");
      deriveds.push({ name: dname, init });
    } else if (inner.consumeKeyword("let")) {
      inner.skipWs();
      const lname = inner.matchIdent();
      if (!lname) throw inner.err("expected let name");
      inner.skipWs();
      inner.expect("=");
      const init = readInitializer(inner);
      inner.consume(";");
      lets.push({ name: lname, init });
    } else if (inner.consumeKeyword("function")) {
      inner.skipWs();
      const fname = inner.matchIdent();
      if (!fname) throw inner.err("expected function name");
      inner.skipWs();
      const params = readBalanced(inner, "(", ")");
      inner.skipWs();
      const fbody = readBalanced(inner, "{", "}");
      fns.push({ name: fname, params, body: fbody });
    } else if (inner.consumeKeyword("action")) {
      inner.skipWs();
      const aname = inner.matchIdent();
      if (!aname) throw inner.err("expected action name");
      inner.skipWs();
      const params = readBalanced(inner, "(", ")");
      inner.skipWs();
      const abody = readBalanced(inner, "{", "}");
      actions.push({ name: aname, params, body: abody });
    } else if (inner.consumeKeyword("view")) {
      inner.skipWs();
      const viewBody = readBalanced(inner, "{", "}");
      view = parseView(viewBody.trim());
    } else if (inner.consumeKeyword("head")) {
      inner.skipWs();
      const headBody = readBalanced(inner, "{", "}");
      head = parseHeadFragment(headBody.trim());
    } else if (inner.consumeKeyword("style")) {
      inner.skipWs();
      style = readBalanced(inner, "{", "}");
    } else if (inner.consumeKeyword("load")) {
      inner.skipWs();
      load = readBalanced(inner, "{", "}");
    } else {
      throw inner.err(
        "unknown declaration in component body",
        "Inside a component body, the only valid statements are: `prop`, `state`, `derived`, `let`, `function`, `action`, `view`, `head`, `style`, and `load`. Plain JavaScript statements go inside a `function` block."
      );
    }
  }

  if (!view) {
    throw new JSlopParseError(
      `component ${name} missing view`,
      { offset: 0, source: c.src, hint: "Every component needs a `view { <root/> }` block describing what to render." }
    );
  }
  return { name, props, states, deriveds, lets, fns, actions, view, head, style, load };
}

function parseHeadFragment(src: string): ViewNode[] {
  const c = new Cursor(src);
  const out = parseChildrenUntil(c, () => false, null);
  // Strip pure-whitespace text nodes — head fragments only care about real
  // tags / interpolations, and stray " " between <title> and <meta> would
  // otherwise leak into the rendered <head>.
  return out.filter((n) => !(n.kind === "text" && /^\s*$/.test(n.value)));
}

/**
 * Convenience: parse a file that is expected to declare exactly one component
 * and return that component. Useful for tests and tooling that target a single
 * component descriptor; for files that may declare several, use `parseFile`.
 */
export function parseComponent(src: string): ParsedComponent {
  const file = parseFile(src);
  return file.components[0]!;
}

function parseView(src: string): ViewNode {
  const c = new Cursor(src);
  c.skipWs();
  const node = parseTag(c);
  c.skipWs();
  if (!c.eof()) throw c.err("trailing content after root view element");
  return node;
}

function isComponentTag(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function parseTag(c: Cursor): ViewNode {
  c.skipWs();
  if (c.peek() !== "<") throw c.err("expected '<'");
  c.i++;
  const tagMatch = /^[A-Za-z][A-Za-z0-9-]*/.exec(c.rest());
  if (!tagMatch) throw c.err("expected tag name");
  c.i += tagMatch[0].length;
  const tag = tagMatch[0];
  const isComp = isComponentTag(tag);
  const isChildren = tag === "children";

  const attrs: Record<string, string> = {};
  const events: Record<string, string> = {};
  const props: Record<string, string> = {};
  const bindSpecs: Array<{ kind: string; expr: string }> = [];

  const finish = (children: ViewNode[]): ViewNode => {
    if (isChildren) {
      if (children.length > 0) {
        throw c.err("<children> must be self-closing (fallback content not yet supported)");
      }
      return { kind: "children" };
    }
    if (isComp) return { kind: "component", name: tag, props, children };
    for (const b of bindSpecs) synthesizeBind(tag, b.kind, b.expr, attrs, events, c);
    return { kind: "element", tag, attrs, events, children };
  };

  while (true) {
    c.skipWs();
    if (c.peek() === "/" && c.peek(1) === ">") {
      c.i += 2;
      return finish([]);
    }
    if (c.peek() === ">") {
      c.i++;
      const children = parseChildren(c, tag);
      return finish(children);
    }
    const attrName = /^(?:bind:)?[A-Za-z_][A-Za-z0-9_-]*/.exec(c.rest());
    if (!attrName) throw c.err("expected attribute or '>'");
    c.i += attrName[0].length;
    const isBindAttr = !isComp && attrName[0].startsWith("bind:");
    const isDomEventAttr = !isComp && !isBindAttr && /^on[a-z]/.test(attrName[0]);
    const eventType = isDomEventAttr ? attrName[0].slice(2) : null;
    if (isBindAttr) {
      const bindKind = attrName[0].slice("bind:".length);
      if (!c.consume("=")) throw c.err(`bind:${bindKind} requires a value`);
      if (c.peek() !== "{") throw c.err(`bind:${bindKind} value must be an expression {…}`);
      const expr = readJsExpr(c).trim();
      bindSpecs.push({ kind: bindKind, expr });
      continue;
    }
    if (c.peek() === "=") {
      c.i++;
      if (c.peek() === '"' || c.peek() === "'") {
        const q = c.peek();
        c.i++;
        const start = c.i;
        while (!c.eof() && c.peek() !== q) c.i++;
        const value = c.src.slice(start, c.i);
        c.i++;
        if (eventType) events[eventType] = value;
        else if (isComp) props[attrName[0]] = JSON.stringify(value);
        else attrs[attrName[0]] = JSON.stringify(value);
      } else if (c.peek() === "{") {
        const expr = readJsExpr(c);
        if (eventType) events[eventType] = expr.trim();
        else if (isComp) props[attrName[0]] = `__expr:${expr.trim()}`;
        else attrs[attrName[0]] = `__expr:${expr.trim()}`;
      } else throw c.err("expected attribute value");
    } else {
      if (isComp) props[attrName[0]] = JSON.stringify(true);
      else attrs[attrName[0]] = JSON.stringify("");
    }
  }
}

function synthesizeBind(
  tag: string,
  bindKind: string,
  expr: string,
  attrs: Record<string, string>,
  events: Record<string, string>,
  c: Cursor
): void {
  // Map bind: kind → (DOM attribute, event name, reader expression).
  let prop: string;
  let event: string;
  let reader: string;
  if (bindKind === "value") {
    prop = "value";
    event = tag === "select" ? "change" : "input";
    reader = "e.target.value";
  } else if (bindKind === "checked") {
    prop = "checked";
    event = "change";
    reader = "e.target.checked";
  } else {
    throw c.err(`unsupported bind:${bindKind} (only value and checked are supported)`);
  }
  if (attrs[prop] !== undefined) {
    throw c.err(`bind:${bindKind} conflicts with explicit ${prop} attribute on the same element`);
  }
  if (events[event] !== undefined) {
    throw c.err(`bind:${bindKind} conflicts with explicit on${event} handler on the same element`);
  }
  // Use the property bind form so the runtime sets the IDL property (e.g.
  // el.value, el.checked) rather than the HTML attribute. Setting setAttribute
  // for an <input> 'value' only updates the *initial* value; the property is
  // what actually controls the visible state once the user has typed.
  attrs[prop] = `__prop:${expr}`;
  // The handler is plain JS; the codegen rewriter will turn an Identifier
  // assignment into the matching cell.set() call.
  events[event] = `(e) => { ${expr} = ${reader}; }`;
}

function parseChildren(c: Cursor, parentTag: string): ViewNode[] {
  return parseChildrenUntil(c, (cur) => {
    if (cur.peek() === "<" && cur.peek(1) === "/") return true;
    return false;
  }, parentTag);
}

function parseChildrenUntil(c: Cursor, isEnd: (c: Cursor) => boolean, parentTag: string | null): ViewNode[] {
  const out: ViewNode[] = [];
  let buf = "";
  const flushText = () => {
    if (buf.length > 0) {
      const trimmed = buf.replace(/\s+/g, " ");
      if (trimmed.length > 0) out.push({ kind: "text", value: trimmed });
      buf = "";
    }
  };
  while (!c.eof()) {
    if (isEnd(c)) {
      flushText();
      if (parentTag !== null) {
        c.i += 2;
        const endMatch = /^[A-Za-z][A-Za-z0-9-]*/.exec(c.rest());
        if (!endMatch) throw c.err("expected closing tag name");
        c.i += endMatch[0].length;
        if (endMatch[0] !== parentTag) {
          throw c.err(
            `closing tag </${endMatch[0]}> does not match opening <${parentTag}>`,
            `Tags must be balanced. Either close <${parentTag}> with </${parentTag}>, or self-close it as <${parentTag}/>.`
          );
        }
        c.skipWs();
        c.expect(">");
      }
      return out;
    }
    if (c.src.startsWith("{#if", c.i)) {
      flushText();
      out.push(parseIfBlock(c));
      continue;
    }
    if (c.src.startsWith("{#each", c.i)) {
      flushText();
      out.push(parseEachBlock(c));
      continue;
    }
    if (c.peek() === "<") {
      flushText();
      out.push(parseTag(c));
      continue;
    }
    if (c.peek() === "{") {
      flushText();
      const expr = readJsExpr(c);
      out.push({ kind: "expr", expr: expr.trim() });
      continue;
    }
    buf += c.peek();
    c.i++;
  }
  if (parentTag !== null) {
    throw c.err(
      `unterminated children of <${parentTag}> — reached end of input without finding </${parentTag}>`,
      `Did you forget to close <${parentTag}>, or are you missing a {/if} or {/each} block inside it?`
    );
  }
  return out;
}

function parseIfBlock(c: Cursor): ViewNode {
  c.expect("{");
  c.expect("#if");
  c.skipWs();
  // Read expression until balanced '}'
  const test = readBalancedToBrace(c);
  c.expect("}");
  const consequent = parseChildrenUntil(
    c,
    (cur) => cur.src.startsWith("{:else}", cur.i) || cur.src.startsWith("{/if}", cur.i),
    null
  );
  let alternate: ViewNode[] = [];
  if (c.consume("{:else}")) {
    alternate = parseChildrenUntil(c, (cur) => cur.src.startsWith("{/if}", cur.i), null);
  }
  c.expect("{/if}");
  return { kind: "if", test: test.trim(), consequent, alternate };
}

function parseEachBlock(c: Cursor): ViewNode {
  c.expect("{");
  c.expect("#each");
  c.skipWs();
  // Read source expression until ` as `
  const sourceStart = c.i;
  // We need to find ` as ` at depth 0 (outside parens/braces/strings).
  let depth = 0;
  let asIdx = -1;
  while (c.i < c.src.length) {
    const ch = c.peek();
    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch;
      c.i++;
      while (c.i < c.src.length && c.peek() !== q) {
        if (c.peek() === "\\") c.i++;
        c.i++;
      }
      c.i++;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; c.i++; continue; }
    if (ch === ")" || ch === "]") { depth--; c.i++; continue; }
    if (ch === "}") {
      if (depth === 0) break;
      depth--;
      c.i++;
      continue;
    }
    if (depth === 0 && c.src.startsWith(" as ", c.i)) {
      asIdx = c.i;
      break;
    }
    c.i++;
  }
  if (asIdx === -1) throw c.err("expected ' as ' in {#each}");
  const each = c.src.slice(sourceStart, asIdx).trim();
  c.i = asIdx + 4; // skip ' as '
  c.skipWs();
  const asName = c.matchIdent();
  if (!asName) throw c.err("expected item binding name after 'as'");
  let indexName: string | null = null;
  c.skipWs();
  if (c.consume(",")) {
    c.skipWs();
    indexName = c.matchIdent();
    if (!indexName) throw c.err("expected index binding name");
    c.skipWs();
  }
  let keyExpr: string | null = null;
  if (c.peek() === "(") {
    keyExpr = readBalanced(c, "(", ")").trim();
    if (!keyExpr) throw c.err("empty key expression");
    c.skipWs();
  }
  c.expect("}");
  const children = parseChildrenUntil(c, (cur) => cur.src.startsWith("{/each}", cur.i), null);
  c.expect("{/each}");
  return { kind: "each", each, as: asName, index: indexName, key: keyExpr, children };
}

function readBalancedToBrace(c: Cursor): string {
  const start = c.i;
  let depth = 0;
  while (!c.eof()) {
    const ch = c.peek();
    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch;
      c.i++;
      while (!c.eof() && c.peek() !== q) {
        if (c.peek() === "\\") c.i++;
        c.i++;
      }
      c.i++;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; c.i++; continue; }
    if (ch === ")" || ch === "]") { depth--; c.i++; continue; }
    if (ch === "}") {
      if (depth === 0) return c.src.slice(start, c.i);
      depth--;
      c.i++;
      continue;
    }
    c.i++;
  }
  throw c.err("unterminated expression");
}
