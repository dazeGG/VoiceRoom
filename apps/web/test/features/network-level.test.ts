// The connection as the client judges it for the admin panel: loss, latency,
// jitter and a dropped link make a poll good, unstable or bad by the shared
// thresholds; a level needs two of the last five polls, goes to the server
// only when it changes and not more often than every few seconds, a level that
// could not go out is tried again, a new call starts from nothing, and the
// full peer state carries the level to a seat the server made afresh.

import { beforeEach, expect, test, vi } from 'vitest';
import {
  NETWORK_MIN_SEND_GAP_MS,
  createNetworkLevelTracker,
  readingLevel,
  type NetworkReading
} from '../../src/lib/features/room/client/room/network-level.ts';
import type { NetworkLevel } from '@voice-room/shared/contracts/rooms';
import { NETWORK_THRESHOLDS } from '@voice-room/shared/network-quality';
import { state } from '../../src/lib/features/room/client/core/state.svelte.ts';
import { createInitialRoomState } from '../../src/lib/features/room/client/model/room-state.ts';
import { noteNetworkReading, resetNetworkLevel } from '../../src/lib/features/room/client/room/network-report.ts';
import { postState } from '../../src/lib/features/room/client/room/presence.ts';

const updateVoicePeer = vi.hoisted(() => vi.fn((_payload: { roomId: string; patch: Record<string, unknown> }) => {}));
vi.mock('$lib/entities/room/room-realtime', () => ({ updateVoicePeer }));

beforeEach(() => {
  Object.assign(state, createInitialRoomState());
  updateVoicePeer.mockClear();
  resetNetworkLevel();
});

const fine = { inboundLossPct: 0, outboundLossPct: 0, jitterMs: 5, rttMs: 40, transport: 'udp' as const };

function reading(sample: Partial<NetworkReading['sample']> = {}, extra: Partial<NetworkReading> = {}): NetworkReading {
  return { sample: { ...fine, ...sample }, quality: 'excellent', voice: 'connected', ...extra };
}

test('a poll is bad on heavy loss, a long round trip or a dropped link, unstable on lighter trouble', () => {
  expect(readingLevel(reading())).toBe('good');
  expect(readingLevel(reading({ inboundLossPct: NETWORK_THRESHOLDS.unstable.lossPct }))).toBe('unstable');
  expect(readingLevel(reading({ outboundLossPct: 12 }))).toBe('bad');
  expect(readingLevel(reading({ rttMs: 300 }))).toBe('unstable');
  expect(readingLevel(reading({ rttMs: 900 }))).toBe('bad');
  expect(readingLevel(reading({ jitterMs: 45 }))).toBe('unstable');
  expect(readingLevel(reading({ jitterMs: 70 }))).toBe('bad');
  // LiveKit's rating stands in for missing numbers.
  const unmeasured = { inboundLossPct: null, outboundLossPct: null, jitterMs: null, rttMs: null };
  expect(readingLevel(reading(unmeasured, { quality: 'good' }))).toBe('good');
  expect(readingLevel(reading({}, { quality: 'poor' }))).toBe('unstable');
  expect(readingLevel(reading({}, { quality: 'lost' }))).toBe('bad');
  expect(readingLevel(reading({}, { voice: 'reconnecting' }))).toBe('bad');
  // A poll that measured nothing says nothing.
  const empty = { inboundLossPct: null, outboundLossPct: null, jitterMs: null, rttMs: null };
  expect(readingLevel(reading(empty, { quality: 'unknown' }))).toBeNull();
});

test('a level needs two polls of five and is sent once per change, a few seconds apart at most', () => {
  let now = 0;
  const sent: NetworkLevel[] = [];
  const tracker = createNetworkLevelTracker(
    (level) => sent.push(level) > 0,
    () => now
  );
  const poll = (sample: Partial<NetworkReading['sample']> = {}) => {
    tracker.note(reading(sample));
    now += 3_000;
  };

  poll();
  expect(sent).toEqual([]);
  poll();
  expect(sent).toEqual(['good']);
  poll();
  poll();
  expect(sent).toEqual(['good']);

  // One spike is not a bad network; a second within the window is.
  poll({ inboundLossPct: 20 });
  expect(sent).toEqual(['good']);
  poll({ inboundLossPct: 20 });
  expect(sent).toEqual(['good', 'bad']);

  // Back to good once at most one poll of five is not; the gap holds the change back.
  poll();
  poll();
  poll();
  poll();
  expect(sent).toEqual(['good', 'bad', 'good']);
  expect(NETWORK_MIN_SEND_GAP_MS).toBeGreaterThan(3_000);

  // A flap right after a change waits out the gap, then the level that holds is sent.
  poll({ rttMs: 300 });
  poll({ rttMs: 300 });
  poll({ rttMs: 300 });
  expect(sent).toEqual(['good', 'bad', 'good']);
  poll({ rttMs: 300 });
  expect(sent).toEqual(['good', 'bad', 'good', 'unstable']);

  // A new call starts from nothing: the level is sent again.
  tracker.reset();
  now += NETWORK_MIN_SEND_GAP_MS;
  poll({ rttMs: 300 });
  poll({ rttMs: 300 });
  expect(sent.at(-1)).toBe('unstable');
  expect(sent).toHaveLength(5);
});

test('a level that could not go out is tried again on the next poll', () => {
  let online = false;
  const sent: NetworkLevel[] = [];
  const tracker = createNetworkLevelTracker((level) => online && sent.push(level) > 0);
  tracker.note(reading());
  tracker.note(reading());
  expect(sent).toEqual([]);
  expect(tracker.current()).toBeNull();
  online = true;
  tracker.note(reading());
  expect(sent).toEqual(['good']);
  expect(tracker.current()).toBe('good');
});

test('the level goes out in a patch of its own, and again with the full peer state', async () => {
  Object.assign(state, { joined: true, roomId: 'kitchen', peerId: 'peer-12345678', sessionToken: 's'.repeat(32) });
  noteNetworkReading(reading({ rttMs: 300 }));
  noteNetworkReading(reading({ rttMs: 300 }));
  expect(updateVoicePeer).toHaveBeenCalledTimes(1);
  expect(updateVoicePeer.mock.calls[0]?.[0]).toMatchObject({ roomId: 'kitchen', patch: { network: 'unstable' } });

  // The snapshot of a seat the server made afresh posts the state, the level with it.
  await postState();
  const full = updateVoicePeer.mock.calls[1]?.[0].patch;
  expect(typeof full?.muted).toBe('boolean');
  expect(full?.network).toBe('unstable');

  // Out of the call nothing is sent, and the level waits for the next poll.
  updateVoicePeer.mockClear();
  resetNetworkLevel();
  state.joined = false;
  noteNetworkReading(reading());
  noteNetworkReading(reading());
  expect(updateVoicePeer).not.toHaveBeenCalled();
});
