<!--
  Mirror of jslop-app/src/RowsApp.jslop: same buttons, same row model,
  same keyed-each render. Svelte 5 runes mode so reactivity is comparable
  to JSlop's cell-based primitives.
-->
<script>
  let rows = $state([]);
  let selected = $state(-1);
  let nextId = 1;

  function buildBatch(count) {
    const A = ["pretty","large","big","small","tall","short","long","handsome","plain","quaint","clean","elegant","easy","angry","crazy","helpful","mushy","odd","unsightly","adorable","important","inexpensive","cheap","expensive","fancy"];
    const C = ["red","yellow","blue","green","pink","brown","purple","brown","white","black","orange"];
    const N = ["table","chair","house","bbq","desk","car","pony","cookie","sandwich","burger","pizza","mouse","keyboard"];
    const out = new Array(count);
    for (let i = 0; i < count; i++) {
      const a = A[(Math.random() * A.length) | 0];
      const c = C[(Math.random() * C.length) | 0];
      const n = N[(Math.random() * N.length) | 0];
      out[i] = { id: nextId++, label: `${a} ${c} ${n}` };
    }
    return out;
  }

  function create1k() { nextId = 1; selected = -1; rows = buildBatch(1000); }
  function create10k() { nextId = 1; selected = -1; rows = buildBatch(10000); }
  function append1k() { rows = [...rows, ...buildBatch(1000)]; }
  function update10() {
    const next = rows.slice();
    for (let i = 0; i < next.length; i += 10) {
      next[i] = { id: next[i].id, label: next[i].label + " !!!" };
    }
    rows = next;
  }
  function swap() {
    if (rows.length < 999) return;
    const next = rows.slice();
    const a = next[1]; next[1] = next[998]; next[998] = a;
    rows = next;
  }
  function clearRows() { selected = -1; rows = []; }
  function selectRow(id) { selected = id; }
  function removeRow(id) { rows = rows.filter(r => r.id !== id); }
</script>

<div>
  <div class="controls">
    <button id="run-create-1k" onclick={create1k}>create 1k</button>
    <button id="run-create-10k" onclick={create10k}>create 10k</button>
    <button id="run-append-1k" onclick={append1k}>append 1k</button>
    <button id="run-update-10" onclick={update10}>update 10th</button>
    <button id="run-swap" onclick={swap}>swap</button>
    <button id="run-clear" onclick={clearRows}>clear</button>
  </div>
  <div id="rows">
    {#each rows as row (row.id)}
      <div class={selected === row.id ? "row danger" : "row"}>
        <span class="col-id">{row.id}</span>
        <span class="col-label"><a onclick={() => selectRow(row.id)}>{row.label}</a></span>
        <span class="col-remove"><button onclick={() => removeRow(row.id)}>x</button></span>
      </div>
    {/each}
  </div>
</div>
