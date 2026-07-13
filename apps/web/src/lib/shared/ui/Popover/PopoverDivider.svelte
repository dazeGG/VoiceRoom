<script lang="ts">
  import type { PopoverDividerProps } from './types';

  let { tight = false }: PopoverDividerProps = $props();
</script>

<div class="popover-divider" class:popover-divider--tight={tight} role="separator"></div>

<style>
  .popover-divider {
    height: 1px;
    margin: 2px 8px 6px;
    background: var(--control-line);
  }

  .popover-divider--tight {
    margin: 6px 8px;
  }
</style>
