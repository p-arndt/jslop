import { parse } from "acorn";
import MagicString from "magic-string";

/* AST nodes from acorn use the ESTree shape but with loose typing. */
type Node = {
  type: string;
  start: number;
  end: number;
  [key: string]: any;
};

interface Ctx {
  ms: MagicString;
  names: Set<string>;
  readMethod: "peek" | "get";
}

function collectBindingsFromPattern(node: Node | null | undefined, out: Set<string>): void {
  if (!node) return;
  switch (node.type) {
    case "Identifier":
      out.add(node.name);
      return;
    case "ObjectPattern":
      for (const p of node.properties as Node[]) {
        if (p.type === "RestElement") collectBindingsFromPattern(p.argument, out);
        else collectBindingsFromPattern(p.value, out);
      }
      return;
    case "ArrayPattern":
      for (const el of node.elements as (Node | null)[]) collectBindingsFromPattern(el, out);
      return;
    case "AssignmentPattern":
      collectBindingsFromPattern(node.left, out);
      return;
    case "RestElement":
      collectBindingsFromPattern(node.argument, out);
      return;
  }
}

function collectBlockDeclarations(block: Node): Set<string> {
  const out = new Set<string>();
  for (const stmt of block.body as Node[]) {
    if (stmt.type === "VariableDeclaration") {
      for (const decl of stmt.declarations as Node[]) collectBindingsFromPattern(decl.id, out);
    } else if (stmt.type === "FunctionDeclaration" && stmt.id) {
      out.add(stmt.id.name);
    }
  }
  return out;
}

function pushScopeIfNeeded(node: Node, scopes: Set<string>[]): boolean {
  if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  ) {
    const scope = new Set<string>();
    for (const p of node.params as Node[]) collectBindingsFromPattern(p, scope);
    if (node.id && node.type !== "ArrowFunctionExpression") scope.add(node.id.name);
    scopes.push(scope);
    return true;
  }
  if (node.type === "BlockStatement") {
    scopes.push(collectBlockDeclarations(node));
    return true;
  }
  if (node.type === "ForStatement" || node.type === "ForInStatement" || node.type === "ForOfStatement") {
    const scope = new Set<string>();
    const init = node.init as Node | undefined;
    if (init && init.type === "VariableDeclaration") {
      for (const decl of init.declarations as Node[]) collectBindingsFromPattern(decl.id, scope);
    }
    const left = node.left as Node | undefined;
    if (left && left.type === "VariableDeclaration") {
      for (const decl of left.declarations as Node[]) collectBindingsFromPattern(decl.id, scope);
    }
    scopes.push(scope);
    return true;
  }
  if (node.type === "CatchClause") {
    const scope = new Set<string>();
    if (node.param) collectBindingsFromPattern(node.param, scope);
    scopes.push(scope);
    return true;
  }
  return false;
}

function isShadowed(name: string, scopes: Set<string>[]): boolean {
  for (const scope of scopes) if (scope.has(name)) return true;
  return false;
}

function shouldRewrite(name: string, ctx: Ctx, scopes: Set<string>[]): boolean {
  return ctx.names.has(name) && !isShadowed(name, scopes);
}

function isNonReferencePosition(node: Node, parent: Node | null): boolean {
  if (!parent) return false;
  if (parent.type === "AssignmentExpression" && parent.left === node) return true;
  if (parent.type === "UpdateExpression" && parent.argument === node) return true;
  if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) return true;
  if (parent.type === "Property" && parent.key === node && !parent.computed && !parent.shorthand) return true;
  if (parent.type === "LabeledStatement" && parent.label === node) return true;
  if ((parent.type === "BreakStatement" || parent.type === "ContinueStatement") && parent.label === node) return true;
  if (parent.type === "ExportSpecifier" || parent.type === "ImportSpecifier") return true;
  if (parent.type === "VariableDeclarator" && parent.id === node) return true;
  if (
    (parent.type === "FunctionDeclaration" ||
      parent.type === "FunctionExpression" ||
      parent.type === "ArrowFunctionExpression") &&
    parent.id === node
  ) return true;
  return false;
}

function walkNode(node: Node | null | undefined, ctx: Ctx, scopes: Set<string>[], parent: Node | null): void {
  if (!node || typeof node !== "object") return;

  if (node.type === "UpdateExpression" && node.argument?.type === "Identifier") {
    const name: string = node.argument.name;
    if (shouldRewrite(name, ctx, scopes)) {
      const op = node.operator === "++" ? "+" : "-";
      ctx.ms.overwrite(node.start, node.end, `${name}.set(${name}.peek() ${op} 1)`);
      return;
    }
  }

  if (node.type === "AssignmentExpression" && node.left?.type === "Identifier") {
    const name: string = node.left.name;
    if (shouldRewrite(name, ctx, scopes)) {
      const right: Node = node.right;
      const operator: string = node.operator;
      walkNode(right, ctx, scopes, node);
      const rhs = ctx.ms.slice(right.start, right.end);
      if (operator === "=") {
        ctx.ms.overwrite(node.start, node.end, `${name}.set(${rhs})`);
      } else {
        const op = operator[0];
        ctx.ms.overwrite(node.start, node.end, `${name}.set(${name}.peek() ${op} (${rhs}))`);
      }
      return;
    }
  }

  if (
    node.type === "Property" &&
    node.shorthand &&
    node.key?.type === "Identifier" &&
    shouldRewrite(node.key.name, ctx, scopes)
  ) {
    const name: string = node.key.name;
    ctx.ms.overwrite(node.start, node.end, `${name}: ${name}.${ctx.readMethod}()`);
    return;
  }

  if (node.type === "Identifier" && shouldRewrite(node.name, ctx, scopes) && !isNonReferencePosition(node, parent)) {
    ctx.ms.overwrite(node.start, node.end, `${node.name}.${ctx.readMethod}()`);
    return;
  }

  const popScope = pushScopeIfNeeded(node, scopes);
  try {
    for (const key in node) {
      if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range") continue;
      const val = node[key];
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item && typeof item === "object" && typeof item.type === "string") {
            walkNode(item, ctx, scopes, node);
          }
        }
      } else if (val && typeof val === "object" && typeof val.type === "string") {
        walkNode(val, ctx, scopes, node);
      }
    }
  } finally {
    if (popScope) scopes.pop();
  }
}

export function rewriteFnBody(source: string, reactiveNames: string[]): string {
  const wrap = `(function(){\n${source}\n})`;
  const prefix = `(function(){\n`.length;
  const suffix = `\n})`.length;
  const ms = new MagicString(wrap);
  const ast = parse(wrap, { ecmaVersion: 2022, sourceType: "script" }) as unknown as Node;
  walkNode(ast, { ms, names: new Set(reactiveNames), readMethod: "peek" }, [new Set()], null);
  const out = ms.toString();
  return out.slice(prefix, out.length - suffix);
}

export function rewriteExpr(source: string, reactiveNames: string[]): string {
  const wrap = `(${source})`;
  const ms = new MagicString(wrap);
  const ast = parse(wrap, { ecmaVersion: 2022, sourceType: "script" }) as unknown as Node;
  walkNode(ast, { ms, names: new Set(reactiveNames), readMethod: "get" }, [new Set()], null);
  const out = ms.toString();
  return out.slice(1, out.length - 1);
}
