<script lang="ts">
  let { tight = false }: { tight?: boolean } = $props();
</script>

<div class="popover-divider" class:popover-divider--tight={tight} role="separator"></div>