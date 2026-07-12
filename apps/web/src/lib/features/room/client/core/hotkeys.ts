import { hotkeyMatchesEvent } from '$lib/shared/ui/HotkeyRecorder/hotkey.js';
import type { HotkeyBinding } from '$lib/shared/ui/HotkeyRecorder/types';

export type HotkeyAction = 'mic-mute' | 'output-mute' | 'push-to-talk';

export const HOTKEY_STORAGE_PREFIX = 'voice-room:hotkey:';

export function getHotkeyStorageKey(action: HotkeyAction): string {
  return `${HOTKEY_STORAGE_PREFIX}${action}`;
}

export function getDefaultHotkeyBinding(
  action: HotkeyAction,
  applePlatform = isApplePlatform()
): HotkeyBinding | null {
  if (action !== 'mic-mute') return null;
  return {
    altKey: false,
    code: 'KeyM',
    ctrlKey: !applePlatform,
    metaKey: applePlatform,
    shiftKey: true
  };
}

export function readHotkeyBinding(action: HotkeyAction): HotkeyBinding | null {
  try {
    const stored = localStorage.getItem(getHotkeyStorageKey(action));
    if (stored === null) return getDefaultHotkeyBinding(action);
    return parseHotkeyBinding(stored) ?? getDefaultHotkeyBinding(action);
  } catch {
    return getDefaultHotkeyBinding(action);
  }
}

export function writeHotkeyBinding(action: HotkeyAction, binding: HotkeyBinding | null): void {
  try {
    const key = getHotkeyStorageKey(action);
    if (binding) localStorage.setItem(key, JSON.stringify(binding));
    else localStorage.removeItem(key);
  } catch {
    // Hotkeys remain available for this settings session if storage is blocked.
  }
}

export function parseHotkeyBinding(serialized: string): HotkeyBinding | null {
  try {
    const value = JSON.parse(serialized) as Partial<HotkeyBinding> | null;
    if (!value || typeof value !== 'object' || typeof value.code !== 'string' || !value.code) return null;
    return {
      altKey: value.altKey === true,
      code: value.code,
      ctrlKey: value.ctrlKey === true,
      metaKey: value.metaKey === true,
      shiftKey: value.shiftKey === true
    };
  } catch {
    return null;
  }
}

export function eventMatchesHotkey(action: HotkeyAction, event: KeyboardEvent): boolean {
  return hotkeyMatchesEvent(readHotkeyBinding(action), event);
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.isContentEditable
    || target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [data-hotkey-recorder-recording="true"]')
  );
}

function isApplePlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}
