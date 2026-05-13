Let’s call it **JSlop** for now.

Not “React but faster”. Not “Svelte but different syntax”. The core idea:

> **A framework where the default mental model is local, typed, resumable, file-native UI logic — without forcing everything into hooks, stores, loaders, server/client boundaries, or magical build conventions.**

## What sucks today

### React / Next.js

React’s biggest problem is not performance. It’s the **mental model tax**.

You constantly think about:

```ts
useEffect
useMemo
useCallback
server component?
client component?
action?
loader?
cache?
stale closure?
dependency array?
hydration?
```

React Server Components made this even more powerful but also more fragile. The RSC protocol even had a critical unauthenticated RCE vulnerability disclosed in late 2025, affecting React 19 and frameworks using it such as Next.js. ([react.dev][1])

So the problem is:

> React scales ecosystem-wise, but not conceptually.

### Vue

Vue is productive, but it has too many “almost JavaScript” concepts:

```ts
ref()
reactive()
computed()
watch()
defineProps()
defineEmits()
v-if
v-for
```

It is nice, but you are still learning a framework dialect.

### Svelte

Svelte feels great, but Svelte 5 moved into explicit runes:

```ts
let count = $state(0)
let doubled = $derived(count * 2)
$effect(() => ...)
```

That is powerful, but now Svelte also has its own reactivity language. Better than React hooks, but still framework-specific.

### Angular

Angular is enterprise-solid, but still feels like building software inside a corporate governance machine.

Too much ceremony. Too many official patterns. Too much architecture before you even have an app.

### Solid

Solid gets reactivity right technically. Fine-grained updates are excellent. But the JSX + signals model still feels like “React if React was actually reactive”.

Good engine. Less good product.

### Qwik

Qwik’s resumability idea is genuinely interesting. Avoiding hydration is one of the strongest framework ideas of the last few years. Many newer frameworks focus on fine-grained reactivity, resumability, and compile-time optimization to reduce client work. ([The Software House][2])

But Qwik has a big issue:

> It exposes too much of its cleverness to the developer.

When you start seeing `$`, lazy boundaries, serialization constraints, and resumability rules everywhere, the magic leaks.

### Astro

Astro is great for content-heavy sites and islands architecture. But for complex app UIs, it often becomes a composition layer over other frameworks.

Great shell. Not always enough app model.

---

# The new framework: JSlop

## Core philosophy

JSlop should be built around five principles:

### 1. No hydration by default

The server sends HTML plus a serialized interaction graph.

The browser does **not** rerun the whole app to become interactive.

Instead, each interactive region resumes from a tiny state capsule.

Like Qwik’s idea, but hidden behind a cleaner component model.

```tsx
<button on:click={increment}>
  Count: {count}
</button>
```

No `client:load`, no `use client`, no explicit lazy boundary unless you need one.

---

### 2. State is just variables

No hooks. No dependency arrays. No `ref.value`. No stores for local state.

```tsx
component Counter {
  let count = 0

  fn increment() {
    count++
  }

  view {
    <button on:click={increment}>
      {count}
    </button>
  }
}
```

The compiler turns mutable variables into fine-grained reactive cells.

The user writes normal-ish code.

The framework handles update tracking.

---

### 3. Server/client boundary is lexical, not file-based

Current frameworks make you think in files:

```tsx
"use client"
```

or separate loaders/actions/routes.

JSlop should make boundaries explicit inside the component:

```tsx
component ProductPage {
  server data = await db.products.find(id)

  client let selectedVariant = data.variants[0]

  server fn buy(variantId: string) {
    return checkout.createSession(variantId)
  }

  view {
    <ProductInfo data={data} />
    <VariantPicker bind:value={selectedVariant} />
    <button on:click={() => buy(selectedVariant.id)}>
      Buy
    </button>
  }
}
```

This gives you one component containing:

```txt
server data
client state
server actions
view
```

Instead of splitting logic across random files.

---

### 4. Progressive by default

A form should work without JavaScript unless you explicitly opt out.

```tsx
<form action={saveProfile}>
  <input name="displayName" value={user.displayName} />
  <button>Save</button>
</form>
```

With JavaScript:

```txt
optimistic update
inline validation
pending state
partial reload
```

Without JavaScript:

```txt
normal POST
redirect
server-rendered result
```

Same code path.

No “SPA version” and “server version”.

---

### 5. Routing should be boring

No magic route loaders. No nested routing insanity. No mental gymnastics.

```txt
src/
  routes/
    index.jslop
    blog/[slug].jslop
    dashboard/
      index.jslop
      settings.jslop
```

Inside a route:

