<script lang="ts">
  // Right-click menu shared by the room chat and DMs. Quick reactions sit at the
  // top so the most common action needs no submenu; everything else is a normal
  // menu row. Which rows appear is decided by the caller through the flags.
  import { Copy, Download, Flag, ImageIcon, Pencil, Pin, PinOff, Reply, SmilePlus, Trash2 } from '@lucide/svelte';
  import { ContextMenu, PopoverDivider, PopoverMenuItem, type ContextMenuContentState } from '$lib/shared/ui';
  import { iconMd } from '$lib/shared/ui/icons';
  import Emoji from './Emoji.svelte';

  let {
    open,
    x,
    y,
    quickReactions = [],
    activeReactions = [],
    canReact = false,
    canPin = false,
    pinned = false,
    canEdit = false,
    canDelete = false,
    busy = false,
    onClose,
    onReact,
    onOpenReactionPicker,
    onReply,
    onCopy,
    onCopyImage,
    onDownloadImage,
    onTogglePin,
    onEdit,
    onDelete,
    onReport
  }: {
    open: boolean;
    /** The picture the menu was opened on; its rows appear only when given. */
    onCopyImage?: (() => void) | undefined;
    onDownloadImage?: (() => void) | undefined;
    x: number;
    y: number;
    quickReactions?: readonly string[] | undefined;
    /** The emoji the viewer has already put on the message. */
    activeReactions?: readonly string[] | undefined;
    canReact?: boolean | undefined;
    canPin?: boolean | undefined;
    pinned?: boolean | undefined;
    canEdit?: boolean | undefined;
    canDelete?: boolean | undefined;
    busy?: boolean | undefined;
    onClose: () => void;
    onReact?: ((emoji: string) => void) | undefined;
    onOpenReactionPicker?: ((anchor: EventTarget | null) => void) | undefined;
    onReply?: (() => void) | undefined;
    onCopy?: (() => void) | undefined;
    onTogglePin?: (() => void) | undefined;
    onEdit?: (() => void) | undefined;
    onDelete?: (() => void) | undefined;
    /** Reporting to the service operator; the row appears only when given. */
    onReport?: (() => void) | undefined;
  } = $props();

  function pick(action: (() => void) | undefined, close: () => void): void {
    try {
      action?.();
    } finally {
      close();
    }
  }

  function handleShortcut(event: KeyboardEvent): void {
    if (!open || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')
    )
      return;
    if (event.key.toLowerCase() === 'e' && canEdit && onEdit) {
      event.preventDefault();
      event.stopPropagation();
      onEdit();
      onClose();
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && canDelete && onDelete) {
      event.preventDefault();
      event.stopPropagation();
      onDelete();
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleShortcut} />

<ContextMenu {open} {x} {y} ariaLabel="Действия с сообщением" {onClose}>
  {#snippet content({ close }: ContextMenuContentState)}
    <div class="message-menu">
      {#if canReact && quickReactions.length > 0}
        <div class="message-menu-reactions" role="group" aria-label="Быстрые реакции">
          {#each quickReactions as emoji (emoji)}
            <button
              class="message-menu-reaction"
              class:is-active={activeReactions.includes(emoji)}
              type="button"
              role="menuitem"
              disabled={busy}
              aria-label={`Реакция ${emoji}`}
              title={`Реакция ${emoji}`}
              onclick={() => {
                onReact?.(emoji);
                close();
              }}><Emoji {emoji} size={20} decorative /></button
            >
          {/each}
          <button
            class="message-menu-reaction message-menu-reaction--more"
            type="button"
            role="menuitem"
            disabled={busy}
            aria-label="Поставить реакцию"
            title="Поставить реакцию"
            onclick={(event) => {
              const anchor = event.currentTarget;
              onOpenReactionPicker?.(anchor);
              close();
            }}><SmilePlus {...iconMd} aria-hidden="true" /></button
          >
        </div>

        <PopoverDivider />
      {/if}

      {#if onReply}
        <PopoverMenuItem label="Ответить" disabled={busy} onclick={() => pick(onReply, close)}>
          {#snippet icon()}<Reply {...iconMd} aria-hidden="true" />{/snippet}
        </PopoverMenuItem>
      {/if}

      <PopoverMenuItem label="Скопировать текст" disabled={busy} onclick={() => pick(onCopy, close)}>
        {#snippet icon()}<Copy {...iconMd} aria-hidden="true" />{/snippet}
      </PopoverMenuItem>

      {#if onCopyImage}
        <PopoverMenuItem label="Скопировать изображение" disabled={busy} onclick={() => pick(onCopyImage, close)}>
          {#snippet icon()}<ImageIcon {...iconMd} aria-hidden="true" />{/snippet}
        </PopoverMenuItem>
      {/if}

      {#if onDownloadImage}
        <PopoverMenuItem label="Скачать изображение" disabled={busy} onclick={() => pick(onDownloadImage, close)}>
          {#snippet icon()}<Download {...iconMd} aria-hidden="true" />{/snippet}
        </PopoverMenuItem>
      {/if}

      {#if canPin || canEdit}
        <PopoverDivider />
      {/if}

      {#if canPin}
        <PopoverMenuItem
          label={pinned ? 'Открепить' : 'Закрепить в комнате'}
          disabled={busy}
          onclick={() => pick(onTogglePin, close)}
        >
          {#snippet icon()}
            {#if pinned}<PinOff {...iconMd} aria-hidden="true" />{:else}<Pin {...iconMd} aria-hidden="true" />{/if}
          {/snippet}
        </PopoverMenuItem>
      {/if}

      {#if canEdit}
        <PopoverMenuItem label="Изменить" hint="E" disabled={busy} onclick={() => pick(onEdit, close)}>
          {#snippet icon()}<Pencil {...iconMd} aria-hidden="true" />{/snippet}
        </PopoverMenuItem>
      {/if}

      <!-- Moderation: reporting and deleting sit together, both in red. -->
      {#if onReport || canDelete}
        <PopoverDivider />
      {/if}

      {#if onReport}
        <PopoverMenuItem
          label="Пожаловаться"
          variant="danger"
          disabled={busy}
          onclick={() => {
            onReport();
            close();
          }}
        >
          {#snippet icon()}<Flag {...iconMd} aria-hidden="true" />{/snippet}
        </PopoverMenuItem>
      {/if}

      {#if canDelete}
        <PopoverMenuItem
          label="Удалить"
          hint="⌫"
          variant="danger"
          disabled={busy}
          onclick={() => pick(onDelete, close)}
        >
          {#snippet icon()}<Trash2 {...iconMd} aria-hidden="true" />{/snippet}
        </PopoverMenuItem>
      {/if}
    </div>
  {/snippet}
</ContextMenu>

<style>
  .message-menu {
    display: flex;
    width: min(288px, calc(100vw - 28px));
    flex-direction: column;
    gap: 2px;
  }

  .message-menu-reactions {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 2px 4px;
  }

  .message-menu-reaction {
    display: grid;
    width: 40px;
    height: 40px;
    place-items: center;
    border: 0;
    border-radius: 14px;
    background: color-mix(in oklch, var(--vr-surface-3), transparent 55%);
    color: var(--vr-text-2);
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    transition:
      background 0.14s ease,
      color 0.14s ease;
  }

  .message-menu-reaction:hover:not(:disabled),
  .message-menu-reaction:focus-visible:not(:disabled),
  .message-menu-reaction.is-active {
    background: color-mix(in oklch, var(--vr-accent), transparent 86%);
    color: var(--vr-text);
  }

  .message-menu-reaction:disabled {
    cursor: default;
    opacity: 0.55;
  }
</style>
