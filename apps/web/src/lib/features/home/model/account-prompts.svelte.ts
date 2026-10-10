// What the lobby asks of the account outside its main views: the settings
// dialog (and which tab), the recovery-codes reminder, the sign-in alert and
// "what's new" stories, and the one-time desktop app prompt, which waits until
// none of the others is on screen and no call is joining or live.

import { fetchAccountSecurity, markAppPromptSeen, snoozeRecoveryCodesReminder, type AuthUser } from '$lib/api/auth';
import { shouldOpenAppPrompt } from '$lib/features/room/room-cta';
import { readOpenInAppSignals, shouldOfferOpenInApp } from '$lib/platform/open-in-app';
import { createLogger, errorContext } from '$lib/shared/log';
import { shouldShowRecoveryCodesReminder } from './account-security';

export type SettingsTab = 'profile' | 'sound' | 'hotkeys' | 'notifications' | 'app' | 'security' | 'appearance';
export type SecurityHighlight = 'recovery-codes' | 'password' | null;

const log = createLogger('lobby');

export class AccountPrompts {
  settingsOpen = $state(false);
  settingsTab = $state<SettingsTab>('profile');
  securityHighlight = $state<SecurityHighlight>(null);
  recoveryCodesReminder = $state(false);
  loginAlertOpen = $state(false);
  whatsNewOpen = $state(false);
  appPromptOpen = $state(false);
  // The desktop app exists for Windows and macOS browsers only.
  #appPromptAvailable = $state(false);
  #appPromptDone = $state(false);

  #onToast: (message: string, options?: { variant?: 'error' }) => void;

  constructor(options: {
    /** The account; the app prompt is decided per account by the API. */
    user: () => AuthUser | null;
    /** A call is joining or live: the app prompt must not cover it. */
    voiceActive: () => boolean;
    onToast: (message: string, options?: { variant?: 'error' }) => void;
  }) {
    this.#onToast = options.onToast;
    $effect(() => {
      const user = options.user();
      if (this.#appPromptDone || this.appPromptOpen || !user) return;
      const open = shouldOpenAppPrompt({
        appAvailable: this.#appPromptAvailable,
        hasUsedDesktopApp: user.hasUsedDesktopApp,
        appPromptSeen: user.appPromptSeen,
        otherDialogOpen: this.loginAlertOpen || this.whatsNewOpen,
        voiceActive: options.voiceActive()
      });
      if (open) this.appPromptOpen = true;
    });
  }

  /** Runs once the lobby is mounted (reads the browser and the account's security). */
  start(): void {
    this.#appPromptAvailable = shouldOfferOpenInApp(readOpenInAppSignals());
    void this.refreshRecoveryCodesReminder();
  }

  openSettings = (): void => {
    this.settingsTab = 'profile';
    this.settingsOpen = true;
  };

  openSecuritySettings = (highlight: SecurityHighlight = null): void => {
    this.securityHighlight = highlight;
    this.settingsTab = 'security';
    this.settingsOpen = true;
  };

  closeSettings = (): void => {
    this.settingsOpen = false;
    this.securityHighlight = null;
    // Codes may have been created meanwhile.
    void this.refreshRecoveryCodesReminder();
  };

  refreshRecoveryCodesReminder = async (): Promise<void> => {
    try {
      this.recoveryCodesReminder = shouldShowRecoveryCodesReminder(await fetchAccountSecurity());
    } catch {
      // The reminder is optional; keep whatever was shown.
    }
  };

  snoozeRecoveryCodes = async (): Promise<void> => {
    this.recoveryCodesReminder = false;
    try {
      await snoozeRecoveryCodesReminder();
    } catch {
      this.#onToast('Не удалось отложить напоминание', { variant: 'error' });
    }
  };

  closeAppPrompt = (): void => {
    this.appPromptOpen = false;
    this.#appPromptDone = true;
    void markAppPromptSeen().catch((error) => log.warn('app prompt was not recorded', errorContext(error)));
  };
}
