type Subscriber = {
  run: () => void;
  deps: Set<Cell<unknown>>;
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
  for (const child of [...scope.children]) disposeScope(child);
  scope.children.clear();
  const cleanups = scope.cleanups.splice(0);
  for (let i = cleanups.length - 1; i >= 0; i--) {
    try {
      cleanups[i]!();
    } catch (e) {
      console.error("[jslop] scope cleanup threw:", e);
    }
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
      if (currentSubscriber) {
        subscribers.add(currentSubscriber);
        currentSubscriber.deps.add(c as Cell<unknown>);
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

export function effect(fn: () => void | (() => void)): () => void {
  let cleanup: void | (() => void);
  // Snapshot the scope at creation time so re-runs (which may be triggered
  // from arbitrary other scopes via cell.set) still own their child scopes
  // under the correct parent.
  const ownerScope = currentScope;

  const sub: Subscriber = {
    deps: new Set(),
    run() {
      if (typeof cleanup === "function") cleanup();
      for (const dep of sub.deps) {
        const subs = (dep as unknown as { __subs: Set<Subscriber> }).__subs;
        subs.delete(sub);
      }
      sub.deps.clear();
      const prevSub = currentSubscriber;
      const prevScope = currentScope;
      currentSubscriber = sub;
      currentScope = ownerScope;
      try {
        cleanup = fn();
      } finally {
        currentSubscriber = prevSub;
        currentScope = prevScope;
      }
    },
  };

  sub.run();

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (typeof cleanup === "function") cleanup();
    for (const dep of sub.deps) {
      const subs = (dep as unknown as { __subs: Set<Subscriber> }).__subs;
      subs.delete(sub);
    }
    sub.deps.clear();
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

export function isReactive(v: unknown): v is Reactive<unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    "kind" in v &&
    ((v as { kind: string }).kind === "cell" ||
      (v as { kind: string }).kind === "derived")
  );
}
