<script>
  let { label = "?", onstep = () => {} } = $props();
</script>

<button onclick={onstep}>{label}</button>
