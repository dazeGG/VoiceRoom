// What the lobby asks of the account outside its main views: the settings
// dialog (and which tab), the recovery-codes reminder, the sign-in alert and
// "what's new" stories, and the one-time desktop app prompt, which waits until
// none of the others is on screen and no call is joining or live.

import { ref, watchEffect } from 'vue';
import { fetchAccountSecurity, markAppPromptSeen, snoozeRecoveryCodesReminder, type AuthUser } from '@/api/auth';
import { shouldOpenAppPrompt } from '@/features/room/room-cta';
import { readOpenInAppSignals, shouldOfferOpenInApp } from '@/platform/open-in-app';
import { createLogger, errorContext } from '@/shared/log';
import { shouldShowRecoveryCodesReminder } from './account-security';

export type SettingsTab = 'profile' | 'sound' | 'hotkeys' | 'notifications' | 'app' | 'security' | 'appearance';
export type SecurityHighlight = 'recovery-codes' | 'password' | null;

const log = createLogger('lobby');

export function useAccountPrompts(options: {
  /** The account; the app prompt is decided per account by the API. */
  user: () => AuthUser | null;
  /** A call is joining or live: the app prompt must not cover it. */
  voiceActive: () => boolean;
  /** A lobby dialog of its own (the new room) is open: the app prompt waits for it. */
  lobbyDialogOpen: () => boolean;
  onToast: (message: string, options?: { variant?: 'error' }) => void;
}) {
  const settingsOpen = ref(false);
  const settingsTab = ref<SettingsTab>('profile');
  const securityHighlight = ref<SecurityHighlight>(null);
  const recoveryCodesReminder = ref(false);
  const loginAlertOpen = ref(false);
  const whatsNewOpen = ref(false);
  const appPromptOpen = ref(false);
  // The desktop app exists for Windows and macOS browsers only.
  const appPromptAvailable = ref(false);
  const appPromptDone = ref(false);

  watchEffect(() => {
    const user = options.user();
    if (appPromptDone.value || appPromptOpen.value || !user) return;
    const open = shouldOpenAppPrompt({
      appAvailable: appPromptAvailable.value,
      hasUsedDesktopApp: user.hasUsedDesktopApp,
      appPromptSeen: user.appPromptSeen,
      otherDialogOpen: loginAlertOpen.value || whatsNewOpen.value || options.lobbyDialogOpen(),
      voiceActive: options.voiceActive()
    });
    if (open) appPromptOpen.value = true;
  });

  /** Runs once the lobby is mounted (reads the browser and the account's security). */
  function start(): void {
    appPromptAvailable.value = shouldOfferOpenInApp(readOpenInAppSignals());
    void refreshRecoveryCodesReminder();
  }

  const openSettings = (): void => {
    settingsTab.value = 'profile';
    settingsOpen.value = true;
  };

  const openSecuritySettings = (highlight: SecurityHighlight = null): void => {
    securityHighlight.value = highlight;
    settingsTab.value = 'security';
    settingsOpen.value = true;
  };

  const openAppearanceSettings = (): void => {
    settingsTab.value = 'appearance';
    settingsOpen.value = true;
  };

  const closeSettings = (): void => {
    settingsOpen.value = false;
    securityHighlight.value = null;
    // Codes may have been created meanwhile.
    void refreshRecoveryCodesReminder();
  };

  const refreshRecoveryCodesReminder = async (): Promise<void> => {
    try {
      recoveryCodesReminder.value = shouldShowRecoveryCodesReminder(await fetchAccountSecurity());
    } catch {
      // The reminder is optional; keep whatever was shown.
    }
  };

  const snoozeRecoveryCodes = async (): Promise<void> => {
    recoveryCodesReminder.value = false;
    try {
      await snoozeRecoveryCodesReminder();
    } catch {
      options.onToast('Не удалось отложить напоминание', { variant: 'error' });
    }
  };

  const closeAppPrompt = (): void => {
    appPromptOpen.value = false;
    appPromptDone.value = true;
    void markAppPromptSeen().catch((error: unknown) => log.warn('app prompt was not recorded', errorContext(error)));
  };

  return {
    settingsOpen,
    settingsTab,
    securityHighlight,
    recoveryCodesReminder,
    loginAlertOpen,
    whatsNewOpen,
    appPromptOpen,
    start,
    openSettings,
    openSecuritySettings,
    openAppearanceSettings,
    closeSettings,
    refreshRecoveryCodesReminder,
    snoozeRecoveryCodes,
    closeAppPrompt
  };
}

export type AccountPrompts = ReturnType<typeof useAccountPrompts>;
