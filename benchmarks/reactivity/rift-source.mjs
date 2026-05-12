// Same scenarios as svelte-source.svelte.js, expressed against @rift/runtime
// primitives. Each function returns a small accumulator so dead-code-elim
// can't strip the work.
import { cell, effect, createScope, runInScope, disposeScope } from "@rift/runtime";

export function singleCellSingleEffect(iterations) {
  let total = 0;
  const scope = createScope(null);
  runInScope(scope, () => {
    const count = cell(0);
    effect(() => {
      total += count.get();
    });
    for (let i = 1; i <= iterations; i++) {
      count.set(i);
    }
  });
  disposeScope(scope);
  return total;
}

export function singleCellFanout(iterations, fanout) {
  let total = 0;
  const scope = createScope(null);
  runInScope(scope, () => {
    const count = cell(0);
    for (let f = 0; f < fanout; f++) {
      effect(() => {
        total += count.get();
      });
    }
    for (let i = 1; i <= iterations; i++) {
      count.set(i);
    }
  });
  disposeScope(scope);
  return total;
}

export function manyCellsOneReader(iterations, width) {
  let total = 0;
  const scope = createScope(null);
  runInScope(scope, () => {
    const cells = [];
    for (let i = 0; i < width; i++) cells.push(cell(0));
    effect(() => {
      let sum = 0;
      for (let i = 0; i < cells.length; i++) sum += cells[i].get();
      total += sum;
    });
    for (let i = 1; i <= iterations; i++) {
      cells[i % width].set(i);
    }
  });
  disposeScope(scope);
  return total;
}

export function createDispose(count) {
  let touched = 0;
  for (let i = 0; i < count; i++) {
    const scope = createScope(null);
    runInScope(scope, () => {
      const v = cell(0);
      effect(() => {
        touched += v.get();
      });
      v.set(1);
    });
    disposeScope(scope);
  }
  return touched;
}
