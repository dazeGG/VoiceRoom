// A deploy restarts the API and its LiveKit auth-gate, which drops the signal
// channel for up to a couple of minutes while audio keeps flowing straight to
// LiveKit. The call must keep trying to resume for that long instead of
// ending after LiveKit's default ten attempts.

import { expect, test } from 'vitest';
import {
  SIGNAL_RESUME_WINDOW_MS,
  createSignalReconnectPolicy
} from '../../src/lib/features/room/client/services/livekit/reconnect-policy.ts';
import { defined } from '../helpers/assert.ts';
import { loadLiveKitHarness } from '../helpers/livekit-harness.ts';

const atRandom = (value: number) => () => value;

test('the first attempts are as quick as LiveKit default ones', () => {
  const policy = createSignalReconnectPolicy(atRandom(0));
  const delays = [0, 1, 2, 3].map((retryCount) => policy.nextRetryDelayInMs({ retryCount, elapsedMs: 0 }));
  expect(delays).toEqual([0, 300, 1_200, 2_700]);
});

test('the call keeps resuming well past the default ten attempts', () => {
  const policy = createSignalReconnectPolicy(atRandom(0.5));
  // About two minutes into a deploy: LiveKit's default policy gave up long ago.
  const delay = policy.nextRetryDelayInMs({ retryCount: 40, elapsedMs: 120_000 });
  expect(delay).toBe(3_500);
});

test('retries are spread over a second so a call does not hit the restarted gate at once', () => {
  const early = createSignalReconnectPolicy(atRandom(0)).nextRetryDelayInMs({ retryCount: 10, elapsedMs: 30_000 });
  const late = createSignalReconnectPolicy(atRandom(1)).nextRetryDelayInMs({ retryCount: 10, elapsedMs: 30_000 });
  expect([early, late]).toEqual([3_000, 4_000]);
});

test('after five minutes without a signal the call gives up and the app recovers it from scratch', () => {
  const policy = createSignalReconnectPolicy(atRandom(0));
  expect(policy.nextRetryDelayInMs({ retryCount: 90, elapsedMs: SIGNAL_RESUME_WINDOW_MS - 1 })).not.toBeNull();
  expect(policy.nextRetryDelayInMs({ retryCount: 91, elapsedMs: SIGNAL_RESUME_WINDOW_MS })).toBeNull();
});

test('every LiveKit room of the call is created with this policy', async () => {
  const lk = await loadLiveKitHarness({
    autoResolveClient: true,
    requestToken: async () => ({ token: 't', url: 'wss://lk.example' })
  });
  Object.assign(lk.state, {
    joined: true,
    roomId: 'room-a',
    peerId: 'peer-1',
    sessionToken: 'session-1',
    localStream: null,
    livekitRoom: {
      disconnect: async () => {},
      removeAllListeners: () => {},
      remoteParticipants: new Map<string, unknown>()
    }
  });

  await lk.service.attemptFreshLiveKitReplacement({ epoch: 1, attempt: 1 });

  const policy = defined(lk.rooms[0]?.roomOptions.reconnectPolicy, 'reconnect policy');
  expect(policy.nextRetryDelayInMs({ retryCount: 40, elapsedMs: 120_000 })).not.toBeNull();
});
