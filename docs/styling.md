# Styling

Rift has no opinions about CSS. It ships nothing that rewrites classes, no CSS-in-JS engine, no scoped-styles compiler. You use the browser's CSS, however you like.

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
> If you want, drop in the popular `clsx` package — nothing in Rift gets in its way.

## Global CSS

Drop a CSS file in your project, then point `@rift/vite` at it:

```css
/* src/app.css */
body { font-family: system-ui; margin: 0; }
.btn { padding: 0.5rem 1rem; border-radius: 0.5rem; }
```

```js
// vite.config.mjs
import rift from "@rift/vite";
export default { plugins: [rift({ css: "/src/app.css" })] };
```

`@rift/vite` injects the stylesheet into every SSR'd page. In production, Vite hashes the file and the SSR entry reads the manifest to emit the correct `<link rel="stylesheet">`.

## Tailwind v4

Tailwind is one config line away:

```js
// vite.config.mjs
import rift from "@rift/vite";
export default {
  plugins: [
    rift({
      tailwind: true,
      css: "/src/app.css",
    }),
  ],
};
```

```css
/* src/app.css */
@import "tailwindcss";

@source "./**/*.rift";   /* tell tailwind to scan .rift files */
```

`tailwind: true` auto-wires `@tailwindcss/vite` so you don't have to install/configure it manually. The `@source` directive in your CSS tells Tailwind where to look for class names — point it at `**/*.rift` and it picks up everything.

Then use Tailwind classes anywhere:

```tsx
<button class="rounded-lg bg-emerald-500 px-4 py-2 hover:bg-emerald-400">
  click me
</button>
```

## Other CSS toolchains

Anything Vite supports works because Rift defers entirely to Vite for CSS:

- **PostCSS** — drop a `postcss.config.js`.
- **CSS modules** — `import styles from "./Foo.module.css"`, use `class={styles.foo}`.
- **Sass / Less** — install the preprocessor, Vite handles the rest.
- **vanilla-extract / pigment-css / panda** — should work; not tested.

There's no special handshake. Whatever Vite does, Rift inherits.

## Inline styles

The `style` attribute is a normal attribute:

```tsx
<div style={`background: ${color}; padding: 1rem;`}>...</div>
<div style="color: red">...</div>
```

There's no object-form `style={{...}}` like in React. Build the string yourself.

## Scoped styles?

> [!NOTE]
> Component-scoped styles (like Svelte's `<style>` block or Vue's `<style scoped>`) are **not implemented**. Plan today: keep styling open and let users pick. CSS modules + Tailwind together cover most needs.

## See also

- [Project structure](./project-structure.md) — where `app.css` and `vite.config.mjs` live.
- [Template syntax](./template-syntax.md) — how `class={expr}` re-evaluates reactively.
