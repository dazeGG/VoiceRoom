<script lang="ts">
  let { message } = $props<{ message: string }>();
</script>

{#if message}
  <div class="toast is-visible" role="status" aria-live="polite">{message}</div>
{/if}
