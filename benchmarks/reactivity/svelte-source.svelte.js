// Compiled by `svelte/compiler` and re-bundled with esbuild so we can drive
// Svelte 5 runes from a plain Node process. The exported functions create a
// $effect.root scope, run the bench, and tear it down.
import { flushSync } from "svelte";

export function singleCellSingleEffect(iterations) {
  let total = 0;
  const dispose = $effect.root(() => {
    let count = $state(0);
    $effect(() => {
      total += count;
    });
    flushSync();
    for (let i = 1; i <= iterations; i++) {
      count = i;
      flushSync();
    }
  });
  dispose();
  return total;
}

export function singleCellFanout(iterations, fanout) {
  let total = 0;
  const dispose = $effect.root(() => {
    let count = $state(0);
    for (let f = 0; f < fanout; f++) {
      $effect(() => {
        total += count;
      });
    }
    flushSync();
    for (let i = 1; i <= iterations; i++) {
      count = i;
      flushSync();
    }
  });
  dispose();
  return total;
}

export function manyCellsOneReader(iterations, width) {
  let total = 0;
  const dispose = $effect.root(() => {
    const cells = [];
    for (let i = 0; i < width; i++) {
      let v = $state(0);
      cells.push({
        get() {
          return v;
        },
        set(n) {
          v = n;
        },
      });
    }
    $effect(() => {
      let sum = 0;
      for (let i = 0; i < cells.length; i++) sum += cells[i].get();
      total += sum;
    });
    flushSync();
    for (let i = 1; i <= iterations; i++) {
      cells[i % width].set(i);
      flushSync();
    }
  });
  dispose();
  return total;
}

export function createDispose(count) {
  let touched = 0;
  for (let i = 0; i < count; i++) {
    const dispose = $effect.root(() => {
      let v = $state(0);
      $effect(() => {
        touched += v;
      });
      flushSync();
      v = 1;
      flushSync();
    });
    dispose();
  }
  return touched;
}
