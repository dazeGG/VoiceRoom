import { createPinia, setActivePinia } from 'pinia';
import { expect, test, vi } from 'vitest';
import { FakeMediaStream, FakeMediaStreamTrack } from '../../../../apps/web/test/helpers/fake-media';
import { state } from '@voiceroom/call/engine/core/room-runtime.store';
import { createInitialRoomState } from '@voiceroom/call/engine/model/room-state';
import { acquireMicrophoneForJoin, ensureCurrentMicrophonePublication } from '@voiceroom/call/engine/ui/devices';
import { clearLogBuffer, readLogBuffer } from '@/shared/log';
import { installWebCallPortsForTest } from '../../../../apps/web/test/helpers/call-ports';

vi.mock('@voiceroom/call/engine/media/livekit-runtime', () => ({
  loadLiveKitClient: async () => ({ Track: { Source: { Microphone: 'microphone' } } })
}));

test('post-publish mute rejection detaches under the same lease and quarantines rejected cleanup', async () => {
  clearLogBuffer();
  setActivePinia(createPinia());
  await installWebCallPortsForTest();
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
