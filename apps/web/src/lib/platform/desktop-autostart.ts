export interface DesktopAutostartSettings {
  openAtLogin: boolean;
  startMinimized: boolean;
  supported: boolean;
  reason?: string;
}

export type DesktopAutostartPatch = Partial<Pick<DesktopAutostartSettings, 'openAtLogin' | 'startMinimized'>>;

function getBridge(): Window['voiceRoomDesktopAutostart'] | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.voiceRoomDesktopAutostart;
}

function normalizeSettings(value: unknown): DesktopAutostartSettings | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const settings: DesktopAutostartSettings = {
    openAtLogin: source.openAtLogin === true,
    startMinimized: source.startMinimized === true,
    supported: source.supported === true
  };
  if (typeof source.reason === 'string' && source.reason) settings.reason = source.reason;
  return settings;
}

export function desktopAutostartAvailable(): boolean {
  const bridge = getBridge();
  return Boolean(bridge?.getSettings && bridge?.setSettings);
}

export async function readDesktopAutostartSettings(): Promise<DesktopAutostartSettings | null> {
  const bridge = getBridge();
  if (!bridge?.getSettings) return null;
  try {
    return normalizeSettings(await bridge.getSettings());
  } catch (error) {
    console.warn('Desktop autostart settings read failed', error);
    return null;
  }
}

export async function updateDesktopAutostartSettings(
  patch: DesktopAutostartPatch
): Promise<DesktopAutostartSettings | null> {
  const bridge = getBridge();
  if (!bridge?.setSettings) return null;
  const payload: DesktopAutostartPatch = {};
  if (typeof patch.openAtLogin === 'boolean') payload.openAtLogin = patch.openAtLogin;
  if (typeof patch.startMinimized === 'boolean') payload.startMinimized = patch.startMinimized;
  try {
    return normalizeSettings(await bridge.setSettings(payload));
  } catch (error) {
    console.warn('Desktop autostart settings update failed', error);
    return null;
  }
}