```tsx
route "/blog/[slug]" {
  server data = await posts.bySlug(params.slug)

  meta {
    title: data.title
    description: data.excerpt
  }

  view {
    <Article post={data} />
  }
}
```

Simple file routing, but the data is colocated with the route component.

---

# The killer feature: UI as a resumable state graph

Most frameworks think in components.

JSlop thinks in **interaction cells**.

Example:

```tsx
component SearchBox {
  let query = ""
  server results = search(query).debounce(200)

  view {
    <input bind:value={query} />
    <For each={results}>
      {(item) => <SearchResult item={item} />}
    </For>
  }
}
```

Compiler sees:

```txt
query -> search(query) -> results -> DOM list
```

Then it generates:

```txt
initial HTML
serialized graph
minimal event handlers
server RPC endpoint if needed
DOM patch instructions
```

The browser does not hydrate the whole component tree.

It resumes the graph at the exact interactive nodes.

---

# Syntax sketch

Maybe `.jslop` files:

```tsx
component TodoApp {
  server todos = await db.todo.list()

  client let draft = ""

  server fn addTodo(text: string) {
    await db.todo.create({ text })
    invalidate(todos)
  }

  view {
    <main>
      <h1>Todos</h1>

      <form action={() => addTodo(draft)}>
        <input bind:value={draft} />
        <button disabled={draft.length === 0}>
          Add
        </button>
      </form>

      <ul>
        <For each={todos}>
          {(todo) => <li>{todo.text}</li>}
        </For>
      </ul>
    </main>
  }
}
```

No `useState`.

No `useEffect`.

No `loader`.

No `action`.

No `use client`.

No manually wiring fetch state.

---

# Data model

JSlop needs built-in async state primitives.

```tsx
server user = await auth.user()
server projects = await db.projects.forUser(user.id)
```

By default, server values are:

```ts
type ServerValue<T> = {
  value: T
  loading: boolean
  error: Error | null
  refresh(): Promise<void>
}
```

But templates unwrap automatically:

```tsx
<h1>Hello {user.name}</h1>
```

Manual control when needed:

```tsx
<Await value={projects}>
  <Pending>Loading...</Pending>
  <Error>{(err) => <ErrorBox error={err} />}</Error>
  <Resolved>{(projects) => <ProjectList projects={projects} />}</Resolved>
</Await>
```

---

# Effects should be rare

In React, effects are abused for everything.

JSlop should separate effects into clear categories:

```tsx
browser fn trackPageView() {
  analytics.page()
}

mount {
  trackPageView()
}
```

For reactive effects:

```tsx
when query changes {
  console.log("query changed", query)
}
```

For cleanup:

```tsx
mount {
  const socket = connect()
  cleanup socket.close()
}
```

No dependency arrays.

No “why did this run twice”.

No `useEffect(() => {}, [])`.

---

# Styling

Do not invent another styling religion.

Support:

```tsx
<style>
  .card {
    padding: 1rem;
  }
</style>
```

Scoped by default.

Also allow Tailwind/class utilities:

```tsx
<div class="rounded-2xl border p-4">
```

And typed variants:

```tsx
style Button {
  base: "rounded-xl px-4 py-2 font-medium"
  variants: {
    intent: {
      primary: "bg-primary text-primary-foreground"
      ghost: "hover:bg-muted"
    }
  }
}
```

Usage:

```tsx
<button class={Button({ intent: "primary" })}>
  Save
</button>
```

Basically built-in `class-variance-authority`, but first-class.

---

# Forms should be amazing

Forms are still garbage in most frameworks.

JSlop should have schema-native forms:

```tsx
schema ProfileForm {
  displayName: string.min(2)
  bio: string.max(300).optional()
}

component ProfileSettings {
  server user = await auth.user()

  server fn save(input: ProfileForm) {
    await db.user.update(user.id, input)
  }

  view {
    <Form schema={ProfileForm} action={save} initial={user}>
      <Field name="displayName" />
      <Field name="bio" as="textarea" />
      <Submit>Save</Submit>
    </Form>
  }
}
```

Built-in:

```txt
server validation
client validation
pending state
dirty state
error display
optimistic submit
accessibility
no-JS fallback
```

---

# Built-in backend contract

Instead of bolting tRPC, server actions, API routes, and fetch wrappers together:

```tsx
server fn renameProject(id: string, name: string) {
  requireUser()
  return db.project.update(id, { name })
}
```

Client calls it directly:

```tsx
<button on:click={() => renameProject(project.id, name)}>
  Rename
</button>
```

But compiled into:

```txt
typed RPC endpoint
CSRF protection
input validation
auth context
serialization boundary
rate-limit hook
audit hook
```

The important part:

> Server functions are not magic free-for-all functions. They are explicit framework capabilities with security defaults.

