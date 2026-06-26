<script lang="ts">
  import type { AuthUser } from '$lib/api/auth';
  import { updateDisplayName } from '$lib/api/auth';
  import { setUser } from '$lib/features/auth/session.svelte';
  import Popover from '$lib/shared/components/Popover.svelte';
  import PopoverDivider from '$lib/shared/components/PopoverDivider.svelte';
  import PopoverMenuItem from '$lib/shared/components/PopoverMenuItem.svelte';
  import { getAvatarColor } from '$lib/visual/tokens';

  let { user, loggingOut, onLogout, onOpenSettings, onToast } = $props<{
    user: AuthUser;
    loggingOut: boolean;
    onLogout: () => void;
    onOpenSettings: (tab: 'profile' | 'sound') => void;
    onToast: (message: string) => void;
  }>();

  let open = $state(false);
  let editing = $state(false);
  let nameDraft = $state('');
  let renaming = $state(false);
  let inputEl = $state<HTMLInputElement | null>(null);

  const label = $derived(user.displayName?.trim() || user.login);
  const avatar = $derived(getAvatarColor(user.avatarColorKey));
  const initials = $derived(
    label
      .split(/\s+/)
      .slice(0, 2)
      .map((part: string) => part.charAt(0))
      .join('')
      .toUpperCase() || label.charAt(0).toUpperCase()
  );
  const avatarStyle = $derived(
    `background:${avatar.background};color:${avatar.foreground};box-shadow:${avatar.shadow}`
  );

  $effect(() => {
    if (editing && inputEl) {
      inputEl.focus();
      inputEl.select();
    }
  });

  function closeMenu(): void {
    open = false;
    editing = false;
  }

  function openSettings(tab: 'profile' | 'sound'): void {
    closeMenu();
    onOpenSettings(tab);
  }

  function handleLogout(): void {
    closeMenu();
    onLogout();
  }

  function startEdit(): void {
    nameDraft = label;
    editing = true;
  }

  function cancelEdit(): void {
    editing = false;
  }

  async function submitEdit(): Promise<void> {
    if (renaming) return;
    const next = nameDraft.trim();
    if (!next) return;
    if (next === label) {
      closeMenu();
      return;
    }

    renaming = true;
    try {
      setUser(await updateDisplayName(next));
      onToast('Имя изменено');
      closeMenu();
    } catch (error) {
      onToast(error instanceof Error && error.message ? error.message : 'Не удалось изменить имя');
    } finally {
      renaming = false;
    }
  }

  function onEditKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submitEdit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelEdit();
    }
  }

  function onBeforeClose(reason: 'outside' | 'escape'): boolean | void {
    if (editing && reason === 'escape') return false;
    editing = false;
  }
</script>

<Popover
  bind:open
  placement="bottom-end"
  role="menu"
  ariaLabel="Меню профиля"
  rootClass="profile-menu"
  panelClass="profile-popover"
  {onBeforeClose}
>
  {#snippet trigger({ open: isOpen, toggle, panelId })}
    <button
      class="profile-trigger"
      type="button"
      aria-haspopup="menu"
      aria-expanded={isOpen}
      aria-controls={panelId}
      onclick={toggle}
    >
      <span class="profile-avatar" style={avatarStyle} aria-hidden="true">{initials}</span>
      <span class="profile-trigger-name" title={`@${user.login}`}>{label}</span>
      <span class="profile-trigger-chevron" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
      </span>
    </button>
  {/snippet}

  {#snippet content()}
    {#if editing}
      <div class="profile-edit">
        <div class="profile-edit-head">
          <button class="profile-edit-back" type="button" aria-label="Назад" onclick={cancelEdit}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <span class="profile-edit-title">Изменить имя</span>
        </div>
        <input
          class="profile-edit-input"
          bind:this={inputEl}
          bind:value={nameDraft}
          maxlength="40"
          autocomplete="nickname"
          placeholder={user.login}
          onkeydown={onEditKeydown}
        />
        <div class="profile-edit-actions">
          <button class="profile-edit-cancel" type="button" onclick={cancelEdit}>Отмена</button>
          <button class="profile-edit-save" type="button" onclick={submitEdit} disabled={renaming || !nameDraft.trim()}>
            {#if renaming}<span class="home-spinner" aria-hidden="true"></span>{/if}
            Сохранить
          </button>
        </div>
      </div>
    {:else}
      <div class="profile-popover-head">
        <span class="profile-popover-avatar" style={avatarStyle} aria-hidden="true">{initials}</span>
        <div class="profile-popover-name" title={`@${user.login}`}>{label}</div>
      </div>

      <PopoverDivider />

      <PopoverMenuItem label="Изменить имя" onclick={startEdit}>
        {#snippet icon()}
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
        {/snippet}
      </PopoverMenuItem>

      <PopoverMenuItem label="Настройки" showChevron onclick={() => openSettings('profile')}>
        {#snippet icon()}
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"></path></svg>
        {/snippet}
      </PopoverMenuItem>

      <PopoverDivider tight />

      <PopoverMenuItem
        label="Выйти"
        variant="danger"
        disabled={loggingOut}
        onclick={handleLogout}
      >
        {#snippet icon()}
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
        {/snippet}
      </PopoverMenuItem>
    {/if}
  {/snippet}
</Popover>