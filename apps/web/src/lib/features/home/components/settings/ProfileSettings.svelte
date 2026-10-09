<script lang="ts">
  import EmojiText from '$lib/shared/chat/EmojiText.svelte';
  import { Pencil, X } from '@lucide/svelte';
  import type { AuthUser } from '$lib/api/auth';
  import { Avatar, AvatarCropDialog } from '$lib/shared/ui';
  import { iconSm } from '$lib/shared/ui/icons';
  import type { ProfileDraft } from '../../model/profile-draft.svelte';
  import type { ToastOptions } from '../../model/toasts.svelte';

  let {
    user,
    draft,
    onClose,
    onToast
  }: {
    user: AuthUser | null;
    /** Kept by the settings dialog, so the edits survive a look at another tab. */
    draft: ProfileDraft;
    onClose: () => void;
    onToast: (message: string, options?: ToastOptions) => void;
  } = $props();

  let avatarInput = $state<HTMLInputElement>();

  const label = $derived(user?.displayName?.trim() || user?.login || '');
  const avatarSrc = $derived(draft.shownAvatar(user));
  const avatarAction = $derived(user?.avatarUrl ? 'Изменить аватар' : 'Загрузить аватар');

  function onAvatarFile(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const selected = input.files?.[0] ?? null;
    input.value = '';
    if (!selected) return;
    const problem = draft.pickFile(selected);
    if (problem) onToast(problem);
  }

  async function save(): Promise<void> {
    try {
      if (await draft.save(user)) onToast('Изменения сохранены');
      onClose();
    } catch (error) {
      onToast(error instanceof Error && error.message ? error.message : 'Не удалось сохранить');
    }
  }
</script>

<div class="settings-profile-head">
  <div class="settings-avatar-control">
    <input
      bind:this={avatarInput}
      class="settings-avatar-input"
      type="file"
      accept="image/jpeg,image/png,image/webp"
      onchange={onAvatarFile}
    />
    <button
      type="button"
      class="settings-avatar-edit"
      onclick={() => avatarInput?.click()}
      aria-label={avatarAction}
      title={avatarAction}
    >
      <Avatar
        name={label}
        src={avatarSrc}
        colorKey={user?.avatarColorKey}
        background={user?.avatarAccent || undefined}
        size={56}
        class="settings-profile-avatar"
      />
      <span class="settings-avatar-overlay" aria-hidden="true">
        <Pencil {...iconSm} />
      </span>
    </button>
    {#if avatarSrc}
      <button
        type="button"
        class="settings-avatar-remove"
        onclick={draft.removeAvatar}
        aria-label="Удалить аватар"
        title="Удалить аватар"
      >
        <X {...iconSm} aria-hidden="true" />
      </button>
    {/if}
  </div>
  <div>
    <div class="settings-profile-name"><EmojiText text={label} /></div>
    <div class="settings-profile-sub">@{user?.login}</div>
  </div>
</div>

<div class="settings-fields">
  <label>
    <span class="settings-field-label">Имя</span>
    <input class="settings-input" bind:value={draft.name} maxlength="40" autocomplete="nickname" />
  </label>
</div>

<div class="settings-actions">
  <button class="settings-cancel" type="button" onclick={onClose} disabled={draft.saving}>Отмена</button>
  <button class="settings-save" type="button" onclick={save} disabled={draft.saving}>
    {#if draft.saving}<span class="home-spinner" aria-hidden="true"></span>{/if}
    Сохранить
  </button>
</div>

<AvatarCropDialog
  open={draft.cropOpen}
  file={draft.cropFile}
  name={label}
  shape="circle"
  kind="user"
  title="Аватар профиля"
  onClose={draft.cancelCrop}
  onSave={async (blob: Blob) => draft.setAvatar(blob)}
/>

<style>
  :global(.settings-profile-head) {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 28px;
  }
  :global(.settings-avatar-control) {
    position: relative;
    flex: none;
    width: 56px;
    height: 56px;
  }
  :global(.settings-profile-avatar) {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    font-size: 22px;
    font-weight: 700;
    color: #fff;
  }
  :global(.settings-profile-avatar img) {
    border-radius: inherit;
  }
  :global(.settings-avatar-input) {
    display: none;
  }
  :global(.settings-avatar-edit) {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: #fff;
    cursor: pointer;
    overflow: hidden;
  }
  :global(.settings-avatar-overlay) {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: inherit;
    background: color-mix(in srgb, var(--vr-bg) 58%, transparent);
    opacity: 0;
    transition: opacity 0.16s ease;
    pointer-events: none;
  }
  :where(.settings-avatar-edit):not(:disabled):hover .settings-avatar-overlay,
  :where(.settings-avatar-edit):not(:disabled):focus-visible .settings-avatar-overlay {
    opacity: 1;
  }
  :where(.settings-avatar-edit):focus-visible {
    outline: 2px solid var(--vr-danger);
    outline-offset: 3px;
  }
  :global(.settings-avatar-remove) {
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
    border: 2px solid var(--vr-bg);
    border-radius: 50%;
    background: var(--vr-danger);
    color: #fff;
    cursor: pointer;
    box-shadow: 0 2px 7px rgba(0, 0, 0, 0.34);
    opacity: 0;
    transition:
      opacity 0.16s ease,
      background 0.16s ease;
  }
  :where(.settings-avatar-control):hover .settings-avatar-remove,
  :where(.settings-avatar-control):focus-within .settings-avatar-remove {
    opacity: 1;
  }
  :where(.settings-avatar-remove):not(:disabled):hover {
    background: color-mix(in oklch, var(--vr-danger), var(--vr-bg) 16%);
  }
  :where(.settings-avatar-remove):focus-visible {
    outline: 2px solid #fff;
    outline-offset: 2px;
  }
  :where(.settings-avatar-edit):disabled,
  :where(.settings-avatar-remove):disabled {
    cursor: default;
    opacity: 0.6;
  }
  :global(.settings-profile-name) {
    color: var(--vr-text);
    font-size: 17px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  :global(.settings-profile-sub) {
    margin-top: 3px;
    color: var(--vr-text-3);
    font-family: var(--font-mono);
    font-size: 11.5px;
  }
  :global(.settings-fields) {
    display: flex;
    flex-direction: column;
    gap: 22px;
    width: 100%;
  }
</style>
