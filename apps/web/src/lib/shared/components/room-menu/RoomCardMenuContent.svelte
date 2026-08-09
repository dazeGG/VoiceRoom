<script lang="ts">
  // Right-click menu for a room card in the lobby. Deliberately shorter than the
  // room-name menu: the actions here are about the room as an object you own —
  // invite, share, rename, delete — not about the session you are sitting in.
  import { Copy, Pencil, Trash2, UserRoundPlus } from '@lucide/svelte';
  import type { Friend } from '$lib/api/friends';
  import { deleteRoom, updateRoom } from '$lib/api/rooms';
  import { PopoverDivider, PopoverMenuItem, PopoverMenuLabel, PopoverSubmenu } from '$lib/shared/ui';
  import { iconMd } from '$lib/shared/ui/icons';
  import { copyText } from '$lib/shared/utils/clipboard';
  import RoomInviteFriendList from './RoomInviteFriendList.svelte';

  let {
    roomId,
    name,
    friends = [],
    presentUserIds = new Set<string>(),
    close,
    canClose,
    onRenamed,
    onDeleted,
    onToast
  }: {
    roomId: string;
    name: string;
    friends?: Friend[];
    presentUserIds?: Set<string>;
    close: (restoreFocus?: boolean) => void;
    canClose?: (roomId: string) => boolean;
    onRenamed?: () => void;
    onDeleted?: () => void;
    onToast?: (message: string) => void;
  } = $props();

  let renaming = $state(false);
  let renameDraft = $state('');
  let confirmingDelete = $state(false);
  let busy = $state(false);
  let renameInput = $state<HTMLInputElement | null>(null);

  // The menu can be reused for a different room while mounted; reset the
  // in-place editors so a pending rename never lands on the wrong room.
  $effect(() => {
    roomId;
    renaming = false;
    confirmingDelete = false;
  });

  // Guards every async result: the menu may have moved on to another room while
  // the request was in flight, and reporting into that context would be wrong.
  function stillCurrent(): boolean {
    return canClose?.(roomId) ?? true;
  }

  async function copyLink(): Promise<void> {
    const link = `${window.location.origin}/r/${encodeURIComponent(roomId)}`;
    try {
      await copyText(link);
      if (!stillCurrent()) return;
      onToast?.('Ссылка скопирована');
    } catch {
      if (!stillCurrent()) return;
      onToast?.('Не удалось скопировать');
    }
    if (stillCurrent()) close();
  }

  function startRename(): void {
    renameDraft = name;
    renaming = true;
    queueMicrotask(() => renameInput?.select());
  }

  async function submitRename(event: Event): Promise<void> {
    event.preventDefault();
    const nextName = renameDraft.trim();
    if (!nextName || nextName === name || busy) {
      renaming = false;
      return;
    }
    busy = true;
    try {
      await updateRoom(roomId, { name: nextName });
      if (!stillCurrent()) return;
      onToast?.('Комната переименована');
      onRenamed?.();
      close();
    } catch (error) {
      if (stillCurrent()) {
        onToast?.(error instanceof Error && error.message ? error.message : 'Не удалось переименовать');
      }
    } finally {
      busy = false;
      renaming = false;
    }
  }

  async function confirmDelete(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await deleteRoom(roomId);
      if (!stillCurrent()) return;
      onToast?.(`Комната «${name}» удалена`);
      onDeleted?.();
      close(false);
    } catch (error) {
      if (stillCurrent()) {
        onToast?.(error instanceof Error && error.message ? error.message : 'Не удалось удалить комнату');
      }
    } finally {
      busy = false;
      confirmingDelete = false;
    }
  }
</script>