Given the RSC security mess, I would design this with an extremely boring protocol: JSON only, explicit action IDs, no executable payload deserialization, no arbitrary object revival.

---

# The framework stack

JSlop should be split like this:

```txt
@jslop/compiler
@jslop/runtime
@jslop/server
@jslop/router
@jslop/forms
@jslop/auth
@jslop/db
@jslop/testing
@jslop/devtools
```

But users install:

```bash
pnpm create jslop-app
```

And get:

```txt
SvelteKit-level simplicity
Solid-level reactivity
Qwik-level resumability
Next-level fullstack capability
Astro-level progressive rendering
but less conceptual bullshit
```

---

# The opinionated app structure

```txt
src/
  routes/
    index.jslop
    dashboard/
      index.jslop
      settings.jslop

  components/
    Button.jslop
    Modal.jslop
    DataTable.jslop

  server/
    db.ts
    auth.ts
    jobs.ts

  styles/
    app.css

  app.config.ts
```

No 17 special folders.

No `pages` vs `app`.

No hidden server-only conventions everywhere.

---

# Example full route

```tsx
route "/dashboard" {
  server user = await auth.requireUser()
  server projects = await db.project.findMany({
    where: { ownerId: user.id }
  })

  client let filter = ""

  derived visibleProjects = projects.filter(project =>
    project.name.toLowerCase().includes(filter.toLowerCase())
  )

  server fn createProject(name: string) {
    await db.project.create({
      name,
      ownerId: user.id
    })

    invalidate(projects)
  }

  view {
    <Page title="Dashboard">
      <div class="flex items-center justify-between">
        <h1>Projects</h1>
        <CreateProjectDialog on:create={createProject} />
      </div>

      <input
        placeholder="Search projects..."
        bind:value={filter}
      />

      <ProjectGrid projects={visibleProjects} />
    </Page>
  }
}
```

That is the target DX.

Readable. Local. Fullstack. Reactive. No hook soup.

---

# Differentiator: local-first optional mode

JSlop could have first-class local state persistence:

```tsx
local todos = collection<Todo>("todos")
```

Then:

```tsx
todos.insert({ text: draft })
```

This updates instantly in IndexedDB.

Server sync is optional:

```tsx
sync todos with server.todos {
  conflict: "server-wins"
}
```

This would make JSlop especially good for:

```txt
dashboards
internal tools
offline apps
AI tools
note apps
project management tools
mobile-ish web apps
```

Most frameworks still treat offline/local-first as an afterthought.

---

# Devtools idea

JSlop Devtools should not just show components.

It should show the **reactive graph**:

```txt
filter
  -> visibleProjects
    -> ProjectGrid
      -> ProjectCard[0]
      -> ProjectCard[1]

projects
  -> visibleProjects

createProject()
  -> invalidate(projects)
```

You could click a value and see:

```txt
where it came from
what it updates
server/client location
serialized size
last invalidation
render cost
```

That would be insanely useful.

---

# What JSlop should avoid

Very important: do **not** make another framework that becomes clever sludge.

Avoid:

```txt
magic global conventions
dependency arrays
manual hydration boundaries
stringly typed server actions
special file name explosion
custom async weirdness
global stores as default
over-abstracted routing
plugin ecosystem before core is good
```

The MVP should be brutally focused.

---

# MVP scope

Build only this first:

```txt
.jslop component compiler
fine-grained reactive local state
SSR
resumable event handlers
file-based routes
server functions
forms
dev server with HMR
adapter for Node
```

Do **not** build immediately:

```txt
native mobile
edge runtime
massive plugin system
complex animation system
ORM
auth
i18n
CMS stuff
```

---

# The actual pitch

> **JSlop is a fullstack TypeScript framework that compiles normal-looking component code into resumable, fine-grained, progressively enhanced web apps. It removes hydration, hooks, dependency arrays, client/server file splitting, and loader/action boilerplate.**

Or shorter:

> **Svelte-like authoring, Solid-like reactivity, Qwik-like resumability, Next-like fullstack — without the mental tax.**

---

# Why this could actually be interesting

The frontend world already knows the ingredients:

```txt
compiler-driven UI
fine-grained reactivity
server-first rendering
resumability
progressive enhancement
typed server actions
local-first data
```

But nobody has packaged them into something that feels truly clean.

The opportunity is not inventing one crazy new primitive.

The opportunity is:

> **Design the boring, obvious, ergonomic framework that should have existed after everyone learned from React, Svelte, Solid, Qwik, Astro, and Next.**

[1]: https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components?utm_source=chatgpt.com "Critical Security Vulnerability in React Server Components"
[2]: https://tsh.io/state-of-frontend?utm_source=chatgpt.com "State of Frontend 2024"
