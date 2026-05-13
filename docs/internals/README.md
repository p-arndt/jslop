# Internals

This folder is for **contributors and the curious** — people who want to understand how Rift works under the hood. You do not need any of this to ship Rift apps.

If you're here to build something with Rift, head back to the [user guide](../README.md).

## Contents

- **[Architecture](./architecture.md)** — what each `@rift/*` package does, how a request flows end-to-end in dev and in production, and what we deliberately don't ship.

## Related (in the repo root, not in this folder)

- **[`PLAN.md`](../../PLAN.md)** — the design vision: what Rift is aiming to be, why, and the protocol commitments behind it.
- **[`TODO.md`](../../TODO.md)** — the honest punch list: what works, what's flaky, what's missing.

## Where things live in source

| Concern                          | Package                                |
|----------------------------------|----------------------------------------|
| Reactive primitives              | `packages/runtime/`                    |
| `.rift` → JS compiler            | `packages/compiler/`                   |
| File-system route scanning       | `packages/router/`                     |
| SSR (HTML + state capsule)       | `packages/server/`                     |
| Browser boot / resume            | `packages/client/`                     |
| Vite plugin / dev SSR / build    | `packages/vite/`                       |
| Production Node HTTP wrapper     | `packages/node-adapter/`               |
| VS Code grammar + snippets       | `editors/vscode-rift/`                 |
| Example apps                     | `examples/counter/`, `examples/site/`  |
