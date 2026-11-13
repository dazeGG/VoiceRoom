import { createPinia, setActivePinia } from 'pinia';
import { expect, test, vi } from 'vitest';
import { FakeMediaStream, FakeMediaStreamTrack } from '../helpers/fake-media';
import { state } from '@/features/room/client/core/room-runtime.store';
import { createInitialRoomState } from '@/features/room/client/model/room-state';
import { acquireMicrophoneForJoin, ensureCurrentMicrophonePublication } from '@/features/room/client/ui/devices';
import { clearLogBuffer, readLogBuffer } from '@/shared/log';

vi.mock('@/features/room/client/media/livekit-runtime', () => ({
  loadLiveKitClient: async () => ({ Track: { Source: { Microphone: 'microphone' } } })
}));

test('post-publish mute rejection detaches under the same lease and quarantines rejected cleanup', async () => {
  clearLogBuffer();
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
  const track = new FakeMediaStreamTrack('mute-reject-output', 'audio');
  const stream = new FakeMediaStream([track]);
  const publication = {
    track,
    mute: vi.fn(async () => {
      throw new Error('mute rejected');
    }),
    unmute: vi.fn(async () => {})
  };
  const room = {
    localParticipant: {
      trackPublications: new Map<string, unknown>(),
      publishTrack: vi.fn(async () => publication),
      unpublishTrack: vi.fn(async () => {
        throw new Error('detach rejected');
      })
    }
  };
  Object.assign(state, { joined: true, livekitRoom: room, localStream: stream, localRawStream: stream, muted: true });
  expect(await ensureCurrentMicrophonePublication()).toBe('failed');
  expect(room.localParticipant.publishTrack).toHaveBeenCalledOnce();
  expect(publication.mute).toHaveBeenCalledOnce();
  expect(room.localParticipant.unpublishTrack).toHaveBeenCalledOnce();
  expect(state.localMicPublication).toBeNull();
  expect(await acquireMicrophoneForJoin(() => true)).toBeNull();
  expect(
    readLogBuffer().filter((entry) => entry.ns === 'room:devices' && entry.msg === 'microphone publication failed')
  ).toHaveLength(1);
});
