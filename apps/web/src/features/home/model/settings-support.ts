// What this runtime lets the settings offer. Read once when the settings open:
// none of it changes while they are up.

import { desktopGlobalHotkeysAvailable } from '@voiceroom/call/engine';
import { desktopAutostartAvailable } from '@/platform/desktop-autostart';
import { desktopDiagnosticsAvailable } from '@/platform/desktop-diagnostics';
import { desktopOverlayAvailable } from '@/platform/desktop-overlay';
import { readDesktopRuntime } from '@/platform/desktop-system';

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
  const runtime = readDesktopRuntime();
  const desktopApp = Boolean(runtime?.isDesktop);
  return {
    desktopApp,
    mac: desktopApp && runtime?.platform === 'darwin',
    globalHotkeys: desktopApp && desktopGlobalHotkeysAvailable(),
    autostart: desktopApp && desktopAutostartAvailable(),
    overlay: desktopApp && desktopOverlayAvailable(),
    diagnostics: desktopApp && desktopDiagnosticsAvailable()
  };
}
