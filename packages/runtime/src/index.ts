type Subscriber = {
  run: () => void;
  // Ordered list of cells read during the last run. Re-runs walk this list
  // with `depsIdx`; positions that match are already-subscribed and skipped.
  // When a read diverges from the expected position we switch to building
  // `newDeps`, and after the run reconcile (unsubscribe deps that fell off).
  deps: Array<Cell<unknown>>;
  depsIdx: number;
  newDeps: Array<Cell<unknown>> | null;
};

let currentSubscriber: Subscriber | null = null;
let batchDepth = 0;
const pendingNotify = new Set<Cell<unknown>>();

export interface Scope {
  readonly cleanups: Array<() => void>;
  readonly children: Set<Scope>;
  parent: Scope | null;
  disposed: boolean;
}

let currentScope: Scope | null = null;

export function createScope(parent: Scope | null = currentScope): Scope {
  const scope: Scope = {
    cleanups: [],
    children: new Set(),
    parent,
    disposed: false,
  };
  if (parent) parent.children.add(scope);
  return scope;
}

export function getCurrentScope(): Scope | null {
  return currentScope;
}

export function runInScope<T>(scope: Scope, fn: () => T): T {
  const prev = currentScope;
  currentScope = scope;
  try {
    return fn();
  } finally {
    currentScope = prev;
  }
}

export function disposeScope(scope: Scope): void {
  if (scope.disposed) return;
  scope.disposed = true;
  // Skip the array copy when there are no children — typical for leaf scopes
  // (e.g. one per row in a list with thousands of entries). The copy used to
  // exist so reentrant disposeScope(child) wouldn't mutate-during-iteration,
  // but with size===0 there's nothing to copy.
  if (scope.children.size > 0) {
    for (const child of [...scope.children]) disposeScope(child);
    scope.children.clear();
  }
  const cleanups = scope.cleanups;
  if (cleanups.length > 0) {
    // Iterate in reverse and truncate after — equivalent to splice(0) but
    // without allocating the popped-array.
    for (let i = cleanups.length - 1; i >= 0; i--) {
      try {
        cleanups[i]!();
      } catch (e) {
        console.error("[jslop] scope cleanup threw:", e);
      }
    }
    cleanups.length = 0;
  }
  if (scope.parent) {
    scope.parent.children.delete(scope);
    scope.parent = null;
  }
}

export function onCleanup(fn: () => void): void {
  if (currentScope && !currentScope.disposed) currentScope.cleanups.push(fn);
}

export interface Cell<T> {
  readonly kind: "cell";
  get(): T;
  set(value: T): void;
  update(fn: (prev: T) => T): void;
  peek(): T;
}

export function cell<T>(initial: T): Cell<T> {
  let value = initial;
  const subscribers = new Set<Subscriber>();

  const c: Cell<T> = {
    kind: "cell",
    get() {
      const s = currentSubscriber;
      if (s !== null) {
        const cu = c as Cell<unknown>;
        if (s.newDeps !== null) {
          // Divergence already detected this run — append if not present.
          if (s.newDeps.indexOf(cu) === -1) {
            s.newDeps.push(cu);
            subscribers.add(s);
          }
        } else if (s.depsIdx < s.deps.length && s.deps[s.depsIdx] === cu) {
          // Matches expected position — already subscribed, just advance.
          s.depsIdx++;
        } else {
          // Divergence: fork into newDeps, copying the prefix we matched.
          const nd = s.deps.slice(0, s.depsIdx);
          if (nd.indexOf(cu) === -1) {
            nd.push(cu);
            subscribers.add(s);
          }
          s.newDeps = nd;
        }
      }
      return value;
    },
    peek() {
      return value;
    },
    set(next) {
      if (Object.is(value, next)) return;
      value = next;
      if (batchDepth > 0) {
        pendingNotify.add(c as Cell<unknown>);
        (c as unknown as { __subs: Set<Subscriber> }).__subs = subscribers;
      } else {
        for (const sub of [...subscribers]) sub.run();
      }
    },
    update(fn) {
      c.set(fn(value));
    },
  };
  (c as unknown as { __subs: Set<Subscriber> }).__subs = subscribers;
  return c;
}

function commitDeps(s: Subscriber): void {
  if (s.newDeps !== null) {
    // Some deps changed. Unsubscribe from old deps that aren't in newDeps.
    const oldDeps = s.deps;
    const newDeps = s.newDeps;
    for (let i = 0; i < oldDeps.length; i++) {
      const d = oldDeps[i]!;
      if (newDeps.indexOf(d) === -1) {
        const subs = (d as unknown as { __subs: Set<Subscriber> }).__subs;
        subs.delete(s);
      }
    }
    s.deps = newDeps;
    s.newDeps = null;
  } else if (s.depsIdx < s.deps.length) {
    // Some prior deps weren't touched this run — unsubscribe and truncate.
    for (let i = s.depsIdx; i < s.deps.length; i++) {
      const subs = (s.deps[i] as unknown as { __subs: Set<Subscriber> }).__subs;
      subs.delete(s);
    }
    s.deps.length = s.depsIdx;
  }
}

