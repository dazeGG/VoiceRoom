<script lang="ts">
  // The open settings. Mounted fresh on every opening, so each tab starts from
  // what is saved; only the profile edits live here, so they survive a look at
  // another tab before saving.
  import { Bell, Keyboard, LogOut, Mic, Monitor, ShieldCheck, User, X } from '@lucide/svelte';
  import { onDestroy, onMount, untrack } from 'svelte';
  import type { AuthUser, OwnedRoom } from '$lib/api/auth';
  import type { PublicUser } from '$lib/api/friends';
  import { iconMd, iconSm } from '$lib/shared/ui/icons';
  import { dialogFocusTrap } from '$lib/shared/ui/focus-trap';
  import { syncNotificationPermission } from '$lib/shared/notifications/preferences.svelte';
  import { ProfileDraft } from '../../model/profile-draft.svelte';
  import { syncPushNotificationState } from '../../model/push-notifications.svelte';
  import { readSettingsSupport } from '../../model/settings-support';
  import type { ToastOptions } from '../../model/toasts.svelte';
  import AccountSecuritySettings from '../AccountSecuritySettings.svelte';
  import AppSettings from './AppSettings.svelte';
  import HotkeySettings from './HotkeySettings.svelte';
  import NotificationSettings from './NotificationSettings.svelte';
  import ProfileSettings from './ProfileSettings.svelte';
  import SoundSettings from './SoundSettings.svelte';
  import type { SettingsTab } from './types';

  let {
    tab = $bindable('profile'),
    user,
    notificationUsers,
    notificationRooms,
    loggingOut,
    securityHighlight,
    onClose,
    onToast,
    onLogout
  }: {
    tab: SettingsTab;
    user: AuthUser | null;
    notificationUsers: PublicUser[];
    notificationRooms: OwnedRoom[];
    loggingOut: boolean;
    securityHighlight: 'recovery-codes' | 'password' | null;
    onClose: () => void;
    onToast: (message: string, options?: ToastOptions) => void;
    onLogout: () => void;
  } = $props();

  const support = readSettingsSupport();
  const appTab = support.desktopApp && (support.autostart || support.overlay);
  // The dialog remounts for another account, so the first user is the one.
  const profile = new ProfileDraft(untrack(() => user));
  // A dialog opened from the security tab owns focus and Escape while it is up.
  let securityDialogOpen = $state(false);
  const nestedDialogOpen = $derived(profile.cropOpen || securityDialogOpen);

  onMount(() => {
    syncNotificationPermission();
    void syncPushNotificationState(user?.id ?? null);
  });
  onDestroy(profile.dispose);

  function onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) onClose();
  }

  function onKeydown(event: KeyboardEvent): void {
    if ((event.target as HTMLElement | null)?.closest?.('[data-hotkey-recorder-recording="true"]')) return;
    if (!nestedDialogOpen && event.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet navItem(id: SettingsTab, label: string, Icon: typeof User)}
  <button
    class="settings-nav-item"
    type="button"
    data-active={tab === id}
    aria-current={tab === id ? 'page' : undefined}
    onclick={() => (tab = id)}
  >
    <Icon {...iconMd} aria-hidden="true" />
    {label}
  </button>
{/snippet}

<div class="settings-overlay" role="presentation" onclick={onOverlayClick}>
  <div
    class="settings-modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="settingsTitle"
    tabindex="-1"
    use:dialogFocusTrap={{ enabled: !nestedDialogOpen }}
  >
    <div class="settings-head">
      <span class="settings-title" id="settingsTitle">Настройки</span>
      <button class="settings-close" type="button" aria-label="Закрыть" onclick={onClose} data-dialog-initial-focus>
        <X {...iconSm} aria-hidden="true" />
      </button>
    </div>

    <div class="settings-body">
      <nav class="settings-nav" aria-label="Разделы настроек">
        <div class="settings-nav-main">
          {@render navItem('profile', 'Профиль', User)}
          {@render navItem('security', 'Безопасность', ShieldCheck)}
          {@render navItem('sound', 'Звук', Mic)}
          {#if support.desktopApp}{@render navItem('hotkeys', 'Хоткеи', Keyboard)}{/if}
          {#if appTab}{@render navItem('app', 'Приложение', Monitor)}{/if}
          {@render navItem('notifications', 'Уведомления', Bell)}
        </div>
        <button
          class="settings-nav-item settings-nav-item--danger"
          type="button"
          disabled={loggingOut}
          onclick={onLogout}
        >
          <LogOut {...iconMd} aria-hidden="true" />
          {loggingOut ? 'Выходим…' : 'Выйти'}
        </button>
      </nav>

      <div class="settings-content">
        {#if tab === 'profile'}
          <ProfileSettings {user} draft={profile} {onClose} {onToast} />
        {:else if tab === 'security'}
          <AccountSecuritySettings
            login={user?.login ?? ''}
            highlightRecoveryCodes={securityHighlight === 'recovery-codes'}
            highlightPassword={securityHighlight === 'password'}
            {onToast}
            onDialogOpenChange={(dialogOpen: boolean) => (securityDialogOpen = dialogOpen)}
          />
        {:else if tab === 'sound'}
          <SoundSettings desktopApp={support.desktopApp} {onToast} />
        {:else if tab === 'hotkeys' && support.desktopApp}
          <HotkeySettings globalHotkeys={support.globalHotkeys} {onToast} />
        {:else if tab === 'app' && appTab}
          <AppSettings {support} {onToast} />
        {:else}
          <NotificationSettings {support} users={notificationUsers} rooms={notificationRooms} {onToast} />
        {/if}
      </div>
    </div>
  </div>
</div>
