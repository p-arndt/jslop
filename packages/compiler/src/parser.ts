export type ViewNode =
  | { kind: "element"; tag: string; attrs: Record<string, string>; events: Record<string, string>; children: ViewNode[] }
  | { kind: "component"; name: string; props: Record<string, string>; children: ViewNode[] }
  | { kind: "if"; test: string; consequent: ViewNode[]; alternate: ViewNode[] }
  | { kind: "each"; each: string; as: string; index: string | null; key: string | null; children: ViewNode[] }
  | { kind: "text"; value: string }
  | { kind: "expr"; expr: string };

export interface ParsedImport {
  name: string;
  path: string;
}

export interface ParsedProp {
  name: string;
  defaultExpr: string | null;
}

export interface ParsedComponent {
  name: string;
  imports: ParsedImport[];
  props: ParsedProp[];
  /** Reactive cells, declared with `state`. */
  states: Array<{ name: string; init: string }>;
  /** Plain non-reactive bindings, declared with `let`. */
  lets: Array<{ name: string; init: string }>;
  fns: Array<{ name: string; params: string; body: string }>;
  view: ViewNode;
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
  err(msg: string): Error {
    const before = this.src.slice(Math.max(0, this.i - 30), this.i);
    const after = this.src.slice(this.i, this.i + 30);
    return new Error(`Parse error at offset ${this.i}: ${msg}\n... ${before}<HERE>${after} ...`);
  }
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
        if (c.peek() === "\\") c.i++;
        c.i++;
      }
      c.i++;
    } else if (ch === "/" && c.peek(1) === "/") {
      while (!c.eof() && c.peek() !== "\n") c.i++;
    } else if (ch === open) { depth++; c.i++; }
    else if (ch === close) { depth--; c.i++; }
    else c.i++;
  }
  if (depth !== 0) throw c.err(`unbalanced ${open}${close}`);
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

export function parseComponent(src: string): ParsedComponent {
  const c = new Cursor(src);
  const imports: ParsedImport[] = [];

  while (true) {
    c.skipWs();
    if (!c.consumeKeyword("import")) break;
    c.skipWs();
    const name = c.matchIdent();
    if (!name) throw c.err("expected import name");
    c.skipWs();
    if (!c.consumeKeyword("from")) throw c.err("expected 'from'");
    const path = readStringLiteral(c);
    c.consume(";");
    imports.push({ name, path });
  }

  c.skipWs();
  if (!c.consumeKeyword("component")) throw c.err("expected 'component'");
  const name = c.matchIdent();
  if (!name) throw c.err("expected component name");
  c.skipWs();
  const body = readBalanced(c, "{", "}");

  const inner = new Cursor(body);
  const states: ParsedComponent["states"] = [];
  const lets: ParsedComponent["lets"] = [];
  const fns: ParsedComponent["fns"] = [];
  const props: ParsedProp[] = [];
  let view: ViewNode | null = null;

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
        const startD = inner.i;
        while (!inner.eof() && inner.peek() !== "\n" && inner.peek() !== ";") inner.i++;
        defaultExpr = inner.src.slice(startD, inner.i).trim();
      }
      inner.consume(";");
      props.push({ name: pname, defaultExpr });
    } else if (inner.consumeKeyword("state")) {
      inner.skipWs();
      const sname = inner.matchIdent();
      if (!sname) throw inner.err("expected state name");
      inner.skipWs();
      inner.expect("=");
      const initStart = inner.i;
      while (!inner.eof() && inner.peek() !== "\n" && inner.peek() !== ";") inner.i++;
      const init = inner.src.slice(initStart, inner.i).trim();
      inner.consume(";");
      states.push({ name: sname, init });
    } else if (inner.consumeKeyword("let")) {
      inner.skipWs();
      const lname = inner.matchIdent();
      if (!lname) throw inner.err("expected let name");
      inner.skipWs();
      inner.expect("=");
      const initStart = inner.i;
      while (!inner.eof() && inner.peek() !== "\n" && inner.peek() !== ";") inner.i++;
      const init = inner.src.slice(initStart, inner.i).trim();
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
    } else if (inner.consumeKeyword("view")) {
      inner.skipWs();
      const viewBody = readBalanced(inner, "{", "}");
      view = parseView(viewBody.trim());
    } else {
      throw inner.err("unknown declaration; expected 'prop', 'state', 'let', 'function', or 'view'");
    }
  }

  if (!view) throw new Error(`component ${name} missing view`);
  return { name, imports, props, states, lets, fns, view };
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

  const attrs: Record<string, string> = {};
  const events: Record<string, string> = {};
  const props: Record<string, string> = {};
  const bindSpecs: Array<{ kind: string; expr: string }> = [];

  const finish = (children: ViewNode[]): ViewNode => {
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
        if (endMatch[0] !== parentTag) throw c.err(`closing tag mismatch: ${endMatch[0]} vs ${parentTag}`);
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
  if (parentTag !== null) throw c.err(`unterminated children of <${parentTag}>`);
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
