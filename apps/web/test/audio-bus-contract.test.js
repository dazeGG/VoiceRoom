import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('audio bus owns one limited master graph and browser-specific sink strategies', () => {
  const bus = read('src/lib/features/room/client/services/audio-bus.ts');

  assert.match(bus, /voice\.connect\(master\)/);
  assert.match(bus, /media\.connect\(master\)/);
  assert.match(bus, /sfx\.connect\(master\)/);
  assert.match(bus, /master\.connect\(limiter\)/);
  assert.match(bus, /limiter\.threshold\.value = -3/);
  assert.match(bus, /setSinkId\(sinkId\)/);
  assert.match(bus, /createMediaStreamDestination\(\)/);
  assert.match(bus, /sinkElement!\.srcObject = sinkDestination!\.stream/);
  assert.match(bus, /queueAudioOutputTransition\(applyRequestedOutput\)/);
  assert.match(bus, /applyAudioBusOutput\(requestedId\)/);
  assert.match(bus, /connectDefaultOutput\(current\)/);
  assert.match(bus, /state\.audioUnlockPending = true/);
  assert.match(bus, /transitionAudioOutput\(\{/);
  assert.match(bus, /localStorage\.removeItem\(OUTPUT_DEVICE_STORAGE_KEY\)/);
  assert.match(bus, /await syncAudioBusOutput\(''\)/);
});

test('remote voice, screen audio, and cues use the bus without a duplicate audible path', () => {
  const bus = read('src/lib/features/room/client/services/audio-bus.ts');
  const playback = read('src/lib/features/room/client/services/media-playback-service.ts');
  const participants = read('src/lib/features/room/client/room/participants.ts');
  const screen = read('src/lib/features/room/client/ui/screen-view.ts');
  const cues = read('src/lib/features/room/client/media/cues.ts');

  assert.match(bus, /createMediaStreamSource\(stream\)/);
  assert.match(bus, /routed\.gain\.gain\.value = options\.muted \? 0 : volume/);
  assert.match(bus, /mediaElement\.muted = true/);
  assert.match(participants, /audio\.srcObject = new MediaStream\(\[track\]\)/);
  assert.match(playback, /routeMediaStreamElement\(audio, 'voice'/);
  assert.match(playback, /routeMediaStreamElement\(mediaElement, 'media'/);
  assert.match(screen, /releaseScreenMediaElement\(video\)/);
  assert.match(cues, /gain\.connect\(getAudioBusInput\('sfx'\)\)/);
  assert.doesNotMatch(`${playback}\n${participants}\n${cues}`, /createMediaElementSource|gain\.connect\(context\.destination\)/);
});

test('master and notification settings persist and clamp to 200 percent', () => {
  const config = read('src/lib/features/room/client/core/config.ts');
  const settings = read('src/lib/features/room/client/core/settings.ts');
  const modal = read('src/lib/features/home/components/SettingsModal.svelte');

  assert.match(config, /MASTER_VOLUME_STORAGE_KEY = 'voice-room:master-volume'/);
  assert.match(config, /MAX_MASTER_VOLUME = 200/);
  assert.match(config, /MAX_NOTIFICATION_VOLUME = 200/);
  assert.match(settings, /persistMasterVolume/);
  assert.match(settings, /Math\.min\(MAX_MASTER_VOLUME, Math\.max\(0, Math\.round\(volume\)\)\)/);
  assert.match(modal, /ariaLabel="Общая громкость"/);
  assert.match(modal, /onValueChange=\{onMasterVolumeChange\}/);
  assert.match(modal, /onValueChange=\{onNotificationVolumeChange\}/);
  assert.match(modal, /syncAudioBusSettings\(\)/);
  assert.match(modal, /await syncAudioBusOutput\(speakerId\)/);
  assert.match(modal, /generation !== speakerChangeGeneration/);
  assert.match(modal, /await syncAudioBusOutput\(confirmedSpeakerId\)/);
});

test('output mute lets its confirmation cue finish before muting the master bus', () => {
  const bus = read('src/lib/features/room/client/services/audio-bus.ts');
  const controls = read('src/lib/features/room/client/ui/controls.ts');

  assert.match(bus, /setValueAtTime\(0, now \+ muteDelayMs \/ 1000\)/);
  assert.match(controls, /syncPlaybackMuteState\(\{ muteDelayMs: nextOutputMuted \? 220 : 0 \}\)/);
});
