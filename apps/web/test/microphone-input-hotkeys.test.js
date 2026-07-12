import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  formatHotkeyBinding,
  hotkeyBindingFromEvent,
  hotkeyMatchesEvent
} from '../src/lib/shared/ui/HotkeyRecorder/hotkey.js';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

function keyboardEvent(overrides = {}) {
  return {
    altKey: false,
    code: 'KeyM',
    ctrlKey: true,
    metaKey: false,
    shiftKey: true,
    ...overrides
  };
}

test('hotkey bindings use physical codes and exact modifier sets', () => {
  const binding = hotkeyBindingFromEvent(keyboardEvent());
  assert.deepEqual(binding, {
    altKey: false,
    code: 'KeyM',
    ctrlKey: true,
    metaKey: false,
    shiftKey: true
  });
  assert.equal(hotkeyMatchesEvent(binding, keyboardEvent()), true);
  assert.equal(hotkeyMatchesEvent(binding, keyboardEvent({ altKey: true })), false);
  assert.equal(hotkeyMatchesEvent(binding, keyboardEvent({ code: 'KeyN' })), false);
  assert.equal(hotkeyBindingFromEvent(keyboardEvent({ code: 'ShiftLeft' })), null);
  assert.equal(formatHotkeyBinding(binding), 'Ctrl + Shift + M');
  assert.equal(formatHotkeyBinding(null), 'Не назначено');
});

test('microphone gain is persisted, limited, and is the last capture stage', () => {
  const config = read('src/lib/features/room/client/core/config.ts');
  const settings = read('src/lib/features/room/client/core/settings.ts');
  const microphone = read('src/lib/features/room/client/services/microphone-service.ts');
  const meters = read('src/lib/features/room/client/media/meters.ts');

  assert.match(config, /MICROPHONE_VOLUME_STORAGE_KEY = 'voice-room:mic-volume'/);
  assert.match(config, /DEFAULT_MICROPHONE_VOLUME = 100/);
  assert.match(config, /MAX_MICROPHONE_VOLUME = 200/);
  assert.match(settings, /persistMicrophoneVolume/);
  assert.match(settings, /Math\.min\(MAX_MICROPHONE_VOLUME, Math\.max\(0, Math\.round\(volume\)\)\)/);

  assert.match(microphone, /capture = await applyNoiseGateToCapture/);
  assert.match(microphone, /return applyInputGainToCapture\(capture\)/);
  assert.match(microphone, /source\.connect\(gain\)/);
  assert.match(microphone, /gain\.connect\(limiter\)/);
  assert.match(microphone, /limiter\.connect\(destination\)/);
  assert.match(microphone, /limiter\.threshold\.value = -3/);
  assert.match(microphone, /type: 'input-gain'/);
  assert.match(microphone, /gain\.gain\.setTargetAtTime\(value, now, 0\.01\)/);
  assert.match(meters, /attachMeter\(participant: Participant \| null, stream: MediaStream \| null\)/);
});

test('microphone volume is available in settings and the room dock', () => {
  const modal = read('src/lib/features/home/components/SettingsModal.svelte');
  const dock = read('src/lib/features/room/components/RoomDock.svelte');
  const sound = read('src/lib/features/home/model/sound-settings.ts');

  assert.match(modal, /ariaLabel="Громкость микрофона"/);
  assert.match(modal, /onValueChange=\{onMicrophoneVolumeChange\}/);
  assert.match(dock, /bind:value=\{roomDeviceUi\.microphoneVolume\}/);
  assert.match(dock, /onValueChange=\{setMicrophoneVolume\}/);
  assert.match(sound, /source\.connect\(gain\)/);
  assert.match(sound, /gain\.connect\(limiter\)/);
  assert.match(sound, /limiter\.connect\(analyser\)/);
  assert.match(sound, /setVolume\(volume: number\)/);
  assert.match(sound, /inputGain\.gain\.setTargetAtTime/);
  assert.match(modal, /const inputVolume = untrack\(\(\) => micVolume\)/);
  assert.match(modal, /activeMicMeter\?\.setVolume\(latestMicVolume\)/);
});

test('configurable hotkeys and push-to-talk cover hold, release, and focus loss', () => {
  const hotkeys = read('src/lib/features/room/client/core/hotkeys.ts');
  const recorder = read('src/lib/shared/ui/HotkeyRecorder/HotkeyRecorder.svelte');
  const main = read('src/lib/features/room/client/main.ts');
  const controls = read('src/lib/features/room/client/ui/controls.ts');
  const modal = read('src/lib/features/home/components/SettingsModal.svelte');
  const dock = read('src/lib/features/room/components/RoomDock.svelte');

  assert.match(hotkeys, /HOTKEY_STORAGE_PREFIX = 'voice-room:hotkey:'/);
  assert.match(hotkeys, /code: 'KeyM'/);
  assert.match(hotkeys, /ctrlKey: !applePlatform/);
  assert.match(hotkeys, /metaKey: applePlatform/);
  assert.match(hotkeys, /target\.closest\('input, textarea, select/);

  assert.match(recorder, /Нажмите клавиши…/);
  assert.match(recorder, /event\.key === 'Escape'/);
  assert.match(recorder, /onValueChange\?\.\(defaultValue\)/);
  assert.match(main, /eventMatchesHotkey\('mic-mute', event\)/);
  assert.match(main, /eventMatchesHotkey\('output-mute', event\)/);
  assert.match(main, /eventMatchesHotkey\('push-to-talk', event\)/);
  assert.match(main, /window\.addEventListener\('keyup', onVoiceHotkeyUp/);
  assert.match(main, /window\.addEventListener\('blur', releasePushToTalkImmediately/);
  assert.match(main, /document\.hidden/);

  assert.match(controls, /beginPushToTalk/);
  assert.match(controls, /endPushToTalk/);
  assert.match(controls, /PUSH_TO_TALK_RELEASE_HOLD_MS/);
  assert.match(controls, /setMicrophoneMuted\(false, \{ playCue: false \}\)/);
  assert.match(controls, /setMicrophoneMuted\(true, \{ playCue: false \}\)/);
  assert.match(modal, /Горячие клавиши работают, только пока окно VoiceRoom активно/);
  assert.match(dock, /data-active=\{roomClientState\.pushToTalkActive\}/);
});
