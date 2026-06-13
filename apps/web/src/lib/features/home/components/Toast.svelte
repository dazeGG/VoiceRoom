<script lang="ts">
  let { message } = $props<{ message: string }>();
</script>

{#if message}
  <div class="toast" data-visible="true" role="status" aria-live="polite">{message}</div>
{/if}
