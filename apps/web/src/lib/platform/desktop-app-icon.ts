// The explicit extension is required because desktop-app-icon.test.ts imports
// this module natively under Node, where neither the `$lib` alias nor an
// extensionless specifier resolves.
import { createLogger, errorContext } from '../shared/log.ts';

const log = createLogger('desktop:app-icon');

function getBridge(): Window['voiceRoomDesktopAppIcon'] | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.voiceRoomDesktopAppIcon;
}

export function desktopAppIconAvailable(): boolean {
  return typeof getBridge()?.setTheme === 'function';
}

/**
 * Tells the desktop shell which colour theme is active so it can switch the app
 * icon (window, Dock, tray) to that theme's variant. The shell remembers the
 * last theme for its next launch, so this runs on every start and every change.
 * Without the bridge (a browser, or a shell that predates it) nothing happens.
 */
export async function reportDesktopAppIconTheme(theme: string): Promise<void> {
  const bridge = getBridge();
  if (typeof bridge?.setTheme !== 'function') return;
  try {
    await bridge.setTheme(theme);
  } catch (error) {
    log.warn('desktop app icon theme update failed', errorContext(error));
  }
}
