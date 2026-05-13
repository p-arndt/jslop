# @jslop/compiler

Parses `.jslop` files and emits ES modules ready for `@jslop/server` (SSR) and `@jslop/client` (boot).

```bash
pnpm add @jslop/compiler
```

## API

```ts
import { compile, parseFile, parseComponent, generate } from "@jslop/compiler";

const js = compile(source, {
  runtimeImport: "@jslop/runtime",   // default
  compiledExtension: ".compiled.mjs", // default (use ".jslop" if your bundler re-transforms)
});
```

`compile = parseFile → generate`. Use them separately if you need the AST.

```ts
const file = parseFile(source);           // ParsedFile { imports, components }
const js = generate(file, opts);          // string

// Single-component shorthand (throws if the file has no components):
const comp = parseComponent(source);      // ParsedComponent (= file.components[0])
```

## Pipeline

```
source ──► parser ──► ParsedComponent ──► codegen ──► JS module
                                  │
                                  └──► rewriter (per fn body / per expr)
                                         (acorn + magic-string)
```

### 1. Parser (`parser.ts`)

Hand-rolled cursor parser. Recognizes:

- `import Name from "./path.jslop"` — default import
- `import { A, B as Renamed } from "./path.jslop"` — named imports (combinable with a default)
- One or more `component Name { ... }` blocks per file
- `prop name = defaultExpr`
- `state name = initExpr` — reactive cell (participates in the view)
- `let name = initExpr` — non-reactive mutable binding (plain JS)
- `function name(params) { body }`
- `view { ... }`

Inside `view`:

- Elements `<tag attr="..." attr={expr} onclick={expr}>...</tag>`
- Components `<Capitalized prop={expr} />`
- Text and `{expr}` interpolation
- `{#if test}...{:else}...{/if}`
- `{#each list as item, i}...{/each}`

### 2. Rewriter (`rewrite.ts`)

AST-aware JS rewrite using `acorn` for parsing and `magic-string` for surgical edits. For each reactive identifier (a `prop` or `state` name):

- Reads → `name.get()`
- Writes (`x = y`) → `x.set(y)`
- Compound assignments (`x++`, `x += 1`) → `x.set(x.peek() + 1)`

Non-reactive `let` declarations at component scope are left as plain JS — they don't participate in the rewrite and shadow any outer reactive of the same name. Shadow-aware in general: function parameters, locally declared `const`/`let`, and `{#each}` bindings shadow outer reactives.

### 3. Codegen (`codegen.ts`)

Walks the parsed file and emits one descriptor per declared component, with the first also re-exported as `default` so legacy default-import callers keep working:

```js
import { cell, isReactive } from "@jslop/runtime";
import { Display } from "./widgets.compiled.mjs";

export const Counter = {
  name: "Counter",
  create(props = {}) {
    const count = cell(props?.count ?? 0);
    function increment() { count.set(count.peek() + 1); }
    function buildView() { return /* ViewNode tree */; }
    function serializeState() { return { count: count.peek(), children: ... }; }
    function restoreState(s) { if ("count" in s) count.set(s.count); ... }
    return { actions, buildView, serializeState, restoreState, children };
  }
};

// Additional `component` blocks in the same .jslop file become further
// `export const Helper = { ... }` statements, in declaration order.

export default Counter;
```

The view tree is a JSON-ish structure: `{ kind: "element" | "component" | "text" | "bind" | "if" | "each", ... }`. `@jslop/server` and `@jslop/client` both walk it.

## Not implemented

> [!NOTE]
> The following from [`PLAN.md`](../../PLAN.md) are still missing:
>
> - Source maps (codegen outputs none — stack traces point at compiled coords)
> - Friendly diagnostics with file:line locations
> - `derived`, `when`, `mount`, `cleanup` block syntax
> - `style Name { variants: ... }` blocks
> - `schema Name { ... }` blocks
> - `server function ...` syntax + bundle splitting

See [`TODO.md`](../../TODO.md) for status.
