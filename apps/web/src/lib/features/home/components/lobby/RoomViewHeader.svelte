<script lang="ts">
  import type { OwnedRoom } from '$lib/api/auth';
  import Ellipsis from '$lib/shared/components/Ellipsis.svelte';
  import Popover from '$lib/shared/components/Popover.svelte';
  import PopoverDivider from '$lib/shared/components/PopoverDivider.svelte';
  import PopoverMenuItem from '$lib/shared/components/PopoverMenuItem.svelte';
  import { roomDisplayName, roomVisual } from '../../model/rooms';
  import { copyText } from '../../services/desktop-download';

  let { room, onBack, onToast } = $props<{
    room: OwnedRoom;
    onBack: () => void;
    onToast?: (message: string) => void;
  }>();

  const visual = $derived(roomVisual(room));
  const name = $derived(roomDisplayName(room));

  async function copyValue(value: string, message: string, close: () => void): Promise<void> {
    try {
      await copyText(value);
      onToast?.(message);
    } catch {
      onToast?.('Не удалось скопировать');
    }
    close();
  }
</script>

<div class="lobby-roomview-head">
  <button class="lobby-roomview-back" type="button" title="К списку комнат" aria-label="Назад" onclick={onBack}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
  </button>

  <Popover
    placement="bottom-start"
    role="menu"
    ariaLabel="Меню комнаты"
    panelClass="lobby-roomview-popover"
  >
    {#snippet trigger({ open, toggle, panelId })}
      <button
        class="lobby-roomview-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        onclick={toggle}
      >
        <span class="lobby-roomview-id-tile" style={`background:${visual.background};box-shadow:0 0 0 1px ${visual.ring}`}>{visual.emoji}</span>
        <span class="lobby-roomview-name">
          <Ellipsis text={name} title={room.roomId} />
        </span>
        <span class="lobby-roomview-chevron" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </span>
      </button>
    {/snippet}

    {#snippet content({ close })}
      <div class="lobby-roomview-popover-head">
        <span class="lobby-roomview-popover-badge" style={`background:${visual.background};box-shadow:0 0 0 1px ${visual.ring}`} aria-hidden="true">{visual.emoji}</span>
        <div class="lobby-roomview-popover-info">
          <Ellipsis class="lobby-roomview-popover-name" text={name} />
          <Ellipsis class="lobby-roomview-popover-code" text={room.roomId} />
        </div>
      </div>

      <PopoverDivider />

      <PopoverMenuItem label="Скопировать код" onclick={() => void copyValue(room.roomId, 'Код скопирован', close)}>
        {#snippet icon()}
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        {/snippet}
      </PopoverMenuItem>

      <PopoverMenuItem label="Скопировать ссылку" onclick={() => void copyValue(`${window.location.origin}/r/${encodeURIComponent(room.roomId)}`, 'Ссылка скопирована', close)}>
        {#snippet icon()}
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
        {/snippet}
      </PopoverMenuItem>
    {/snippet}
  </Popover>
</div>
