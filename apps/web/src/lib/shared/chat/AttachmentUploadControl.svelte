<script lang="ts">
  import { Image, Plus } from '@lucide/svelte';
  import { Popover, PopoverMenuItem } from '$lib/shared/ui';
  import { iconSm } from '$lib/shared/ui/icons';
  import type { AttachmentComposeStore } from './attachment-compose.svelte';
  import './attachment.css';

  let {
    store,
    disabled = false,
    onerror
  }: {
    store: AttachmentComposeStore;
    disabled?: boolean;
    onerror?: (message: string) => void;
  } = $props();

  let input: HTMLInputElement | null = null;

  async function addSelectedFiles(close: (restoreFocus?: boolean) => void): Promise<void> {
    const files = input?.files;
    if (!files?.length) return;
    close(false);
    try {
      await store.addFiles(files);
    } catch (cause) {
      onerror?.(cause instanceof Error ? cause.message : 'Не удалось загрузить изображение');
    } finally {
      if (input) input.value = '';
    }
  }
</script>

<Popover
  placement="top-start"
  role="menu"
  ariaLabel="Добавить вложение"
  rootClass="attachment-upload-root"
  panelClass="attachment-upload-popover"
  keepContentMounted
>
  {#snippet trigger({ toggle, panelId, open })}
    <button
      class="attachment-add-button"
      type="button"
      aria-label="Добавить вложение"
      aria-haspopup="menu"
      aria-controls={panelId}
      aria-expanded={open}
      disabled={disabled || store.drafts.length >= 4}
      onclick={toggle}
    >
      <Plus {...iconSm} aria-hidden="true" />
    </button>
  {/snippet}
  {#snippet content({ close })}
    <input
      bind:this={input}
      class="attachment-file-input"
      type="file"
      accept="image/jpeg,image/png,image/webp"
      multiple
      tabindex="-1"
      aria-hidden="true"
      onchange={() => void addSelectedFiles(close)}
    />
    <PopoverMenuItem
      label="Загрузить фото"
      disabled={disabled || store.drafts.length >= 4}
      onclick={() => input?.click()}
    >
      {#snippet icon()}<Image {...iconSm} />{/snippet}
    </PopoverMenuItem>
  {/snippet}
</Popover>

<style>
  :global(.attachment-file-input) {
    position: fixed;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
  :global(.attachment-add-button) {
    display: grid;
    width: 32px;
    height: 32px;
    padding: 0;
    place-items: center;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--vr-text-2);
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      color 0.15s ease,
      background 0.15s ease;
  }
  :where(.attachment-add-button):hover,
  :where(.attachment-add-button)[aria-expanded='true'] {
    background: var(--vr-surface-3);
    color: var(--vr-text);
  }
  :where(.attachment-add-button):focus-visible {
    outline: 2px solid var(--focus-border, rgba(255, 255, 255, 0.72));
    outline-offset: 2px;
  }
  :where(.attachment-add-button):disabled {
    cursor: default;
    opacity: 0.42;
  }
</style>
