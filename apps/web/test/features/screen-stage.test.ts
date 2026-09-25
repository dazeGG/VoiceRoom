// The screen stage around a stream: its title, profile, viewers, volume
// control, and the audio-unlock fallback while a stream waits to be watched.

import { beforeEach, expect, test } from 'vitest';
import { state } from '../../src/lib/features/room/client/core/state.svelte.ts';
import { createInitialRoomState } from '../../src/lib/features/room/client/model/room-state.ts';
import { createParticipant } from '../../src/lib/features/room/client/room/participants.ts';
import { queueAudioUnlock } from '../../src/lib/features/room/client/services/media-playback-service.ts';
import { getScreenMetaView, getStreamVolumeView, screenUi } from '../../src/lib/features/room/screen-ui.svelte.ts';
import { startUi } from '../../src/lib/features/room/start-ui.svelte.ts';

beforeEach(() => {
  Object.assign(state, createInitialRoomState());
  state.peerId = 'me';
  screenUi.showMeta = true;
  startUi.soundButtonVisible = false;
});

test('a remote stream is titled by its owner, shows its profile and who is watching', () => {
  createParticipant({ id: 'me', name: 'Я' });
  const owner = createParticipant({ id: 'owner', name: 'Анна', screen: true, screenProfileId: 'high-60' });
  const viewer = createParticipant({ id: 'viewer', name: 'Борис' });
  viewer.viewedScreenPeerId = owner.id;
  state.viewedScreenPeerId = owner.id;

  const meta = getScreenMetaView();
  expect(meta?.title).toBe('Стрим Анна');
  expect(meta?.fpsLabel).toContain('60');
  expect(meta?.viewerAvatars.map((item) => item.id)).toEqual(['viewer']);
});

test('your own stream is "Ваш стрим" and has no volume slider for you', () => {
  createParticipant({ id: 'me', name: 'Я', screen: true });
  state.localScreenProfileId = 'source-5';
  state.viewedScreenPeerId = 'me';
  expect(getScreenMetaView()?.title).toBe('Ваш стрим');
  expect(getStreamVolumeView().hidden).toBe(true);
});

test('the stream volume control reflects mute and volume', () => {
  createParticipant({ id: 'owner', name: 'Анна', screen: true });
  state.viewedScreenPeerId = 'owner';
  state.screenVolume = 0.5;
  expect(getStreamVolumeView()).toMatchObject({
    hidden: false,
    valuePercent: 50,
    muted: false,
    ariaLabel: 'Выключить звук стрима'
  });
  state.screenMuted = true;
  expect(getStreamVolumeView()).toMatchObject({ muted: true, ariaLabel: 'Включить звук стрима' });
});

test('the sound fallback button waits while a remote stream is still unwatched', () => {
  createParticipant({ id: 'owner', name: 'Анна', screen: true });
  queueAudioUnlock({ showFallback: true });
  expect(state.audioUnlockPending).toBe(true);
  expect(startUi.soundButtonVisible).toBe(false);

  state.viewedScreenPeerId = 'owner';
  queueAudioUnlock({ showFallback: true });
  expect(startUi.soundButtonVisible).toBe(true);
});
