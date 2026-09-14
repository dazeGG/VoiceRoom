import type { HotkeyBinding } from '$lib/shared/ui/HotkeyRecorder/types';

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
}

export interface DesktopOverlaySettings {
  enabled: boolean;
  opacity: number;
  anchor: OverlayAnchor;
  avatarSize: OverlayAvatarSize;
  showParticipants: boolean;
  showNames: boolean;
  showControls: boolean;
  clickThrough: boolean;
  interactiveBinding: HotkeyBinding | null;
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
  clickThrough: true,
  enabled: true,
  interactiveBinding: {
    altKey: false,
    code: 'Backquote',
    ctrlKey: true,
    metaKey: false,
    shiftKey: false
  },
  opacity: 0.5,
  showControls: false,
  showNames: true,
  showParticipants: true,
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

function normalizeBinding(value: unknown): HotkeyBinding | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object') return DEFAULT_SETTINGS.interactiveBinding;
  const source = value as Record<string, unknown>;
  if (typeof source.code !== 'string' || !source.code) return DEFAULT_SETTINGS.interactiveBinding;
  return {
    altKey: source.altKey === true,
    code: source.code,
    ctrlKey: source.ctrlKey === true,
    metaKey: source.metaKey === true,
    shiftKey: source.shiftKey === true
  };
}

function clampOpacity(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(numeric)) return DEFAULT_SETTINGS.opacity;
  return Math.min(1, Math.max(0.2, numeric));
}

export function normalizeOverlaySettings(value: unknown): DesktopOverlaySettings | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  return {
    anchor: isAnchor(source.anchor) ? source.anchor : DEFAULT_SETTINGS.anchor,
    avatarSize: isAvatarSize(source.avatarSize) ? source.avatarSize : DEFAULT_SETTINGS.avatarSize,
    clickThrough: source.clickThrough !== false,
    enabled: source.enabled !== false,
    interactiveBinding: Object.hasOwn(source, 'interactiveBinding')
      ? normalizeBinding(source.interactiveBinding)
      : DEFAULT_SETTINGS.interactiveBinding,
    opacity: clampOpacity(source.opacity),
    showControls: source.showControls === true,
    showNames: source.showNames !== false,
    showParticipants: source.showParticipants !== false,
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
    console.warn('Desktop overlay settings read failed', error);
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
  if (typeof patch.opacity === 'number') payload.opacity = clampOpacity(patch.opacity);
  if (isAnchor(patch.anchor)) payload.anchor = patch.anchor;
  if (isAvatarSize(patch.avatarSize)) payload.avatarSize = patch.avatarSize;
  if (typeof patch.showParticipants === 'boolean') payload.showParticipants = patch.showParticipants;
  if (typeof patch.showNames === 'boolean') payload.showNames = patch.showNames;
  if (typeof patch.showControls === 'boolean') payload.showControls = patch.showControls;
  if (typeof patch.clickThrough === 'boolean') payload.clickThrough = patch.clickThrough;
  if (Array.isArray(patch.allowedExecutables)) payload.allowedExecutables = patch.allowedExecutables;
  if (patch.interactiveBinding === null || (patch.interactiveBinding && typeof patch.interactiveBinding === 'object')) {
    payload.interactiveBinding = patch.interactiveBinding;
  }
  try {
    return normalizeOverlaySettings(await bridge.setSettings(payload));
  } catch (error) {
    console.warn('Desktop overlay settings update failed', error);
    return null;
  }
}

export async function previewDesktopOverlay(): Promise<boolean> {
  const bridge = getBridge();
  if (!bridge?.preview) return false;
  try {
    await bridge.preview();
    return true;
  } catch (error) {
    console.warn('Desktop overlay preview failed', error);
    return false;
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
    console.warn('Desktop overlay foreground read failed', error);
    return null;
  }
}

export async function addDesktopOverlayGame(exe?: string): Promise<DesktopOverlaySettings | null> {
  const bridge = getBridge();
  if (!bridge?.addGame) return null;
  try {
    return normalizeOverlaySettings(await bridge.addGame(exe));
  } catch (error) {
    console.warn('Desktop overlay add game failed', error);
    return null;
  }
}

export async function removeDesktopOverlayGame(exe: string): Promise<DesktopOverlaySettings | null> {
  const bridge = getBridge();
  if (!bridge?.removeGame) return null;
  try {
    return normalizeOverlaySettings(await bridge.removeGame(exe));
  } catch (error) {
    console.warn('Desktop overlay remove game failed', error);
    return null;
  }
}

export async function setDesktopOverlaySuspended(suspended: boolean): Promise<void> {
  const bridge = getBridge();
  if (!bridge?.setSuspended) return;
  try {
    await bridge.setSuspended(Boolean(suspended));
  } catch (error) {
    console.warn('Desktop overlay hotkey suspend failed', error);
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
      console.warn('Desktop overlay snapshot sync failed', error);
    });
}
