# Actions — server mutations from `.jslop`

An `action { ... }` block declares a server-side mutation handler inside a route file. The body lives **only on the server**: the compiler strips it from the client bundle and replaces every in-component reference with a thin stub that POSTs to the route URL. On success, the page's `load { ... }` re-runs automatically.

If you've written a JSlop app before action blocks landed, you probably had a `src/api.js` that called `fetch("/api/something")`, plus matching `/api/*` handlers in `serve.mjs` and a parallel dev-mode middleware in `vite.config.mjs`. Actions replace all three.

## At a glance

```tsx
component Inbox {
  prop tasks = []

  load {
    const { listTasks } = await import("../store.js")
    return { tasks: await listTasks() }
  }

  action create(input) {
    const { createTask } = await import("../store.js")
    return await createTask(input)
  }

  function submit(e) {
    e.preventDefault()
    create({ title: "buy milk", priority: "low" })
  }

  view {
    <form onsubmit={submit}>
      <button type="submit">add</button>
    </form>
  }
}
```

When the user submits the form:

1. The compiled stub `create(...)` POSTs to the route URL with header `x-jslop-action: create` and body `{"args": [{title, priority}]}`.
2. The framework matches the URL to this route, runs the `create` body with `(input, ctx)`, and returns `{ ok: true, result }`.
3. The client navigates to the same URL with `push: false` so the route's `load { ... }` re-runs and the new HTML swaps in. The user sees the new task.

No `/api/*` route, no client-side fetch wrapper, no manual refresh call.

## Syntax

```tsx
action name(params) {
  // any async JS — runs only on the server
}
```

- Lives alongside `load`, `function`, `state`, etc. — same component body, any order.
- `params` are positional. The client stub passes them through to the server verbatim.
- The body sees three magic locals: `params` (URL path params from the route pattern), `url` (the parsed request `URL`, including `searchParams`), and `request` (the raw Node `IncomingMessage`).
- Returns are serialized to JSON and surfaced to the caller as the resolved value of the stub. If the result isn't JSON-serializable, you'll get an error — keep return shapes plain.
- Multiple actions per component are fine. Names must be unique across **every component in the file** (they share a single dispatch namespace per route).

```tsx
component TaskDetail {
  prop task = null

  action save(patch) {
    const { updateTask } = await import("../store.js")
    return await updateTask(params.id, patch)
  }

  action remove() {
    const { deleteTask } = await import("../store.js")
    await deleteTask(params.id)
    redirect("/")            // see below
  }
}
```

## Redirecting away

After a delete, re-running the current route's `load { ... }` would 404. Throw `redirect(url)` from `@jslop/runtime` to navigate elsewhere instead:

```tsx
import { redirect } from "@jslop/runtime"

action remove() {
  const { deleteTask } = await import("../store.js")
  await deleteTask(params.id)
  redirect("/")
}
```

The server responds `{ ok: true, redirect: "/" }` and the client calls `navigate("/")`. This pushes a real history entry (the user can press back), unlike the silent same-URL refresh that follows a normal action.

## Where the body runs

Actions are **server only**. The compiler emits two different outputs for the same `.jslop` file:

- **SSR bundle:** the full action bodies, exported as `__actions = { name: async (…params, ctx) => { … } }`.
- **Client bundle:** thin stubs that call `globalThis.__jslop_callAction(name, args)`. No bodies, no imports the bodies needed (modulo tree-shaking).

This is wired by the Vite plugin via the `ssr` flag on `transform`. As an author you don't pass anything — referencing an action name from an event handler just works in both bundles.

In practice that means you can write code like this without leaking it to the browser:

```tsx
action createTask(input) {
  // node:* imports are fine here — the client never sees this body.
  const { writeFile } = await import("node:fs/promises")
  /* … */
}
```

## Auto-refresh and the response shape

After a successful action, the client does `navigate(currentPath, { push: false })`. The route's `load { ... }` re-runs server-side and the new HTML replaces the current page (the back-button history doesn't grow). For most CRUD flows this is what you want: mutate, then see fresh data.

The wire format is intentionally boring:

```text
POST /<current-route-url>
x-jslop-action: <name>
content-type: application/json

{"args": [...]}
```

Responses:

| Shape                              | Meaning                                                       |
|------------------------------------|---------------------------------------------------------------|
| `{ ok: true, result }`             | Success. `result` is returned by the stub; page auto-refreshes. |
| `{ ok: true, redirect: "/path" }`  | Action called `redirect(...)`. Client navigates there.        |
| `{ ok: false, error: "..." }`      | Action threw. Stub rejects its promise with the error.        |

If you need to inspect or write the request body yourself for an unusual case (e.g. file uploads), the underlying `request` is in `ctx.request`. Most apps shouldn't need it.

## Errors

Throwing from an action body returns `{ ok: false, error }`. The client stub rejects with `new Error("[jslop] action '<name>' failed: <error>")`. There's no built-in error boundary yet — wrap action calls in `try/catch` in your event handler (and don't rely on the auto-refresh having fired):

```tsx
function submit(e) {
  e.preventDefault()
  create({ title }).catch(err => {
    /* show a toast, set an error cell, etc. */
  })
}
```

## What this is *not* (yet)

- **Not optimistic.** Every action waits for the server round-trip, then waits for a second round-trip to fetch fresh HTML. Optimistic updates and fine-grained prop refresh (skipping the HTML re-fetch) are tracked on the [roadmap](./roadmap.md).
- **Not authenticated.** No `requireUser()`, no CSRF token, no rate limiting. Today the action body sees the raw `request`; do your own auth checks against `request.headers.cookie` (or similar) until the typed-RPC layer lands.
- **Not the full "server functions" feature from `PLAN.md`.** That envisions typed stubs generated from server bodies, transport-level allow-listing, and auth context plumbed by the framework. Actions are the boring stepping stone that ships today.

## See also

- [Routing — `load`](./routing.md#load-----running-code-before-render) — the read-side counterpart to actions.
- [Events](./events.md) — how to wire an action to a click or submit.
- [Building & deploying](./building.md) — `executeAction` lives in the SSR entry and is dispatched by `@jslop/node-adapter`.
- [Roadmap](./roadmap.md) — optimistic updates, typed RPC, auth context.
