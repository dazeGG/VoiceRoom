<script lang="ts">
  import { Popover } from '../../../src/lib/shared/ui/Popover';
  import type { PopoverCloseReason } from '../../../src/lib/shared/ui/Popover/types';

  let { onBeforeClose }: { onBeforeClose?: (reason: PopoverCloseReason) => boolean | void } = $props();
</script>

<button type="button">Снаружи</button>
<Popover role="menu" ariaLabel="Меню" {onBeforeClose}>
  {#snippet trigger({ open, toggle, panelId })}
    <button type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={panelId} onclick={toggle}
      >Меню</button
    >
  {/snippet}
  {#snippet content({ close }: { close: (restoreFocus?: boolean) => void })}
    <button type="button" role="menuitem" onclick={() => close()}>Пункт</button>
  {/snippet}
</Popover>
