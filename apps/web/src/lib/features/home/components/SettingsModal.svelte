<script lang="ts">
  import type { AuthUser, OwnedRoom } from '$lib/api/auth';
  import type { PublicUser } from '$lib/api/friends';
  import type { ToastOptions } from '../model/toasts.svelte';
  import SettingsDialog from './settings/SettingsDialog.svelte';
  import type { SettingsTab } from './settings/types';

  let {
    open,
    tab = $bindable('profile'),
    user,
    notificationUsers = [],
    notificationRooms = [],
    loggingOut = false,
    securityHighlight = null,
    onClose,
    onToast,
    onLogout
  }: {
    open: boolean;
    tab: SettingsTab;
    user: AuthUser | null;
    notificationUsers?: PublicUser[];
    notificationRooms?: OwnedRoom[];
    loggingOut?: boolean;
    securityHighlight?: 'recovery-codes' | 'password' | null;
    onClose: () => void;
    onToast: (message: string, options?: ToastOptions) => void;
    onLogout: () => void;
  } = $props();
</script>

<!-- Every opening, and a switch of account, starts from what is saved. -->
{#if open}
  {#key user?.id}
    <SettingsDialog
      bind:tab
      {user}
      {notificationUsers}
      {notificationRooms}
      {loggingOut}
      {securityHighlight}
      {onClose}
      {onToast}
      {onLogout}
    />
  {/key}
{/if}
