// What this runtime lets the settings offer. Read once when the settings open:
// none of it changes while they are up.

import { desktopGlobalHotkeysAvailable } from '$lib/features/room/client/services/desktop-hotkey-service';
import { desktopAutostartAvailable } from '$lib/platform/desktop-autostart';
import { desktopDiagnosticsAvailable } from '$lib/platform/desktop-diagnostics';
import { desktopOverlayAvailable } from '$lib/platform/desktop-overlay';

export type SettingsSupport = {
  /** Running inside the desktop app rather than a browser tab. */
  desktopApp: boolean;
  mac: boolean;
  globalHotkeys: boolean;
  autostart: boolean;
  overlay: boolean;
  diagnostics: boolean;
};

export function readSettingsSupport(): SettingsSupport {
  const desktopApp = Boolean(window.voiceRoomRuntime?.isDesktop);
  return {
    desktopApp,
    mac: desktopApp && window.voiceRoomRuntime?.platform === 'darwin',
    globalHotkeys: desktopApp && desktopGlobalHotkeysAvailable(),
    autostart: desktopApp && desktopAutostartAvailable(),
    overlay: desktopApp && desktopOverlayAvailable(),
    diagnostics: desktopApp && desktopDiagnosticsAvailable()
  };
}