export function effect(fn: () => void | (() => void)): () => void {
  let cleanup: void | (() => void);
  // Snapshot the scope at creation time so re-runs (which may be triggered
  // from arbitrary other scopes via cell.set) still own their child scopes
  // under the correct parent.
  const ownerScope = currentScope;

  const sub: Subscriber = {
    deps: [],
    depsIdx: 0,
    newDeps: null,
    run() {
      if (typeof cleanup === "function") cleanup();
      sub.depsIdx = 0;
      sub.newDeps = null;
      const prevSub = currentSubscriber;
      const prevScope = currentScope;
      currentSubscriber = sub;
      currentScope = ownerScope;
      try {
        cleanup = fn();
      } finally {
        currentSubscriber = prevSub;
        currentScope = prevScope;
        commitDeps(sub);
      }
    },
  };

  sub.run();

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (typeof cleanup === "function") cleanup();
    for (let i = 0; i < sub.deps.length; i++) {
      const subs = (sub.deps[i] as unknown as { __subs: Set<Subscriber> }).__subs;
      subs.delete(sub);
    }
    sub.deps.length = 0;
  };
  if (currentScope && !currentScope.disposed) currentScope.cleanups.push(dispose);
  return dispose;
}

export interface Derived<T> {
  readonly kind: "derived";
  get(): T;
  peek(): T;
}

export function derived<T>(fn: () => T): Derived<T> {
  const inner = cell<T>(undefined as T);
  effect(() => {
    inner.set(fn());
  });
  return {
    kind: "derived",
    get: () => inner.get(),
    peek: () => inner.peek(),
  };
}

export function batch(fn: () => void): void {
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) {
      const cells = [...pendingNotify];
      pendingNotify.clear();
      const seen = new Set<Subscriber>();
      for (const c of cells) {
        const subs = (c as unknown as { __subs: Set<Subscriber> }).__subs;
        for (const s of subs) {
          if (!seen.has(s)) {
            seen.add(s);
            s.run();
          }
        }
      }
    }
  }
}

export function untrack<T>(fn: () => T): T {
  const prev = currentSubscriber;
  currentSubscriber = null;
  try {
    return fn();
  } finally {
    currentSubscriber = prev;
  }
}

export type Reactive<T> = Cell<T> | Derived<T>;

/* ------------------------------------------------------------------ *
 * Style registry — components with a `style { … }` block register their
 * scoped CSS here at module-evaluation time. Both SSR (which emits a
 * single <style> per unique component in the document head) and the
 * client (which injects them into <head> on hydration) read from here.
 * ------------------------------------------------------------------ */

interface RegisteredStyle {
  scope: string;
  css: string;
}
// Backed by globalThis so that the Vite dev server, which loads the runtime
// twice (once via Node for the plugin's `renderPage` import, once via Vite's
// SSR transform for route modules), still shares a single registry. Without
// this, `registerStyles` and `getRegisteredStyle` would write/read to two
// independent maps and component <style> tags would silently vanish from SSR.
const STYLE_REGISTRY_KEY = "__jslop_style_registry__";
const styleRegistry: Map<string, RegisteredStyle> =
  ((globalThis as Record<string, unknown>)[STYLE_REGISTRY_KEY] as Map<string, RegisteredStyle>) ??
  ((globalThis as Record<string, unknown>)[STYLE_REGISTRY_KEY] = new Map<string, RegisteredStyle>());

export function registerStyles(componentName: string, scope: string, css: string): void {
  styleRegistry.set(componentName, { scope, css });
}

export function getRegisteredStyle(componentName: string): RegisteredStyle | undefined {
  return styleRegistry.get(componentName);
}

/* ------------------------------------------------------------------ *
 * Route load() helpers — thrown by a route's `load { … }` block when
 * the requested resource doesn't exist. The server-side runner catches
 * this and renders the configured _404 page with a 404 status.
 * ------------------------------------------------------------------ */

export class NotFoundError extends Error {
  readonly __jslop_not_found = true;
  constructor(message = "not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export function notFound(message?: string): never {
  throw new NotFoundError(message);
}

export function isNotFoundError(err: unknown): err is NotFoundError {
  return (
    err instanceof NotFoundError ||
    (typeof err === "object" && err !== null && (err as { __jslop_not_found?: unknown }).__jslop_not_found === true)
  );
}

/* ------------------------------------------------------------------ *
 * Server-action helpers — actions can throw `redirect(url)` to signal
 * "navigate the client to a different URL instead of re-running this
 * route's load()". Used e.g. after a delete that would 404 the current
 * page. The framework's action dispatcher catches this and surfaces it
 * to the client stub, which calls `navigate(url, { push: true })`.
 * ------------------------------------------------------------------ */

export class RedirectError extends Error {
  readonly __jslop_redirect = true;
  readonly url: string;
  constructor(url: string) {
    super(`redirect to ${url}`);
    this.name = "RedirectError";
    this.url = url;
  }
}

export function redirect(url: string): never {
  throw new RedirectError(url);
}

export function isRedirectError(err: unknown): err is RedirectError {
  return (
    err instanceof RedirectError ||
    (typeof err === "object" && err !== null && (err as { __jslop_redirect?: unknown }).__jslop_redirect === true)
  );
}

export function isReactive(v: unknown): v is Reactive<unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    "kind" in v &&
    ((v as { kind: string }).kind === "cell" ||
      (v as { kind: string }).kind === "derived")
  );
}
