// Starting a screen share asks the server's media budget first: a busy server
// lowers the quality or refuses, and a server that does not answer is no reason
// to lose the stream.

import { expect, test, vi } from 'vitest';
import type { MediaGrant } from '@voice-room/shared/contracts/realtime';
import type * as MediaGrantModule from '../../src/lib/features/room/client/services/media-grant';

const P = '../../src/lib/features/room/client';

function fakeStream() {
  const track = {
    kind: 'video',
    readyState: 'live',
    stopped: false,
    stop() {
      this.stopped = true;
    },
    addEventListener() {},
    getSettings: () => ({ width: 1920, height: 1080 })
  };
  return {
    id: 'screen-stream',
    track,
    getTracks: () => [track],
    getVideoTracks: () => [track],
    getAudioTracks: () => []
  };
}

async function loadScreenShare(grant: MediaGrant | null, whileAsking: (state: { joined: boolean }) => void = () => {}) {
  vi.resetModules();
  const state = {
    joined: true,
    connecting: false,
    localScreenStream: null as unknown,
    localScreenPublications: new Map(),
    localScreenMode: 'games',
    localScreenProfileId: 'balanced-30',
    peerId: 'peer-self1',
    screenStarting: false,
    screenStopping: false
  };
  const stream = fakeStream();
  const showToast = vi.fn();
  const publishLocalScreenTracks = vi.fn(async () => {});
  const applyScreenCaptureProfile = vi.fn(async () => {});
  const askForMedia = vi.fn(async () => {
    whileAsking(state);
    return grant;
  });

  vi.doMock(`${P}/core/state.svelte`, () => ({ state }));
  vi.doMock(`${P}/ui/toast`, () => ({ showToast }));
  vi.doMock(`${P}/media/livekit-runtime`, () => ({
    TRACK_SOURCE: { ScreenShare: 'screen_share' },
    loadLiveKitClient: async () => ({})
  }));
  vi.doMock(`${P}/room/presence`, () => ({ postState: async () => {} }));
  vi.doMock(`${P}/services/media-playback-service`, () => ({ setLocalAppAudioSuppressed: () => {} }));
  vi.doMock(`${P}/media/cues`, () => ({ playStreamCue: () => {} }));
  vi.doMock(`${P}/ui/names`, () => ({ getDisplayName: () => 'Self' }));
  vi.doMock(`${P}/services/livekit-service`, () => ({
    publishLocalScreenTracks,
    unpublishLocalScreenTracks: async () => {}
  }));
  vi.doMock(`${P}/services/screen-capture-service`, () => ({
    applyScreenCaptureProfile,
    // The desktop picker settles the profile: here the person picked 1080p 60 FPS.
    openScreenShare: async () => ({
      mode: 'games',
      profile: (await import('../../src/lib/features/room/client/media/profiles')).getScreenProfile('high-60'),
      stream
    })
  }));
  vi.doMock(`${P}/services/desktop-screen-audio`, () => ({
    onDesktopScreenAudioLost: () => {},
    stopLocalScreenAudioCapture: () => {}
  }));
  vi.doMock(`${P}/room/participants`, () => ({ updateParticipant: () => {} }));
  vi.doMock(`${P}/core/microphone-mute`, () => ({ isMicrophoneShownMuted: () => false }));
  vi.doMock(`${P}/ui/screen-view`, () => ({
    getActiveScreenPeer: () => null,
    hideScreenStage: () => {},
    openLocalStreamPreview: () => {},
    refreshScreenMeta: () => {},
    refreshScreenStage: () => {}
  }));
  vi.doMock(`${P}/services/media-grant`, async () => ({
    ...(await vi.importActual<typeof MediaGrantModule>(`${P}/services/media-grant`)),
    askForMedia
  }));

  const service = await import('../../src/lib/features/room/client/services/screen-share-service');
  return { service, state, stream, showToast, publishLocalScreenTracks, applyScreenCaptureProfile, askForMedia };
}

test('a busy server lowers 1080p 60 FPS to 720p at the same frame rate and says so', async () => {
  const { service, state, showToast, publishLocalScreenTracks, applyScreenCaptureProfile, askForMedia } =
    await loadScreenShare({ roomId: 'room-1', kind: 'screen', granted: true, profileId: 'balanced-60' });

  await service.handleScreenButtonClick();

  expect(askForMedia).toHaveBeenCalledWith('screen', 'high-60');
  expect(applyScreenCaptureProfile).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ id: 'balanced-60' })
  );
  expect(publishLocalScreenTracks).toHaveBeenCalledTimes(1);
  expect(state.localScreenProfileId).toBe('balanced-60');
  expect(state.localScreenMode).toBe('games');
  expect(showToast).toHaveBeenCalledWith('Сервер загружен: стрим идёт в 720p 60 FPS вместо 1080p 60 FPS', {
    duration: 8000
  });
});

test('a full server refuses: the capture stops and nothing is published', async () => {
  const { service, state, stream, showToast, publishLocalScreenTracks } = await loadScreenShare({
    roomId: 'room-1',
    kind: 'screen',
    granted: false,
    reason: 'server_busy'
  });

  await service.handleScreenButtonClick();

  expect(publishLocalScreenTracks).not.toHaveBeenCalled();
  expect(stream.track.stopped).toBe(true);
  expect(state.localScreenStream).toBeNull();
  expect(showToast).toHaveBeenCalledWith(
    'Сервер сейчас загружен, демонстрация недоступна. Попробуйте через пару минут',
    {
      duration: 12000,
      variant: 'error'
    }
  );
});

test('a room at its screen-share limit says how many it runs', async () => {
  const { service, showToast } = await loadScreenShare({
    roomId: 'room-1',
    kind: 'screen',
    granted: false,
    reason: 'room_screens_full',
    maxRoomScreens: 3
  });

  await service.handleScreenButtonClick();

  expect(showToast).toHaveBeenCalledWith(
    'В комнате не больше 3 демонстраций одновременно. Дождитесь, пока одна закончится',
    expect.objectContaining({ variant: 'error' })
  );
});

test('a server that does not answer lets the stream start as asked', async () => {
  const { service, state, publishLocalScreenTracks, applyScreenCaptureProfile } = await loadScreenShare(null);

  await service.handleScreenButtonClick();

  expect(publishLocalScreenTracks).toHaveBeenCalledTimes(1);
  expect(applyScreenCaptureProfile).not.toHaveBeenCalled();
  expect(state.localScreenProfileId).toBe('high-60');
});

test('leaving the room while the server answers stops the capture instead of publishing it', async () => {
  const { service, stream, publishLocalScreenTracks } = await loadScreenShare(
    { roomId: 'room-1', kind: 'screen', granted: true, profileId: 'high-60' },
    (state) => {
      state.joined = false;
    }
  );

  await service.handleScreenButtonClick();

  expect(publishLocalScreenTracks).not.toHaveBeenCalled();
  expect(stream.track.stopped).toBe(true);
});
