# `.jslop` cheatsheet

One-page reference for every construct currently implemented. Each section links to a focused page with details and gotchas.

## File shape

```tsx
import Default from "./Other.jslop"
import { Helper, OtherHelper as Renamed } from "./widgets.jslop"

component Name {
  // declarations (any order)
  view { <root /> }
}

component Sibling {
  view { <span/> }
}
```

- Many components per file. First is the default export, all are named exports. → [Components](./components.md)
- `.jslop` import paths are rewritten to the compiled module by the bundler.

## Declarations

| Keyword            | Reactive   | Serialized | Use for                                                |
|--------------------|------------|------------|--------------------------------------------------------|
| `prop x = d`       | yes        | parent     | input from a parent                                    |
| `state x = d`      | yes        | yes        | anything the view reads                                |
| `derived x = expr` | yes (read) | no (recomputed) | memoized value computed from other reactives     |
| `let x = d`        | no         | no         | per-instance bookkeeping the view never reads          |
| `function f() {}`  | —          | —          | actions / event handlers                               |
| `head { ... }`     | —          | —          | per-component `<head>` fragment (`<title>`, meta, …)   |
| `style { ... }`    | —          | —          | scoped CSS for this component                          |
| `load { ... }`     | —          | —          | server-side data fetching for routes/layouts           |
| `action f(p) {}`   | —          | —          | server-only mutation handler (POST endpoint)           |

→ [Components](./components.md)

## `derived` — memoized reactive value

```tsx
state n = 1
derived doubled = n * 2
derived quad = doubled * 2
```

Recomputes only when an input it read actually changes; cached otherwise. RHS identifiers that match `state`/`prop`/`derived` are rewritten to `.get()`. → [Components](./components.md), [Reactivity](./reactivity.md)

## `head { ... }` — per-component `<head>` fragment

```tsx
component About {
  head {
    <title>About · Site</title>
    <meta name="description" content="…"/>
  }
  view { <main>…</main> }
}
```

Reactive interpolations work (`<title>{post.title}</title>`). When multiple components on a page declare `head`, the route's fragment is rendered after layouts, so its `<title>` wins. → [SSR & resumability](./ssr-and-resumability.md)

## `load { ... }` — server-side data fetching (routes & layouts)

```tsx
import { findPost } from "../lib/posts.js"

component PostPage {
  prop slug = ""
  prop post = null

  load {
    const post = await findPost(params.slug)
    if (!post) notFound()
    return { post }
  }

  view { <article><h1>{post.title}</h1></article> }
}
```

Runs on the server before render; returned object merges into props (URL params → layout loads → route load). May be `async`. Call `notFound()` from `@jslop/runtime` to trigger the 404 chain. → [Routing → `load`](./routing.md#load-----running-code-before-render)

## `action { ... }` — server mutation handler

```tsx
component Inbox {
  action create(input) {
    const { createTask } = await import("../store.js")
    return await createTask(input)
  }

  function submit(e) { e.preventDefault(); create({ title: "buy milk" }) }

  view { <form onsubmit={submit}>…</form> }
}
```

Body runs **only on the server**. The compiler emits a client stub that POSTs to the route URL with header `x-jslop-action: <name>`. On success the route's `load { ... }` re-runs and the new HTML swaps in. Throw `redirect(url)` from `@jslop/runtime` to navigate elsewhere instead (useful after a delete that would 404 the current page). The body sees `params`, `url`, and `request` in scope. → [Actions](./actions.md)

## `style { ... }` — scoped CSS

```tsx
component Card {
  style {
    .row { color: red; }
    p { font-size: 0.875rem; }
  }
  view { <div class="row"><p>…</p></div> }
}
```

The compiler adds a `jslop-<name>-<hash>` class on the root element and rewrites every selector to be prefixed by `.jslop-…-…`, so styles don't leak. Use it alongside global CSS or Tailwind — they don't conflict. → [Styling](./styling.md)

## View — elements & attributes

```tsx
view {
  <div class="card">
    <h1>{title}</h1>
    <p>{count} item{count === 1 ? "" : "s"}</p>
    <a href="/x" class={active ? "on" : ""}>x</a>
    <img src={url} alt="" />
    <input disabled />              {/* boolean shorthand */}
  </div>
}
```

- Exactly one root element per view.
- Lowercase tag → DOM element. PascalCase → component.
- String literals or `{expr}` for attribute values. `{expr}` is reactive.

→ [Template syntax](./template-syntax.md)

## Components

```tsx
<Stepper label="+" onstep={inc} />
<Display value={count} label="Count" />
```

- `on*` on a component tag is a **regular prop** (not auto-bound to DOM events).

## Events

```tsx
<button onclick={inc}>+</button>
<button onclick={() => count++}>+</button>
<input oninput={e => draft = e.target.value} />
<form onsubmit={e => { e.preventDefault(); save() }}>...</form>
```

→ [Events](./events.md)

## Bindings

```tsx
<input bind:value={draft} />
<input type="checkbox" bind:checked={agreed} />
<select bind:value={pick}>
  <option value="a">A</option>
</select>
```

- Bound expression must be a writable reactive lvalue (`state` or reactive `prop`).
- Can't combine `bind:value` with `value=` or `oninput=` on the same element.

→ [Bindings](./bindings.md)

## Logic blocks

```tsx
{#if cond}
  <p>yes</p>
{:else}
  <p>no</p>
{/if}

{#each list as item, i (item.id)}
  <li>{i}: {item.label}</li>
{/each}
```

- Always key any `{#each}` that mutates by anything other than append-only.
- `{:else if}` is not supported yet; nest a fresh `{#if}` inside `{:else}`.

→ [Logic blocks](./logic-blocks.md)

## `<children/>`

```tsx
component Layout {
  view {
    <div><children/></div>
  }
}
```

Marks where wrapped content renders. Used by layouts (and, in the future, by any wrapper component receiving children).

## Reactivity runtime

When you need to drop down a level (custom helpers, derived values, ad-hoc effects):

```ts
import { cell, derived, effect, batch, untrack } from "@jslop/runtime";

const x = cell(0);
const y = derived(() => x.get() * 2);
effect(() => console.log(y.get()));
batch(() => { x.set(1); x.set(2); });   // y/effect run once
```

→ [Reactivity](./reactivity.md)

## What the compiler does (in one breath)

For each `state` / `prop`: declare a `cell`. For each `let`: declare a plain JS variable. Inside functions and view `{expr}`s: identifiers that match a `state`/`prop` name become `.get()` on read and `.set(...)` on write; `++`/`--`/`+=` etc. expand via `.peek()`. Everything else (parameters, locals, `let`, `each` bindings) is left alone.

The view is emitted as a tree of node descriptors (`element`, `text`, `bind`, `if`, `each`, `component`). The server walks it to produce HTML; the client walks the same tree and wraps each `bind` in an `effect` for fine-grained updates.

→ [Internals: architecture](./internals/architecture.md)

## Not in the DSL yet

Typed `server function` (split-bundled RPC with auth context) · `mount`/`cleanup` blocks · `{#await}` · `{#snippet}` · `{:else if}` · catch-all routes · fragments · spread props (parsed, partial impl) · `style Name { variants: ... }` first-class variants. (The boring `action { ... }` block above is the shipping stepping stone; the full typed-RPC story still belongs to a future release.)

→ [Roadmap](./roadmap.md)
