// What this tab subscribes to in LiveKit: remote voices while the output is
// on, and screen shares only while someone here watches them.

import { expect, test, vi } from 'vitest';
import { fakeParticipant, fakePublication, flushMicrotasks, loadLiveKitHarness } from '../helpers/livekit-harness.ts';

function liveAudioTrack() {
  return {
    mediaStreamTrack: { kind: 'audio', readyState: 'live', id: 'mic-track' },
    mediaStream: { id: 'mic-stream' },
    receiver: { id: 'receiver' }
  };
}

test('remote voices are subscribed while the output is on and unsubscribed while deafened', async () => {
  const lk = await loadLiveKitHarness({ autoResolveClient: true });
  const mic = fakePublication('microphone', { isSubscribed: true, track: liveAudioTrack() });
  const participant = fakeParticipant('peer-a', [mic.publication]);
  lk.state.livekitRoom = { remoteParticipants: new Map([['peer-a', participant]]) };
  lk.service.syncLiveKitParticipant(participant as never);

  lk.service.syncLiveKitVoiceSubscriptions();
  expect(mic.calls.subscribed.at(-1)).toBe(true);
  expect(lk.audio.ensured).toContainEqual({ peerId: 'peer-a' });

  lk.state.outputMuted = true;
  const ensuredBefore = lk.audio.ensured.length;
  lk.service.syncLiveKitVoiceSubscriptions();
  expect(mic.calls.subscribed.at(-1)).toBe(false);
  expect(lk.audio.ensured).toHaveLength(ensuredBefore);
});

test('an unchanged subscription is not requested again', async () => {
  const lk = await loadLiveKitHarness({ autoResolveClient: true });
  const mic = fakePublication('microphone', { isDesired: true, isSubscribed: true });
  const participant = fakeParticipant('peer-a', [mic.publication]);
  lk.state.livekitRoom = { remoteParticipants: new Map([['peer-a', participant]]) };
  lk.service.syncLiveKitParticipant(participant as never);
  lk.service.syncLiveKitVoiceSubscriptions();
  expect(mic.calls.subscribed).toEqual([]);
});

test('a screen nobody here watches is not subscribed', async () => {
  const lk = await loadLiveKitHarness({ autoResolveClient: true });
  const screen = fakePublication('screen-video');
  lk.service.syncLiveKitParticipant(fakeParticipant('streamer', [screen.publication]) as never);
  await flushMicrotasks();
  expect(screen.calls.subscribed.filter(Boolean)).toEqual([]);
  expect(screen.calls.quality).toEqual([]);
});

test('a watched screen is subscribed first and then asked for high quality; a preview gets low quality', async () => {
  const lk = await loadLiveKitHarness({ autoResolveClient: true });
  const staged = fakePublication('screen-video');
  lk.state.viewedScreenPeerId = 'streamer';
  lk.service.syncLiveKitParticipant(fakeParticipant('streamer', [staged.publication]) as never);
  await flushMicrotasks();
  expect(staged.calls.subscribed).toEqual([true]);
  expect(staged.calls.quality).toEqual([2]);

  const preview = fakePublication('screen-video');
  lk.state.screenSubscribedPeerIds.add('other');
  lk.service.syncLiveKitParticipant(fakeParticipant('other', [preview.publication]) as never);
  await flushMicrotasks();
  expect(preview.calls.quality).toEqual([0]);
});

test('a subscribed screen whose track already ended is scheduled for a retry', async () => {
  const lk = await loadLiveKitHarness({ autoResolveClient: true });
  lk.state.viewedScreenPeerId = 'streamer';
  const ended = fakePublication('screen-video', {
    isDesired: true,
    isSubscribed: true,
    track: { mediaStreamTrack: { id: 't', readyState: 'ended' }, mediaStream: { id: 's' } }
  });
  lk.service.syncLiveKitParticipant(fakeParticipant('streamer', [ended.publication]) as never);
  await flushMicrotasks();
  // The retry controller coalesces requests by key (screen-subscription-retry.test.ts).
  expect(new Set(lk.retries.scheduled.map((entry) => (entry as { key?: string }).key))).toEqual(
    new Set(['screen-video-sid'])
  );
});

// Moved from screen-livekit-resync.test.ts.

