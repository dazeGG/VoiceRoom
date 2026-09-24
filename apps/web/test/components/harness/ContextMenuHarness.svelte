<script lang="ts">
  import { ContextMenu } from '../../../src/lib/shared/ui';

  let { x = 20, y = 20, restoreFocus = null, onClose }: {
    x?: number;
    y?: number;
    restoreFocus?: HTMLElement | null;
    onClose: () => void;
  } = $props();
  let open = $state(true);
</script>

<button type="button">Снаружи</button>
<ContextMenu {open} {x} {y} ariaLabel="Действия с комнатой" {restoreFocus} onClose={() => { open = false; onClose(); }}>
  {#snippet content({ close }: { close: (restoreFocus?: boolean) => void })}
    <button type="button" role="menuitem" onclick={() => close()}>Открыть</button>
    <button type="button" role="menuitem" disabled>Недоступно</button>
    <button type="button" role="menuitem">Удалить из списка</button>
  {/snippet}
</ContextMenu>
