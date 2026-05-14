# Using JSlop from a CDN

JSlop is primarily a compiled framework — you write `.jslop` files and a Vite plugin turns them into resumable, SSR'd web apps. But the **reactivity runtime** (`cell`, `derived`, `effect`, `batch`, `untrack`) is also useful on its own, and it's small enough (~2.3 KB min, no dependencies, no Node built-ins) to drop into any HTML page via a `<script>` tag.

> [!NOTE]
> This page covers the **runtime-only** CDN flavor. It gives you the reactive primitives, but **not** the `.jslop` view DSL, SSR, or resumability — you write plain DOM code against the primitives. The full standalone build (with an in-browser compiler that parses `<script type="jslop">`) is on the [roadmap](./roadmap.md) under "Distribution / CDN usage" in [TODO.md](../TODO.md).

---

## Quickest path — IIFE global

```html
<!doctype html>
<html>
  <body>
    <button id="inc">clicked <span id="count">0</span> times</button>

    <script src="https://cdn.jsdelivr.net/npm/@jslop/runtime/dist/jslop-runtime.global.min.js"></script>
    <script>
      const { cell, effect } = JSlop;

      const count = cell(0);
      const el = document.getElementById("count");

      effect(() => { el.textContent = count.get(); });

      document.getElementById("inc").addEventListener("click", () => {
        count.update(n => n + 1);
      });
    </script>
  </body>
</html>
```

The IIFE bundle attaches `JSlop` to the global scope. Everything exported from `@jslop/runtime` is available there: `cell`, `derived`, `effect`, `batch`, `untrack`, `isReactive`, `createScope`, `runInScope`, `disposeScope`, `onCleanup`, `NotFoundError`, `notFound`, `isNotFoundError`, `registerStyles`, `getRegisteredStyle`.

The `unpkg` equivalent is:

```html
<script src="https://unpkg.com/@jslop/runtime/dist/jslop-runtime.global.min.js"></script>
```

Both CDNs read the `unpkg` / `jsdelivr` fields in `@jslop/runtime`'s `package.json`, so a bare `https://cdn.jsdelivr.net/npm/@jslop/runtime` URL also resolves to the same file.

---

## Modern path — ESM

If you're already writing `<script type="module">`, prefer the ESM bundle. esm.sh serves a bare-specifier-friendly version:

```html
<script type="module">
  import { cell, derived, effect } from "https://esm.sh/@jslop/runtime";

  const count = cell(0);
  const doubled = derived(() => count.get() * 2);
  effect(() => console.log("count:", count.get(), "doubled:", doubled.get()));

  count.set(5);  // logs "count: 5 doubled: 10"
</script>
```

Or pin to the minified bundle directly:

```html
<script type="module">
  import { cell, effect } from "https://cdn.jsdelivr.net/npm/@jslop/runtime/dist/jslop-runtime.esm.min.js";
</script>
```

---

## What you get, what you don't

| Feature                                    | CDN runtime | Full framework |
|--------------------------------------------|-------------|----------------|
| `cell` / `derived` / `effect` / `batch`    | ✅           | ✅              |
| `.jslop` view DSL (`view { … }`)            | ❌           | ✅              |
| `{#if}` / `{#each}` / `bind:value`         | ❌           | ✅              |
| SSR + state capsule + client resume        | ❌           | ✅              |
| File-system routing + layouts              | ❌           | ✅              |
| Scoped styles via `style { … }`            | ❌           | ✅              |

The CDN flavor is right for: sprinkling reactivity into an existing static page, REPLs and embed-in-a-blog-post demos, prototyping the runtime API without setting up a project. For a real app, use the [getting started](./getting-started.md) flow.

---

## A worked example: live-search filter

```html
<input id="q" placeholder="type to filter…" />
<ul id="list"></ul>

<script src="https://cdn.jsdelivr.net/npm/@jslop/runtime/dist/jslop-runtime.global.min.js"></script>
<script>
  const { cell, derived, effect } = JSlop;

  const items = ["apple", "apricot", "banana", "blueberry", "cherry"];
  const query = cell("");
  const filtered = derived(() =>
    items.filter(it => it.toLowerCase().includes(query.get().toLowerCase()))
  );

  document.getElementById("q").addEventListener("input", (e) => query.set(e.target.value));

  const list = document.getElementById("list");
  effect(() => {
    list.innerHTML = "";
    for (const it of filtered.get()) {
      const li = document.createElement("li");
      li.textContent = it;
      list.appendChild(li);
    }
  });
</script>
```

`filtered` is a `derived` — it re-runs only when `query` changes. The effect re-runs only when `filtered` changes. That's the whole reactivity story, no framework lifecycle needed.

---

## Bundle sizes

The CDN outputs (gzipped, approximate):

- `jslop-runtime.global.min.js` — IIFE, exposes `JSlop` — ~1 KB gzip
- `jslop-runtime.esm.min.js` — ESM, tree-shakeable — ~1 KB gzip

Both ship from `dist/` after `pnpm --filter @jslop/runtime run build`. The full toolchain (compiler, SSR, client boot) is **not** included.
