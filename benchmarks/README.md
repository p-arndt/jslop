# JSlop benchmarks

Compares JSlop to **Svelte 5** on two axes that matter for a UI framework:

1. **Bundle size** — what ships to the browser for a small interactive app.
2. **Reactivity throughput** — how fast the runtime propagates a `set` to its dependents.

> ⚠️ JSlop is pre-1.0 and the production build path isn't wired into `@jslop/vite`
> yet (see [`../TODO.md`](../TODO.md)). For an apples-to-apples bundle-size
> comparison, both fixtures are bundled with the same esbuild config + minifier
> instead of going through each framework's "official" build (which JSlop
> doesn't have). Numbers below are therefore "what would ship if JSlop's
> production build worked today," not "what ships from `vite build`."

## Run

```bash
pnpm --filter @jslop/benchmarks run bench           # both benches
pnpm --filter @jslop/benchmarks run bench:bundle    # bundle size only
pnpm --filter @jslop/benchmarks run bench:reactivity # reactivity only
```

Each sub-script also writes a machine-readable `results.json` next to itself.

---

## Bundle size

Both fixtures implement the same counter app: a `<Display>` subcomponent, three
`<Stepper>` subcomponents, two conditional blocks, an `{#each}` list with an
input and add/clear buttons. Built with **esbuild**, `minify: true`,
`target: es2020`, `format: esm`. Compression numbers are gzip level 9 and
brotli quality 11 — match what a sensible CDN serves.

Current measurement (on this machine, your mileage will vary by ~5%):

| Framework | Raw      | Gzip     | Brotli   | vs JSlop (gzip) |
| --------- | -------- | -------- | -------- | -------------- |
| JSlop      | 9.66 KiB | 3.09 KiB | 2.74 KiB | 1.00×          |
| Svelte 5  | 57.80 KiB | 21.66 KiB | 19.49 KiB | 7.00×          |

What's in each bundle:

- **JSlop**: `@jslop/runtime` (cell/derived/effect/scope), `@jslop/client` (boot +
  view tree walker + keyed reconciler), and three compiled `.jslop` modules.
- **Svelte 5**: the parts of `svelte/internal/client` that the three compiled
  `.svelte` components reference (reactivity, hydration, DOM ops, scheduler,
  prop handling, transitions).

> Caveat: Svelte 5's runtime has features JSlop doesn't have yet — transitions,
> snippets, bind directives beyond `value`, fine-grained DOM diff. Some of that
> doesn't tree-shake out of `svelte/internal/client` even when the components
> don't use it. As JSlop gains feature parity its size will grow; treat the
> current 7× gap as the *starting point*, not the steady-state.

---

## Reactivity throughput

Pure runtime microbenchmark: no DOM, just a `set` propagating to dependent
effects. Four scenarios, each runs three times and reports the median ops/sec
on a single core.

> ⚠️ Svelte 5 normally batches updates and flushes on a microtask. To make the
> two frameworks do the *same work per iteration*, the Svelte side calls
> `flushSync()` after every `set`. Real Svelte code benefits from batching;
> this bench measures raw propagation cost, not real-world update latency.

Current numbers:

| Scenario                       | JSlop ops/s | Svelte ops/s | JSlop / Svelte |
| ------------------------------ | ---------- | ------------ | ------------- |
| 1 cell × 1 effect, N sets      | 7.22M      | 536.2k       | 13.46×        |
| 1 cell × 100 effects, N sets   | 9.27M      | 9.91M        | 0.94×         |
| 100 cells × 1 reader, N sets   | 143.1k     | 354.3k       | 0.40×         |
| cell+effect+dispose, N cycles  | 833.2k     | 147.1k       | 5.66×         |

Reading the numbers:

- **Single-cell / single-effect**: JSlop's `cell.set` calls each subscriber's
  `run` synchronously with no scheduler in the loop, which is the cheapest
  possible path. Svelte's scheduler + `flushSync` round-trip adds per-set
  overhead that dominates when the work itself is trivial.
- **Fanout (1 cell, 100 readers)**: roughly even. Once the work per set
  outweighs the per-set scheduler cost, Svelte catches up.
- **Wide reader (100 cells, 1 effect summing all)**: Svelte wins ~2.5×.
  This is the dependency-tracking case, and Svelte's bookkeeping is more
  efficient than JSlop's `Set`-of-cells-per-effect.
- **Create + dispose churn**: JSlop wins because Svelte's `$effect.root` adds
  setup overhead per cycle that's heavier than `createScope` / `disposeScope`.

If you only remember one thing: JSlop is fast where it's simple and slower
where it's naive. The "wide reader" gap is the most interesting one to chase —
that's the realistic shape for large component trees.

---

## What's *not* benchmarked yet

These are obvious follow-ups, intentionally out of scope for this first pass:

- **First paint / hydration time** — requires a real production build for JSlop
  (blocked on the production build path landing).
- **Large-list reconciliation** — the JS Framework Benchmark "create 10k rows,
  swap, clear" matrix. Needs a DOM environment and a `<table>` fixture in both
  frameworks.
- **Memory** — peak RSS for the wide-reader scenario, would clarify the
  dependency-tracking gap above.
- **SSR throughput** — `@jslop/server` vs `svelte/server`.

If you want to add one, copy the structure of an existing scenario (a `*-source`
file per framework + a runner that calls both and prints a markdown table) and
wire it into `scripts/run-all.mjs`.
