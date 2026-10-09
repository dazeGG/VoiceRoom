<script lang="ts">
  // The room avatar in room settings: the avatar opens a file picker and a crop
  // dialog, a corner button removes it, and nothing reaches the server until the
  // settings are saved. Mount it per opening (and per room) to start from what
  // is saved.
  import { onDestroy } from 'svelte';
  import { Camera, X } from '@lucide/svelte';
  import { Avatar, AvatarCropDialog } from '$lib/shared/ui';
  import { iconSm } from '$lib/shared/ui/icons';
  import type { RoomAvatarChange } from '../room-avatar-change';

  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

  let {
    savedUrl,
    name,
    disabled = false,
    change = $bindable({ kind: 'keep' }),
    cropping = $bindable(false),
    onError
  }: {
    /** The room's saved avatar, or null. */
    savedUrl: string | null;
    /** Shown as initials without an avatar and named in the crop dialog. */
    name: string;
    disabled?: boolean;
    change?: RoomAvatarChange;
    /** The crop dialog is up: it owns Escape and focus until it closes. */
    cropping?: boolean;
    onError: (message: string) => void;
  } = $props();

  let input = $state<HTMLInputElement>();
  let file = $state<File | null>(null);
  let previewUrl = $state('');

  const shownUrl = $derived(change.kind === 'upload' ? previewUrl : change.kind === 'remove' ? null : savedUrl);
  const editLabel = $derived(shownUrl ? 'Изменить аватар комнаты' : 'Загрузить аватар комнаты');

  onDestroy(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  });

  function pick(event: Event): void {
    const target = event.currentTarget as HTMLInputElement;
    const selected = target.files?.[0] ?? null;
    target.value = '';
    if (!selected) return;
    if (!selected.type.startsWith('image/')) {
      onError('Выберите изображение JPEG, PNG или WebP');
      return;
    }
    if (selected.size > MAX_IMAGE_BYTES) {
      onError('Изображение должно быть меньше 5 МБ');
      return;
    }
    file = selected;
    cropping = true;
  }

  async function cropped(image: Blob): Promise<void> {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(image);
    change = { kind: 'upload', image };
    cropping = false;
    file = null;
  }

  function remove(): void {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    change = { kind: 'remove' };
  }
</script>

<div class="room-avatar-control">
  <input
    bind:this={input}
    class="room-avatar-input"
    type="file"
    accept="image/jpeg,image/png,image/webp"
    onchange={pick}
  />
  <button
    class="room-avatar-edit"
    type="button"
    onclick={() => input?.click()}
    {disabled}
    aria-label={editLabel}
    title={editLabel}
  >
    <Avatar {name} src={shownUrl} shape="squircle" background="var(--vr-surface-3)" size={76} />
  </button>
  <span class="room-avatar-camera" aria-hidden="true"><Camera {...iconSm} /></span>
  {#if shownUrl}
    <button
      class="room-avatar-remove"
      type="button"
      onclick={remove}
      {disabled}
      aria-label="Удалить аватар комнаты"
      title="Удалить аватар комнаты"><X {...iconSm} aria-hidden="true" /></button
    >
  {/if}
</div>

<AvatarCropDialog
  open={cropping}
  {file}
  {name}
  shape="squircle"
  kind="room"
  title="Аватар комнаты"
  onClose={() => {
    cropping = false;
    file = null;
  }}
  onSave={cropped}
/>

<style>
  .room-avatar-control {
    position: relative;
    flex: none;
    width: 76px;
    height: 76px;
  }
  .room-avatar-input {
    display: none;
  }
  .room-avatar-edit {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 76px;
    height: 76px;
    padding: 0;
    overflow: hidden;
    border: 0;
    border-radius: 31%;
    background: transparent;
    color: var(--vr-text);
    cursor: pointer;
  }
  .room-avatar-camera {
    position: absolute;
    right: -4px;
    bottom: -4px;
    display: grid;
    width: 26px;
    height: 26px;
    place-items: center;
    border: 2px solid var(--vr-surface);
    border-radius: 50%;
    background: var(--vr-accent);
    color: var(--vr-accent-ink);
    pointer-events: none;
  }
  .room-avatar-edit:focus-visible {
    outline: 2px solid var(--vr-accent);
    outline-offset: 3px;
  }
  .room-avatar-remove {
    position: absolute;
    z-index: 1;
    top: -5px;
    right: -5px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 2px solid var(--vr-surface);
    border-radius: 50%;
    background: var(--vr-danger);
    color: var(--vr-on-danger);
    cursor: pointer;
    opacity: 0;
    transition:
      opacity 0.16s ease,
      background 0.16s ease;
  }
  .room-avatar-control:hover .room-avatar-remove,
  .room-avatar-control:focus-within .room-avatar-remove {
    opacity: 1;
  }
  .room-avatar-remove:not(:disabled):hover {
    background: color-mix(in oklch, var(--vr-danger), var(--vr-on-danger) 12%);
  }
  .room-avatar-remove:focus-visible {
    outline: 2px solid var(--vr-text);
    outline-offset: 2px;
  }
  .room-avatar-edit:disabled,
  .room-avatar-remove:disabled {
    cursor: default;
    opacity: 0.6;
  }
</style>
