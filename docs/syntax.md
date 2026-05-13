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

## `state`

Declares a reactive variable — a cell that participates in the view.

```tsx
state count = 0
state items = ["a", "b"]
state user = { name: "Ada" }
```

Compiles to `const count = cell(0)`. The rewriter then turns:

- `count` (read) → `count.get()`
- `count = x` → `count.set(x)`
- `count++` → `count.set(count.peek() + 1)`
- `count += 1` → `count.set(count.peek() + 1)`

Inside a `function`, all of the above Just Work. Outside (i.e. inside event handlers in the view), the same rewrite applies.

`state` values are serialized into the SSR capsule and restored on the client — that's how component state survives the network boundary.

## `let`

Declares a **non-reactive** mutable variable, scoped to the component instance.

```tsx
let lastId = 0
let cache = new Map()
let abortCtrl = null
```

Compiles to a plain JS `let lastId = 0;`. Reads and writes are not rewritten, no cell is allocated, and the value is **not** part of `serializeState`. Use this for per-instance bookkeeping that doesn't drive the view: caches, ID counters, debounce handles, abort controllers, anything the view never reads.

If a `let` identifier appears inside a `{expr}` interpolation in the view, it'll read its current value once but won't update when mutated — by design. Anything that should refresh the DOM goes in `state`.

> [!NOTE]
> There's no `const` keyword at component scope yet (use plain JS inside a `function`, or `import` from a sibling `.ts`), no `derived` keyword in the DSL (use `@rift/runtime`'s `derived` if you need it), and no async `server` keyword.

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
```

For the common case of "wire a text input back into a cell", you don't need a function at all — see [`bind:value` below](#bindvalue--bindchecked).

> [!IMPORTANT]
> Use `function`, not `fn`. `fn` appears in `PLAN.md` but the implemented keyword is `function`.

The function body is rewritten so reads/writes of `state` and `prop` identifiers go through their cells, while everything else (including `let` declarations) stays as regular JavaScript.

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

### `bind:value` / `bind:checked`

Two-way sugar that combines a property bind (cell → DOM property) with the appropriate event handler (DOM input → `cell.set(...)`):

```tsx
<input bind:value={draft} placeholder="add a todo..." />
<input type="checkbox" bind:checked={agreed} />
<select bind:value={pick}>
  <option value="a">A</option>
  <option value="b">B</option>
</select>
```

Resolution rules:

- The expression must be a writable reactive lvalue (typically a `state` identifier, or a reactive `prop`). The compiler rewrites the synthesized assignment so `bind:value={draft}` becomes `draft.set(e.target.value)` under the hood.
- `bind:value` listens to `input` on `<input>` / `<textarea>` and `change` on `<select>`.
- `bind:checked` listens to `change` and reads `e.target.checked` (booleans, no string coercion).
- Combining `bind:value` with an explicit `value=` or `oninput=` on the same element is a parse error.

Internally, `bind:` emits a property bind (`{ kind: "prop", get }`) rather than an attribute bind, so the runtime sets `el.value` / `el.checked` directly. This is what lets a programmatic cell update overwrite the visible value of an `<input>` the user has already typed into — `setAttribute('value', …)` only updates the *initial* value, not the live one.

### Event handlers

Any attribute starting with `on` followed by a lowercase letter (`onclick`, `oninput`, `onkeydown`, …) on a lowercase element is treated as a DOM event handler:

```tsx
<button onclick={increment}>+</button>
<input oninput={(e) => draft = e.target.value} />
```

The handler expression is rewritten just like a function body, so inline mutations to `state`/`prop` identifiers work:

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

`{:else}` is optional. On test changes, the active branch is mounted in its own [scope](./architecture.md); switching branches disposes the previous scope, so all effects inside the discarded subtree are torn down.

### `{#each ... as ...}` / `{/each}`

```tsx
{#each todos as item}
  <li>{item}</li>
{/each}

{#each todos as item, i}
  <li>{i}: {item}</li>
{/each}

{#each todos as item, i (item.id)}
  <li>{i}: {item.label}</li>
{/each}
```

The item binding (and optional index binding) is scoped to the block body — references inside aren't treated as reactive cells.

The optional `(key)` clause enables **keyed reconciliation**:

- For matched keys, the existing DOM (and any per-item effect scope or nested component instance) is reused; the reconciler only moves the node into its new position.
- New keys get a fresh build with their own scope.
- Removed keys have their scope disposed and DOM removed.

Without a key, the each falls back to dispose-then-rebuild on every list change — correct, but loses focus/scroll/animation state inside list items. Recommend a key whenever the list is mutated by anything other than append-only.

Components nested inside `{#each}` are instantiated lazily inside the per-item build callback, so each iteration owns its own instance. With a key, that instance survives reorders. **Open gap:** SSR-restored state for nested-in-each components doesn't currently round-trip — they re-create from scratch on hydration.

## What the compiler does (at a glance)

For each `state` and `prop`:

```tsx
state count = 0
// becomes:
const count = cell(0);
```

For each `let`:

```tsx
let lastId = 0
// becomes:
let lastId = 0;          // plain JS, untouched by the rewriter
```

For each function body and each `{expr}` in the view:

- Identifiers shadowed by parameters, locals, `each` bindings, or component-scope `let` declarations are left alone.
- Identifiers that match a `state`/`prop` name become `name.get()` on read and `name.set(...)` on write.
- Compound assignments (`++`, `--`, `+=`, etc.) on reactive names are expanded against `.peek()`.

The view is emitted as a tree of node descriptors (`{ kind: "element" | "text" | "bind" | "if" | "each" | "component", ... }`). `@rift/server` walks it to produce HTML; `@rift/client` walks the same tree (with `cell.set` calls re-running effects) to drive DOM updates.

See [architecture.md](./architecture.md) for the bigger picture.