test('participant resync preserves screen demand while only screen audio remains published', async () => {
  const lk = await loadLiveKitHarness();
  const existing = { id: 'peer-audio-gap', screen: true, screenAudio: true, voiceIssue: '' };
  lk.state.peers.set(existing.id, existing);
  lk.state.viewedScreenPeerId = existing.id;
  lk.state.screenSubscribedPeerIds.add(existing.id);
  const screenAudio = fakePublication('screen-audio');
  const participant = fakeParticipant(existing.id, [screenAudio.publication], { isScreenShareEnabled: false });

  const synced = lk.service.syncLiveKitParticipant(participant as never);

  expect(synced).toBe(existing);
  expect(existing).toMatchObject({ screen: true, screenAudio: true, livekitParticipant: participant });
  expect(lk.state.viewedScreenPeerId).toBe(existing.id);
  expect(lk.state.screenSubscribedPeerIds.has(existing.id)).toBe(true);
});

test('async quality demand ignores a screen publication replaced under the same SID', async () => {
  const lk = await loadLiveKitHarness();
  const stale = fakePublication('screen-video');
  const participant = fakeParticipant('peer-republished', [stale.publication]);
  lk.state.viewedScreenPeerId = participant.identity;

  const peer = lk.service.syncLiveKitParticipant(participant as never);
  expect(lk.livekitClientResolvers).toHaveLength(1);

  (participant.trackPublications as Map<string, unknown>).set(stale.publication.trackSid, {
    ...stale.publication,
    setVideoQuality() {
      throw new Error('replacement quality is handled by its own demand sync');
    }
  });
  lk.livekitClientResolvers.shift()?.();
  await flushMicrotasks();

  expect(peer?.livekitParticipant).toBe(participant);
  expect(stale.calls.quality).toEqual([]);
});

test('late screen subscription cannot override authoritative screen stop', async () => {
  const lk = await loadLiveKitHarness();
  const existing = {
    id: 'peer-late-screen',
    screen: false,
    screenAudio: false,
    screenAuthoritative: false,
    screenStream: null,
    voiceIssue: ''
  };
  lk.state.peers.set(existing.id, existing);
  lk.state.viewedScreenPeerId = existing.id;
  const screen = fakePublication('screen-video', {
    isDesired: true,
    isSubscribed: true,
    track: {
      mediaStream: { id: 'late-screen-stream' },
      mediaStreamTrack: { id: 'late-screen-track', readyState: 'live' }
    }
  });

  const synced = lk.service.syncLiveKitParticipant(fakeParticipant(existing.id, [screen.publication]) as never);

  expect(synced).toBe(existing);
  expect(lk.screenAttachments).toEqual([]);
  expect(lk.detachedScreens).toEqual([existing.id]);
  expect(screen.calls.subscribed.at(-1)).toBe(false);
  expect(existing).toMatchObject({ screen: false, screenAudio: false, screenStream: null });
});

test('a token request that races the realtime join is retried while the join is still current', async () => {
  vi.useFakeTimers();
  let attempts = 0;
  let current = true;
  const lk = await loadLiveKitHarness({
    autoResolveClient: true,
    requestToken: async () => {
      attempts += 1;
      if (attempts < 3) throw lk.refusal('not in room', 'not_in_room');
      // Stop right after the credentials arrive, before any LiveKit connection.
      current = false;
      return { token: 't', url: 'wss://lk' };
    }
  });
  const connecting = lk.service.connectLiveKitRoom('Анна', () => current);
  await vi.advanceTimersByTimeAsync(500);
  await vi.advanceTimersByTimeAsync(1_000);
  await expect(connecting).resolves.toBe(false);
  expect(attempts).toBe(3);
  vi.useRealTimers();
});

test('a token request is not retried once the join was abandoned, nor for other errors', async () => {
  vi.useFakeTimers();
  let attempts = 0;
  const lk = await loadLiveKitHarness({
    autoResolveClient: true,
    requestToken: async () => {
      attempts += 1;
      throw lk.refusal('not in room', 'not_in_room');
    }
  });
  const abandoned = lk.service.connectLiveKitRoom('Анна', () => false);
  const assertion = expect(abandoned).rejects.toThrow('not in room');
  await vi.advanceTimersByTimeAsync(500);
  await assertion;
  expect(attempts).toBe(1);

  const other = await loadLiveKitHarness({
    requestToken: async () => {
      throw new Error('room full');
    }
  });
  await expect(other.service.connectLiveKitRoom('Анна', () => true)).rejects.toThrow('room full');
  vi.useRealTimers();
});
