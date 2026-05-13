# @rift/compiler

Parses `.rift` files and emits ES modules ready for `@rift/server` (SSR) and `@rift/client` (boot).

```bash
pnpm add @rift/compiler
```

## API

```ts
import { compile, parseComponent, generate } from "@rift/compiler";

const js = compile(source, {
  runtimeImport: "@rift/runtime",   // default
  compiledExtension: ".compiled.mjs", // default (use ".rift" if your bundler re-transforms)
});
```

`compile = parseComponent → generate`. Use them separately if you need the AST.

```ts
const parsed = parseComponent(source);    // ParsedComponent
const js = generate(parsed, opts);        // string
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

- `import Name from "./path.rift"`
- `component Name { ... }`
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

Walks the parsed component and emits:

```js
import { cell, isReactive } from "@rift/runtime";
import Display from "./Display.compiled.mjs";

export const __rift_component = {
  name: "Counter",
  create(props = {}) {
    const count = cell(props?.count ?? 0);
    function increment() { count.set(count.peek() + 1); }
    function buildView() { return /* ViewNode tree */; }
    function serializeState() { return { count: count.peek(), children: ... }; }
    function restoreState(s) { if ("count" in s) count.set(s.count); ... }
    return { actions, buildView, serializeState, restoreState, children };
  },
};
export default __rift_component;
```

The view tree is a JSON-ish structure: `{ kind: "element" | "component" | "text" | "bind" | "if" | "each", ... }`. `@rift/server` and `@rift/client` both walk it.

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
