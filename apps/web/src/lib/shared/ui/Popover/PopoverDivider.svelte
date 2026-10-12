<script lang="ts">
  import type { PopoverDividerProps } from './types';

  let { tight = false }: PopoverDividerProps = $props();
</script>

<div class="popover-divider" class:popover-divider--tight={tight} role="separator"></div>

<style>
  .popover-divider {
    height: 1px;
    margin: 6px 8px;
    background: var(--vr-line);
  }

  .popover-divider--tight {
    margin: 3px 8px;
  }
</style>
