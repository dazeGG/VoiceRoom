import type { HotkeyBinding } from '$lib/shared/ui/HotkeyRecorder/types';

export const OVERLAY_ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export type OverlayAnchor = (typeof OVERLAY_ANCHORS)[number];

export interface DesktopOverlayParticipant {
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
  showParticipants: boolean;
  showControls: boolean;
  clickThrough: boolean;
  interactiveBinding: HotkeyBinding | null;
}

export type DesktopOverlayPatch = Partial<DesktopOverlaySettings>;

const DEFAULT_SETTINGS: DesktopOverlaySettings = {
  anchor: 'top-left',
  clickThrough: true,
  enabled: true,
  interactiveBinding: {
    altKey: false,
    code: 'Backquote',
    ctrlKey: true,
    metaKey: false,
    shiftKey: false
  },
  opacity: 0.92,
  showControls: true,
  showParticipants: true
};

function getBridge(): Window['voiceRoomDesktopOverlay'] | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.voiceRoomDesktopOverlay;
}

function isAnchor(value: unknown): value is OverlayAnchor {
  return typeof value === 'string' && (OVERLAY_ANCHORS as readonly string[]).includes(value);
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
  return Math.min(1, Math.max(0.4, numeric));
}

export function normalizeOverlaySettings(value: unknown): DesktopOverlaySettings | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  return {
    anchor: isAnchor(source.anchor) ? source.anchor : DEFAULT_SETTINGS.anchor,
    clickThrough: source.clickThrough !== false,
    enabled: source.enabled !== false,
    interactiveBinding: Object.hasOwn(source, 'interactiveBinding')
      ? normalizeBinding(source.interactiveBinding)
      : DEFAULT_SETTINGS.interactiveBinding,
    opacity: clampOpacity(source.opacity),
    showControls: source.showControls !== false,
    showParticipants: source.showParticipants !== false
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
  if (typeof patch.showParticipants === 'boolean') payload.showParticipants = patch.showParticipants;
  if (typeof patch.showControls === 'boolean') payload.showControls = patch.showControls;
  if (typeof patch.clickThrough === 'boolean') payload.clickThrough = patch.clickThrough;
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
