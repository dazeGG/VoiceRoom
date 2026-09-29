<script lang="ts">
  // The account's dialogs over the lobby: settings, the sign-in alert, "what's
  // new" and the desktop app prompt, all driven by AccountPrompts.
  import type { AuthUser, OwnedRoom } from '$lib/api/auth';
  import type { PublicUser } from '$lib/api/friends';
  import AppBenefitsModal from '$lib/shared/components/AppBenefitsModal.svelte';
  import type { AccountPrompts, SecurityHighlight } from '../model/account-prompts.svelte';
  import type { ToastOptions } from '../model/toasts.svelte';
  import LoginAlertDialog from './LoginAlertDialog.svelte';
  import SettingsModal from './SettingsModal.svelte';
  import WhatsNewDialog from './WhatsNewDialog.svelte';

  let {
    prompts,
    user,
    notificationUsers,
    notificationRooms,
    loggingOut,
    onToast,
    onLogout
  }: {
    prompts: AccountPrompts;
    user: AuthUser;
    notificationUsers: PublicUser[];
    notificationRooms: OwnedRoom[];
    loggingOut: boolean;
    onToast: (message: string, options?: ToastOptions) => void;
    onLogout: () => void;
  } = $props();
</script>

<SettingsModal
  open={prompts.settingsOpen}
  bind:tab={prompts.settingsTab}
  {user}
  {notificationUsers}
  {notificationRooms}
  {loggingOut}
  securityHighlight={prompts.securityHighlight}
  onClose={prompts.closeSettings}
  {onToast}
  {onLogout}
/>
<LoginAlertDialog
  onSecureAccount={(target: SecurityHighlight) => prompts.openSecuritySettings(target)}
  onOpenChange={(open: boolean) => (prompts.loginAlertOpen = open)}
  {onToast}
/>
<WhatsNewDialog
  paused={prompts.loginAlertOpen}
  onOpenSecurity={() => prompts.openSecuritySettings()}
  onOpenChange={(open: boolean) => (prompts.whatsNewOpen = open)}
/>
<AppBenefitsModal open={prompts.appPromptOpen} onClose={prompts.closeAppPrompt} />
