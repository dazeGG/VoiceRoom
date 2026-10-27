// A microphone stream that came back without an audio track cannot be
// published. Joining fails with a message written for the user, which the
// room shows as it is (see room-join-user-error.test.ts).

import { expect, test } from 'vitest';
import { loadLiveKitHarness } from '../helpers/livekit-harness.ts';

test('joining with a stream that has no audio track fails with a message for the user', async () => {
  const lk = await loadLiveKitHarness({
    autoResolveClient: true,
    requestToken: async () => ({ token: 't', url: 'wss://lk.example' })
  });
  // The harness loads a fresh module graph; take the error class from it.
  const { UserFacingError } = await import('@/features/room/client/core/utils.ts');
  Object.assign(lk.state, {
    roomId: 'room-a',
    peerId: 'peer-1',
    sessionToken: 'session-1',
    localStream: { getAudioTracks: () => [], getTracks: () => [] }
  });

  const joining = lk.service.connectLiveKitRoom('Аня');

  await expect(joining).rejects.toBeInstanceOf(UserFacingError);
  await expect(joining).rejects.toThrow('Браузер не отдал аудио-трек');
});
