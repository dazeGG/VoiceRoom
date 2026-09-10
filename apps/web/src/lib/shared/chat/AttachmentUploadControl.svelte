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
