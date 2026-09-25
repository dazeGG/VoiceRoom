// Voice controls: hotkeys, push-to-talk and microphone volume.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('../../src/lib/features/room/client/media/cues', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  playMicCue: vi.fn()
}));
vi.mock('../../src/lib/features/room/client/room/presence', () => ({ postState: vi.fn(async () => {}) }));
vi.mock('../../src/lib/features/room/client/services/livekit-service', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  syncLocalMicrophonePublicationMuted: vi.fn(async () => {})
}));

const cues = await import('../../src/lib/features/room/client/media/cues');
const { state } = await import('../../src/lib/features/room/client/core/state.svelte.ts');
const { createInitialRoomState } = await import('../../src/lib/features/room/client/model/room-state.ts');
const hotkeys = await import('../../src/lib/features/room/client/core/hotkeys.ts');
const { isMicrophoneShownMuted } = await import('../../src/lib/features/room/client/core/microphone-mute.ts');
const { beginPushToTalk, endPushToTalk } = await import('../../src/lib/features/room/client/ui/controls.ts');
const { getStoredMicrophoneVolume, persistMicrophoneVolume } =
  await import('../../src/lib/features/room/client/core/settings.ts');
const { formatHotkeyBinding, hotkeyBindingFromEvent, hotkeyMatchesEvent } =
  await import('../../src/lib/shared/ui/HotkeyRecorder/hotkey.ts');

const key = (overrides: Partial<KeyboardEvent> = {}) =>
  ({ altKey: false, code: 'KeyM', ctrlKey: true, metaKey: false, shiftKey: true, ...overrides }) as KeyboardEvent;

beforeEach(() => {
  localStorage.clear();
  Object.assign(state, createInitialRoomState());
  vi.mocked(cues.playMicCue).mockClear();
});
afterEach(() => vi.useRealTimers());

test('a binding is the physical key with the exact set of modifiers', () => {
  const binding = hotkeyBindingFromEvent(key());
  expect(binding).toEqual({ altKey: false, code: 'KeyM', ctrlKey: true, metaKey: false, shiftKey: true });
  expect(hotkeyMatchesEvent(binding, key())).toBe(true);
  expect(hotkeyMatchesEvent(binding, key({ altKey: true }))).toBe(false);
  expect(hotkeyMatchesEvent(binding, key({ code: 'KeyN' }))).toBe(false);
  expect(hotkeyBindingFromEvent(key({ code: 'ShiftLeft' }))).toBeNull();
  expect(formatHotkeyBinding(binding)).toBe('Ctrl + Shift + M');
  expect(formatHotkeyBinding(null)).toBe('Не назначено');
});

test('microphone mute defaults to Ctrl+Shift+M, or Cmd+Shift+M on Apple; other actions start unassigned', () => {
  expect(hotkeys.getDefaultHotkeyBinding('mic-mute', false)).toMatchObject({
    code: 'KeyM',
    ctrlKey: true,
    metaKey: false,
    shiftKey: true
  });
  expect(hotkeys.getDefaultHotkeyBinding('mic-mute', true)).toMatchObject({ ctrlKey: false, metaKey: true });
  expect(hotkeys.getDefaultHotkeyBinding('push-to-talk')).toBeNull();
});

test('a changed binding is stored and announced; clearing it disables the action; junk falls back to the default', () => {
  const changed = vi.fn();
  window.addEventListener(hotkeys.HOTKEY_BINDINGS_CHANGED_EVENT, changed);
  hotkeys.writeHotkeyBinding('push-to-talk', {
    altKey: false,
    code: 'Space',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false
  });
  expect(hotkeys.readHotkeyBinding('push-to-talk')?.code).toBe('Space');
  expect(changed).toHaveBeenCalledTimes(1);

  hotkeys.writeHotkeyBinding('mic-mute', null);
  expect(hotkeys.readHotkeyBinding('mic-mute')).toBeNull();

  localStorage.setItem(hotkeys.getHotkeyStorageKey('mic-mute'), '{broken');
  expect(hotkeys.readHotkeyBinding('mic-mute')?.code).toBe('KeyM');
  window.removeEventListener(hotkeys.HOTKEY_BINDINGS_CHANGED_EVENT, changed);
});

test('hotkeys never fire while typing in a field', () => {
  const input = document.createElement('input');
  const div = document.createElement('div');
  const editable = document.createElement('div');
  editable.setAttribute('contenteditable', 'true');
  document.body.append(input, div, editable);
  expect(hotkeys.isTypingTarget(input)).toBe(true);
  expect(hotkeys.isTypingTarget(div)).toBe(false);
  expect(hotkeys.isTypingTarget(editable)).toBe(true);
  input.remove();
  div.remove();
  editable.remove();
});

test('an idle push-to-talk microphone is not shown as muted, but deafen is', () => {
  state.muted = true;
  state.microphoneMode = 'push-to-talk';
  expect(isMicrophoneShownMuted()).toBe(false);
  state.outputMuted = true;
  expect(isMicrophoneShownMuted()).toBe(true);
  state.microphoneMode = 'open';
  state.outputMuted = false;
  expect(isMicrophoneShownMuted()).toBe(true);
});

test('holding push-to-talk opens the microphone without a cue, and releasing closes it after a short hold', () => {
  vi.useFakeTimers();
  Object.assign(state, {
    microphoneMode: 'push-to-talk',
    joined: true,
    localStream: { getAudioTracks: () => [] },
    muted: true
  });
  expect(beginPushToTalk()).toBe(true);
  expect(state.pushToTalkActive).toBe(true);
  expect(state.muted).toBe(false);

  endPushToTalk();
  expect(state.pushToTalkActive).toBe(true);
  // Pressing again within the hold keeps the microphone open.
  beginPushToTalk();
  endPushToTalk();
  expect(state.muted).toBe(false);
  vi.runAllTimers();
  expect(state.pushToTalkActive).toBe(false);
  expect(state.muted).toBe(true);
  expect(cues.playMicCue).not.toHaveBeenCalled();
});

test('push-to-talk does nothing outside a call, in open-mic mode or while deafened', () => {
  Object.assign(state, { microphoneMode: 'open', joined: true, localStream: {} });
  expect(beginPushToTalk()).toBe(false);
  Object.assign(state, { microphoneMode: 'push-to-talk', joined: false });
  expect(beginPushToTalk()).toBe(false);
  Object.assign(state, { joined: true, outputMuted: true });
  expect(beginPushToTalk()).toBe(false);
});

test('microphone volume is stored as a whole percent between 0 and 200', () => {
  expect(getStoredMicrophoneVolume()).toBe(100);
  expect(persistMicrophoneVolume(149.6)).toBe(150);
  expect(getStoredMicrophoneVolume()).toBe(150);
  expect(persistMicrophoneVolume(500)).toBe(200);
  expect(persistMicrophoneVolume(-5)).toBe(0);
});
