# Styling

JSlop has no opinions about CSS. It ships nothing that rewrites classes, no CSS-in-JS engine, no scoped-styles compiler. You use the browser's CSS, however you like.

## The `class` attribute

`class` is a normal attribute. String literal or expression:

```tsx
<a class="nav-link">about</a>
<a class={active ? "nav-link active" : "nav-link"}>about</a>
```

`{expression}` re-evaluates fine-grained, so toggling a class is a one-line state update:

```tsx
component Toggle {
  state on = false

  view {
    <button
      class={on ? "btn btn-on" : "btn btn-off"}
      onclick={() => on = !on}
    >
      {on ? "on" : "off"}
    </button>
  }
}
```

> [!TIP]
> For multi-class composition, a tiny helper goes a long way:
>
> ```js
> // src/lib/cx.js
> export const cx = (...xs) => xs.filter(Boolean).join(" ")
> ```
> ```tsx
> import { cx } from "../lib/cx.js"
>
> <button class={cx("btn", active && "btn-active", loading && "is-loading")} />
> ```
>
> If you want, drop in the popular `clsx` package — nothing in JSlop gets in its way.

## Global CSS

Drop a CSS file in your project, then point `@jslop/vite` at it:

```css
/* src/app.css */
body { font-family: system-ui; margin: 0; }
.btn { padding: 0.5rem 1rem; border-radius: 0.5rem; }
```

```js
// vite.config.mjs
import jslop from "@jslop/vite";
export default { plugins: [jslop({ css: "/src/app.css" })] };
```

`@jslop/vite` injects the stylesheet into every SSR'd page. In production, Vite hashes the file and the SSR entry reads the manifest to emit the correct `<link rel="stylesheet">`.

## Tailwind v4

Tailwind is one config line away:

```js
// vite.config.mjs
import jslop from "@jslop/vite";
export default {
  plugins: [
    jslop({
      tailwind: true,
      css: "/src/app.css",
    }),
  ],
};
```

```css
/* src/app.css */
@import "tailwindcss";

@source "./**/*.jslop";   /* tell tailwind to scan .jslop files */
```

`tailwind: true` auto-wires `@tailwindcss/vite` so you don't have to install/configure it manually. The `@source` directive in your CSS tells Tailwind where to look for class names — point it at `**/*.jslop` and it picks up everything.

Then use Tailwind classes anywhere:

```tsx
<button class="rounded-lg bg-emerald-500 px-4 py-2 hover:bg-emerald-400">
  click me
</button>
```

## Other CSS toolchains

Anything Vite supports works because JSlop defers entirely to Vite for CSS:

- **PostCSS** — drop a `postcss.config.js`.
- **CSS modules** — `import styles from "./Foo.module.css"`, use `class={styles.foo}`.
- **Sass / Less** — install the preprocessor, Vite handles the rest.
- **vanilla-extract / pigment-css / panda** — should work; not tested.

There's no special handshake. Whatever Vite does, JSlop inherits.

## Inline styles

The `style` attribute is a normal attribute:

```tsx
<div style={`background: ${color}; padding: 1rem;`}>...</div>
<div style="color: red">...</div>
```

There's no object-form `style={{...}}` like in React. Build the string yourself.

## Scoped styles

A component can declare a `style { ... }` block whose selectors are rewritten to a unique scope class. Selectors only match elements inside that component's view.

```tsx
component Card {
  prop title = ""

  style {
    .row    { display: flex; gap: 0.5rem; }
    .title  { font-weight: 600; }
    p       { color: #888; }
  }

  view {
    <article class="row">
      <h2 class="title">{title}</h2>
      <p>body copy</p>
    </article>
  }
}
```

What the compiler does:

- Generates a scope class like `jslop-card-1a2b3c` (component name + content hash) and appends it to the **root element's** `class` attribute.
- Prefixes every selector in the block with `.jslop-card-1a2b3c`, so `.row` becomes `.jslop-card-1a2b3c .row` and bare `p` becomes `.jslop-card-1a2b3c p`. Styles only match inside this component.
- Registers the resulting CSS once at module load. During SSR, the server emits a single `<style data-jslop-style="...">` per unique component in the page `<head>`. The client injects the same registry on boot if it isn't already present.

> [!NOTE]
> The scope class lives on the **root element only**. Nested components have their own scope; their roots get their own class. Descendant selectors (`.row p`) match across that boundary because the scope-prefixed selector still applies to any descendant — including children of nested components — but element-only selectors like `p` will not target a nested component's root (its root carries its own scope class, not this one).

Use `style { ... }` for component-local rules, and global CSS / Tailwind / CSS modules for everything cross-cutting. They compose: scoped rules sit alongside utility classes without any handshake.

First-class variants (`style Button { base, variants: ... }` from `PLAN.md`) are still on the [roadmap](./roadmap.md).

## See also

- [Project structure](./project-structure.md) — where `app.css` and `vite.config.mjs` live.
- [Template syntax](./template-syntax.md) — how `class={expr}` re-evaluates reactively.
