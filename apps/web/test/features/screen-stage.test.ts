// The screen stage around a stream: its title, profile, viewers, volume
// control, and the audio-unlock fallback while a stream waits to be watched.

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, expect, test } from 'vitest';
import { state } from '@/features/room/client/core/room-runtime.store';
import { createInitialRoomState } from '@/features/room/client/model/room-state.ts';
import { createParticipant } from '@/features/room/client/room/participants.ts';
import { queueAudioUnlock } from '@/features/room/client/services/media-playback-service.ts';
import { useScreenUiStore } from '@/features/room/screen-ui.store';
import { useStartUiStore } from '@/features/room/start-ui.store';

beforeEach(() => {
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  state.peerId = 'me';
  useScreenUiStore().showMeta = true;
  useStartUiStore().soundButtonVisible = false;
});

test('a remote stream is titled by its owner, shows its profile and who is watching', () => {
  createParticipant({ id: 'me', name: 'Я' });
  const owner = createParticipant({ id: 'owner', name: 'Анна', screen: true, screenProfileId: 'high-60' });
  const viewer = createParticipant({ id: 'viewer', name: 'Борис' });
  viewer.viewedScreenPeerId = owner.id;
  state.viewedScreenPeerId = owner.id;

  const meta = useScreenUiStore().getScreenMetaView();
  expect(meta?.title).toBe('Стрим Анна');
  expect(meta?.fpsLabel).toContain('60');
  expect(meta?.viewerAvatars.map((item) => item.id)).toEqual(['viewer']);
});

test('your own stream is "Ваш стрим" and has no volume slider for you', () => {
  createParticipant({ id: 'me', name: 'Я', screen: true });
  state.localScreenProfileId = 'source-5';
  state.viewedScreenPeerId = 'me';
  expect(useScreenUiStore().getScreenMetaView()?.title).toBe('Ваш стрим');
  expect(useScreenUiStore().getStreamVolumeView().hidden).toBe(true);
});

test('the stream volume control reflects mute and volume', () => {
  createParticipant({ id: 'owner', name: 'Анна', screen: true });
  state.viewedScreenPeerId = 'owner';
  state.screenVolume = 0.5;
  expect(useScreenUiStore().getStreamVolumeView()).toMatchObject({
    hidden: false,
    valuePercent: 50,
    muted: false,
    ariaLabel: 'Выключить звук стрима'
  });
  state.screenMuted = true;
  expect(useScreenUiStore().getStreamVolumeView()).toMatchObject({ muted: true, ariaLabel: 'Включить звук стрима' });
});

test('the sound fallback button waits while a remote stream is still unwatched', () => {
  createParticipant({ id: 'owner', name: 'Анна', screen: true });
  queueAudioUnlock({ showFallback: true });
  expect(state.audioUnlockPending).toBe(true);
  expect(useStartUiStore().soundButtonVisible).toBe(false);

  state.viewedScreenPeerId = 'owner';
  queueAudioUnlock({ showFallback: true });
  expect(useStartUiStore().soundButtonVisible).toBe(true);
});