<div class="room-card-menu" data-room-card-menu>
  <PopoverMenuLabel text="Комната" />

  <PopoverSubmenu label="Пригласить" ariaLabel={`Позвать друга в ${name}`}>
    {#snippet icon()}<UserRoundPlus {...iconMd} aria-hidden="true" />{/snippet}
    {#snippet content({ close: closeSubmenu })}
      <RoomInviteFriendList
        {friends}
        {roomId}
        {presentUserIds}
        {onToast}
        close={() => {
          closeSubmenu();
          close();
        }}
      />
    {/snippet}
  </PopoverSubmenu>

  <PopoverMenuItem label="Скопировать ссылку" onclick={() => void copyLink()}>
    {#snippet icon()}<Copy {...iconMd} aria-hidden="true" />{/snippet}
  </PopoverMenuItem>

  <PopoverDivider />

  {#if renaming}
    <form class="room-card-menu-rename" onsubmit={submitRename}>
      <label class="room-card-menu-rename-label" for="room-rename-{roomId}">Название комнаты</label>
      <input
        bind:this={renameInput}
        id="room-rename-{roomId}"
        class="room-card-menu-rename-input"
        bind:value={renameDraft}
        maxlength="60"
        disabled={busy}
        onkeydown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          renaming = false;
        }}
      />
      <div class="room-card-menu-rename-actions">
        <button type="button" class="room-card-menu-ghost" disabled={busy} onclick={() => (renaming = false)}>
          Отмена
        </button>
        <button type="submit" class="room-card-menu-primary" disabled={busy || !renameDraft.trim()}>
          Сохранить
        </button>
      </div>
    </form>
  {:else}
    <PopoverMenuItem label="Переименовать" disabled={busy} onclick={startRename}>
      {#snippet icon()}<Pencil {...iconMd} aria-hidden="true" />{/snippet}
    </PopoverMenuItem>
  {/if}

  <PopoverDivider />

  {#if confirmingDelete}
    <div class="room-card-menu-confirm">
      <p class="room-card-menu-confirm-text">Удалить «{name}» вместе с чатом?</p>
      <div class="room-card-menu-rename-actions">
        <button type="button" class="room-card-menu-ghost" disabled={busy} onclick={() => (confirmingDelete = false)}>
          Отмена
        </button>
        <button type="button" class="room-card-menu-danger" disabled={busy} onclick={() => void confirmDelete()}>
          Удалить
        </button>
      </div>
    </div>
  {:else}
    <PopoverMenuItem
      label="Удалить комнату"
      variant="danger"
      disabled={busy}
      onclick={() => (confirmingDelete = true)}
    >
      {#snippet icon()}<Trash2 {...iconMd} aria-hidden="true" />{/snippet}
    </PopoverMenuItem>
  {/if}
</div>

<style>
  .room-card-menu {
    display: flex;
    width: min(286px, calc(100vw - 28px));
    flex-direction: column;
    gap: 2px;
  }

  .room-card-menu-rename,
  .room-card-menu-confirm {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 6px 12px 10px;
  }

  .room-card-menu-rename-label {
    color: var(--warm-faint);
    font-family: var(--font-mono);
    font-size: 10.5px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .room-card-menu-rename-input {
    width: 100%;
    height: 38px;
    box-sizing: border-box;
    padding: 0 11px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 12px;
    background: color-mix(in oklch, var(--control), transparent 55%);
    color: var(--warm-ink);
    font-family: var(--font-ui);
    font-size: 14px;
  }

  .room-card-menu-rename-input:focus {
    border-color: color-mix(in oklch, var(--accent), transparent 40%);
    outline: none;
  }

  .room-card-menu-confirm-text {
    margin: 0;
    color: var(--warm-muted);
    font-size: 13.5px;
    line-height: 1.45;
  }

  .room-card-menu-rename-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .room-card-menu-ghost,
  .room-card-menu-primary,
  .room-card-menu-danger {
    height: 34px;
    padding: 0 13px;
    border: 0;
    border-radius: 11px;
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }

  .room-card-menu-ghost {
    background: transparent;
    color: var(--warm-muted);
  }

  .room-card-menu-primary {
    background: var(--accent);
    color: var(--accent-ink);
  }

  .room-card-menu-danger {
    background: var(--coral);
    color: #fff;
  }

  .room-card-menu-ghost:disabled,
  .room-card-menu-primary:disabled,
  .room-card-menu-danger:disabled {
    cursor: default;
    opacity: 0.6;
  }
</style>
