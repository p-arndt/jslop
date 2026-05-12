<script>
  import Display from "./Display.svelte";
  import Stepper from "./Stepper.svelte";

  let count = $state(0);
  let showHelp = $state(false);
  let todos = $state(["learn rift", "build something"]);
  let draft = $state("");

  function increment() {
    count++;
  }

  function decrement() {
    count--;
  }

  function reset() {
    count = 0;
  }

  function toggleHelp() {
    showHelp = !showHelp;
  }

  function addTodo() {
    if (draft.trim().length > 0) {
      todos = [...todos, draft.trim()];
      draft = "";
    }
  }

  function clearTodos() {
    todos = [];
  }
</script>

<div>
  <h1>Rift Counter</h1>
  <Display value={count} label="Count" />
  <Stepper label="+" onstep={increment} />
  <Stepper label="-" onstep={decrement} />
  <Stepper label="reset" onstep={reset} />

  <button onclick={toggleHelp}>toggle help</button>

  {#if showHelp}
    <p><em>Click +/- to change the count. Reset returns it to 0.</em></p>
  {/if}

  {#if count > 0}
    <p>count is positive: {count}</p>
  {/if}

  <h2>Todos</h2>
  <input bind:value={draft} placeholder="add a todo..." />
  <button onclick={addTodo}>add</button>
  <button onclick={clearTodos}>clear</button>

  <ul>
    {#each todos as item, i}
      <li>{i}: {item}</li>
    {/each}
  </ul>
</div>
