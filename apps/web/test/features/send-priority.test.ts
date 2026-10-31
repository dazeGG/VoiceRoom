// When the uplink is short, the voice goes first: the microphone is sent at a
// high priority and a shared screen's sound at a low one, like its video.

import { afterEach, expect, test, vi } from 'vitest';
import { loadLiveKitHarness } from '../helpers/livekit-harness';
import { FakeMediaStream, FakeMediaStreamTrack } from '../helpers/fake-media';
import { defined } from '../helpers/assert';

afterEach(() => {
  vi.doUnmock('@/entities/room/room-realtime');
});

test('the microphone is sent before a shared screen', async () => {
  const lk = await loadLiveKitHarness({ autoResolveClient: true });
  vi.doMock('@/entities/room/room-realtime', () => ({ updateVoicePeer: () => {} }));
  const published: Array<Record<string, unknown>> = [];
  lk.state.livekitRoom = {
    localParticipant: {
      trackPublications: new Map<string, unknown>(),
      publishTrack: async (track: unknown, options: Record<string, unknown>) => {
        published.push(options);
        return {
          track,
          trackSid: `sid-${published.length}`,
          source: options.source,
          mute: async () => {},
          unmute: async () => {}
        };
      },
      unpublishTrack: async () => {}
    }
  };
  lk.state.localStream = new FakeMediaStream([new FakeMediaStreamTrack('mic', 'audio')], 'mic-stream');
  lk.state.localScreenStream = new FakeMediaStream([new FakeMediaStreamTrack('sound', 'audio')], 'screen-stream');
  const publications = await import('@/features/room/client/services/livekit/local-publications');

  await publications.publishLocalMicrophone();
  await publications.publishLocalScreenTracks();

  expect(defined(published[0], 'the microphone')).toMatchObject({
    name: 'microphone',
    audioPreset: { priority: 'high' }
  });
  expect(defined(published[1], 'the screen sound')).toMatchObject({
    name: 'screen-audio',
    audioPreset: { priority: 'low' }
  });
});
