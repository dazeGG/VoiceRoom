import { createLogger, errorContext } from '$lib/shared/log';

const log = createLogger('desktop:overlay');

export const OVERLAY_ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export type OverlayAnchor = (typeof OVERLAY_ANCHORS)[number];
export const OVERLAY_AVATAR_SIZES = ['small', 'medium', 'large'] as const;
export type OverlayAvatarSize = (typeof OVERLAY_AVATAR_SIZES)[number];

export interface DesktopOverlayParticipant {
  avatarAccent?: string;
  avatarColorKey?: string;
  avatarUrl?: string;
  id: string;
  name: string;
  micMuted: boolean;
  outputMuted: boolean;
  self: boolean;
  speaking: boolean;
  streaming: boolean;
}

// The overlay always lets clicks through and always fades silent participants,
// so only these preferences are configurable.
export interface DesktopOverlaySettings {
  enabled: boolean;
  anchor: OverlayAnchor;
  avatarSize: OverlayAvatarSize;
  showNames: boolean;
  allowedExecutables: string[];
}

export interface DesktopOverlayForeground {
  exe: string;
  game: boolean;
  label: string;
  reason: string;
  title: string;
}

export type DesktopOverlayPatch = Partial<DesktopOverlaySettings>;

const DEFAULT_SETTINGS: DesktopOverlaySettings = {
  anchor: 'top-left',
  avatarSize: 'medium',
  enabled: true,
  showNames: true,
  allowedExecutables: []
};

function getBridge(): Window['voiceRoomDesktopOverlay'] | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.voiceRoomDesktopOverlay;
}

function isAnchor(value: unknown): value is OverlayAnchor {
  return typeof value === 'string' && (OVERLAY_ANCHORS as readonly string[]).includes(value);
}

function isAvatarSize(value: unknown): value is OverlayAvatarSize {
  return typeof value === 'string' && (OVERLAY_AVATAR_SIZES as readonly string[]).includes(value);
}

export function normalizeOverlaySettings(value: unknown): DesktopOverlaySettings | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  return {
    anchor: isAnchor(source.anchor) ? source.anchor : DEFAULT_SETTINGS.anchor,
    avatarSize: isAvatarSize(source.avatarSize) ? source.avatarSize : DEFAULT_SETTINGS.avatarSize,
    enabled: source.enabled !== false,
    showNames: source.showNames !== false,
    allowedExecutables: Array.isArray(source.allowedExecutables)
      ? source.allowedExecutables.filter((item): item is string => typeof item === 'string' && Boolean(item))
      : []
  };
}

export function desktopOverlayAvailable(): boolean {
  const bridge = getBridge();
  return Boolean(bridge?.getSettings && bridge?.setSettings);
}

export async function readDesktopOverlaySettings(): Promise<DesktopOverlaySettings | null> {
  const bridge = getBridge();
  if (!bridge?.getSettings) return null;
  try {
    return normalizeOverlaySettings(await bridge.getSettings());
  } catch (error) {
    log.warn('desktop overlay settings read failed', errorContext(error));
    return null;
  }
}

export async function updateDesktopOverlaySettings(
  patch: DesktopOverlayPatch
): Promise<DesktopOverlaySettings | null> {
  const bridge = getBridge();
  if (!bridge?.setSettings) return null;
  const payload: DesktopOverlayPatch = {};
  if (typeof patch.enabled === 'boolean') payload.enabled = patch.enabled;
  if (isAnchor(patch.anchor)) payload.anchor = patch.anchor;
  if (isAvatarSize(patch.avatarSize)) payload.avatarSize = patch.avatarSize;
  if (typeof patch.showNames === 'boolean') payload.showNames = patch.showNames;
  if (Array.isArray(patch.allowedExecutables)) payload.allowedExecutables = patch.allowedExecutables;
  try {
    return normalizeOverlaySettings(await bridge.setSettings(payload));
  } catch (error) {
    log.warn('desktop overlay settings update failed', errorContext(error));
    return null;
  }
}

function normalizeForeground(value: unknown): DesktopOverlayForeground | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  return {
    exe: typeof source.exe === 'string' ? source.exe : '',
    game: source.game === true,
    label: typeof source.label === 'string' ? source.label : '',
    reason: typeof source.reason === 'string' ? source.reason : '',
    title: typeof source.title === 'string' ? source.title : ''
  };
}

export async function readDesktopOverlayForeground(): Promise<DesktopOverlayForeground | null> {
  const bridge = getBridge();
  if (!bridge?.getForeground) return null;
  try {
    return normalizeForeground(await bridge.getForeground());
  } catch (error) {
    log.warn('desktop overlay foreground read failed', errorContext(error));
    return null;
  }
}

export async function addDesktopOverlayGame(exe?: string): Promise<DesktopOverlaySettings | null> {
  const bridge = getBridge();
  if (!bridge?.addGame) return null;
  try {
    return normalizeOverlaySettings(await bridge.addGame(exe));
  } catch (error) {
    log.warn('desktop overlay add game failed', errorContext(error));
    return null;
  }
}

export async function removeDesktopOverlayGame(exe: string): Promise<DesktopOverlaySettings | null> {
  const bridge = getBridge();
  if (!bridge?.removeGame) return null;
  try {
    return normalizeOverlaySettings(await bridge.removeGame(exe));
  } catch (error) {
    log.warn('desktop overlay remove game failed', errorContext(error));
    return null;
  }
}

let lastSnapshotKey = '';

export function syncDesktopOverlaySnapshot(participants: DesktopOverlayParticipant[]): void {
  const bridge = getBridge();
  if (typeof bridge?.setSnapshot !== 'function') return;
  const payload = { participants };
  const key = JSON.stringify(payload);
  if (key === lastSnapshotKey) return;
  lastSnapshotKey = key;
  void Promise.resolve()
    .then(() => bridge.setSnapshot(payload))
    .catch((error) => {
      if (lastSnapshotKey === key) lastSnapshotKey = '';
      log.warn('desktop overlay snapshot sync failed', errorContext(error));
    });
}
