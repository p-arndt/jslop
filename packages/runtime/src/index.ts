type Subscriber = {
  run: () => void;
  deps: Set<Cell<unknown>>;
};

let currentSubscriber: Subscriber | null = null;
let batchDepth = 0;
const pendingNotify = new Set<Cell<unknown>>();

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

  const sub: Subscriber = {
    deps: new Set(),
    run() {
      if (typeof cleanup === "function") cleanup();
      for (const dep of sub.deps) {
        const subs = (dep as unknown as { __subs: Set<Subscriber> }).__subs;
        subs.delete(sub);
      }
      sub.deps.clear();
      const prev = currentSubscriber;
      currentSubscriber = sub;
      try {
        cleanup = fn();
      } finally {
        currentSubscriber = prev;
      }
    },
  };

  sub.run();

  return () => {
    if (typeof cleanup === "function") cleanup();
    for (const dep of sub.deps) {
      const subs = (dep as unknown as { __subs: Set<Subscriber> }).__subs;
      subs.delete(sub);
    }
    sub.deps.clear();
  };
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
