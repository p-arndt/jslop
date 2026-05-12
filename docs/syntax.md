# `.rift` syntax reference

This is the **currently implemented** DSL. For aspirational syntax (server blocks, `derived`, `mount`, `style`, `schema`) see [`PLAN.md`](../PLAN.md) and [`TODO.md`](../TODO.md).

## File shape

A `.rift` file has, in order:

1. Zero or more `import` declarations.
2. Exactly one `component` block.

```tsx
import Other from "./Other.rift"

component Name {
  // declarations
  view { <root /> }
}
```

The component name is the JS identifier the file exports as `default`.

## Imports

```tsx
import Default from "./path.rift"
import Helper from "../lib/helpers.ts"
```

Only the **default import** form is supported. `.rift` paths are automatically rewritten to the compiled extension (`.rift` → `.compiled.mjs` by default, or whatever the bundler passes — `@rift/vite` keeps `.rift` so it can re-run the transform).

## `prop`

Declares an input parameter. Optional default expression after `=`.

```tsx
prop label = "?"
prop onclick = () => {}
prop count          // no default → undefined
```

Props arrive from the parent's view (e.g. `<Counter count={5} />`). Internally they're wrapped:

- If the parent passes a reactive cell or `derived`, it's used as-is.
- Otherwise the value is wrapped in a fresh `cell()` so reads inside the component are reactive.

So inside the component body, `label` always reads like a reactive variable — no `.value`, no `.get()`.

## `let`

Declares a local reactive variable.

```tsx
let count = 0
let items = ["a", "b"]
let user = { name: "Ada" }
```

Compiles to `const count = cell(0)`. The rewriter then turns:

- `count` (read) → `count.get()`
- `count = x` → `count.set(x)`
- `count++` → `count.set(count.peek() + 1)`
- `count += 1` → `count.set(count.peek() + 1)`

Inside a `function`, all of the above Just Work. Outside (i.e. inside event handlers in the view), the same rewrite applies.

> [!NOTE]
> `let` is the only state declaration today. There's no `const` (use plain JS at the top of a function), no `derived` keyword in the DSL yet (use `@rift/runtime`'s `derived` if you need it), and no async `server` keyword.

## `function`

A plain function declaration with reactive-aware identifiers.

```tsx
function increment() {
  count++
}

function addTodo() {
  if (draft.trim().length > 0) {
    todos = [...todos, draft.trim()]
    draft = ""
  }
}

function onInput(e) {
  draft = e.target.value
}
```

> [!IMPORTANT]
> Use `function`, not `fn`. `fn` appears in `PLAN.md` but the implemented keyword is `function`.

The function body is rewritten so reads/writes of `let` and `prop` identifiers go through their cells, while everything else stays as regular JavaScript.

## `view`

The markup. Exactly one block per component, must contain exactly one root element.

```tsx
view {
  <div>
    <h1>Hello</h1>
  </div>
}
```

### Elements

Lowercase tag → real DOM element. Self-closing is supported (`<br />`). Children can be any mix of text, `{expr}`, and nested tags.

### Components

A tag whose name starts with an uppercase letter is treated as a component reference. It must resolve to an imported component:

```tsx
import Stepper from "../components/Stepper.rift"
// ...
<Stepper label="+" onstep={increment} />
```

Component props can be string literals or `{expressions}`:

```tsx
<Display value={count} label="Count" />
<Toggle checked />          // boolean shorthand: checked = true
```

### Attributes

DOM attributes are emitted as-is on lowercase elements. Values can be:

- `"string"` — written verbatim into HTML.
- `{expression}` — reactive bind: re-evaluated whenever its dependencies change.

```tsx
<input value={draft} placeholder="add a todo..." />
<a href="/about" class="text-blue-500">About</a>
```

### Event handlers

Any attribute starting with `on` followed by a lowercase letter (`onclick`, `oninput`, `onkeydown`, …) on a lowercase element is treated as a DOM event handler:

```tsx
<button onclick={increment}>+</button>
<input oninput={onDraftInput} />
```

The handler expression is rewritten just like a function body, so inline mutations to `let`/`prop` identifiers work:

```tsx
<button onclick={() => count++}>+</button>
```

For component tags, `on*` props are **not** auto-bound — they're just regular props (the component decides what to do):

```tsx
<Stepper label="+" onstep={increment} />
// inside Stepper:
//   prop onstep = () => {}
//   <button onclick={onstep}>{label}</button>
```

### Text and interpolation

Text between tags is HTML-escaped on output. `{expr}` interpolates a reactive expression:

```tsx
<h1>Hello, {user.name}!</h1>
<p>{count} item{count === 1 ? "" : "s"}</p>
```

The expression is `String(...)`-coerced and updates fine-grained when its dependencies change.

### `{#if}` / `{:else}` / `{/if}`

```tsx
{#if count > 0}
  <p>positive</p>
{:else}
  <p>zero or negative</p>
{/if}
```

`{:else}` is optional. On test changes, the inactive branch is torn down and the active branch is rebuilt.

> [!CAUTION]
> Effects inside the torn-down branch don't currently have a disposer scope, so subscriptions can leak. Tracked in [TODO.md](../TODO.md).

### `{#each ... as ...}` / `{/each}`

```tsx
{#each todos as item}
  <li>{item}</li>
{/each}

{#each todos as item, i}
  <li>{i}: {item}</li>
{/each}
```

The item binding (and optional index binding) is scoped to the block body — references inside aren't treated as reactive cells.

> [!CAUTION]
> List reconciliation is **full rebuild** today. Any change to the list re-creates all child nodes, losing focus/scroll/animation state. Keyed reconciliation is on the roadmap.

## What the compiler does (at a glance)

For each `let` and `prop`:

```tsx
let count = 0
// becomes:
const count = cell(0);
```

For each function body and each `{expr}` in the view:

- Identifiers shadowed by parameters, locals, or `each` bindings are left alone.
- Identifiers that match a `let`/`prop` name become `name.get()` on read and `name.set(...)` on write.
- Compound assignments (`++`, `--`, `+=`, etc.) are expanded against `.peek()`.

The view is emitted as a tree of node descriptors (`{ kind: "element" | "text" | "bind" | "if" | "each" | "component", ... }`). `@rift/server` walks it to produce HTML; `@rift/client` walks the same tree (with `cell.set` calls re-running effects) to drive DOM updates.

See [architecture.md](./architecture.md) for the bigger picture.
