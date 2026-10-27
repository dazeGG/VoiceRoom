// Relief follows the call, not the system: a game keeping the computer
// critical through a call that sounds fine relieves nothing, while a full
// window of encoders held back for CPU, of dropped video frames on a clean
// video line, or of made-up sound on a clean, steady audio line relieves the
// call once. Frames and sound only count while the system stays busy.

import { afterEach, expect, test, vi } from 'vitest';
import {
  createStrainTracker,
  noteCallStrain,
  noteCpuPressure,
  startCallStrainWatch,
  stopCallStrainWatch,
  type StrainCounts
} from '@/features/room/client/room/call-strain';
import { createInitialRoomState } from '@/features/room/client/model/room-state';
import type { CpuPressureState } from '@/features/room/client/services/cpu-pressure';
import { freshImport } from '../helpers/fresh-module';
import { clearLogBuffer, readLogBuffer } from '@/shared/log';

afterEach(() => {
  stopCallStrainWatch();
  vi.useRealTimers();
  vi.doUnmock('@/entities/room/room-realtime');
});

/** One 3-second poll of a call that sounds fine: speech both ways, nothing made up, no video. */
const poll = (counts: Partial<StrainCounts> = {}): StrainCounts => ({
  inboundPackets: 150,
  inboundLost: 0,
  inboundDiscarded: 0,
  playedSamples: 144_000,
  concealedSamples: 0,
  jitterMs: 8,
  encodeSeconds: 0,
  encodeCpuSeconds: 0,
  framesReceived: 0,
  framesDropped: 0,
  videoPackets: 0,
  videoLost: 0,
  ...counts
});

function feed(polls: number, counts: Partial<StrainCounts>, pressure: CpuPressureState | null) {
  const tracker = createStrainTracker();
  return Array.from({ length: polls }, () => tracker.note(poll(counts), pressure));
}

const none = (results: unknown[]) => results.every((result) => result === null);

test('a critical system with a call that sounds and looks fine is not strained', () => {
  expect(
    none(feed(20, { encodeSeconds: 3, framesReceived: 72, framesDropped: 1, videoPackets: 300 }, 'critical'))
  ).toBe(true);
});

test('encoders held back for CPU through a full window strain the call, even without the pressure API', () => {
  const results = feed(5, { encodeSeconds: 3, encodeCpuSeconds: 2 }, null);
  // Enough encoding from the fourth poll on, but a judgement only once the window is full.
  expect(results.slice(0, 4)).toEqual([null, null, null, null]);
  expect(results[4]).toEqual({ reason: 'encoder', pct: 66.7 });

  expect(none(feed(10, { encodeSeconds: 3, encodeCpuSeconds: 1 }, null))).toBe(true);
});

const dropping = { framesReceived: 72, framesDropped: 12, videoPackets: 300 };

test('dropped incoming frames on a clean video line strain the call after a full busy window', () => {
  const results = feed(5, dropping, 'serious');
  expect(results.slice(0, 4)).toEqual([null, null, null, null]);
  expect(results[4]).toEqual({ reason: 'frames', pct: 16.7 });
  // Frames lost on the way are dropped too: that is the line, not the computer.
  expect(none(feed(10, { ...dropping, videoLost: 9 }, 'critical'))).toBe(true);
  expect(none(feed(10, dropping, 'fair'))).toBe(true);
});

test('only polls while the system is busy count: a window begun before it turned busy blames nothing', () => {
  const tracker = createStrainTracker();
  for (let i = 0; i < 3; i += 1) expect(tracker.note(poll(dropping), 'nominal')).toBeNull();
  for (let i = 0; i < 4; i += 1) expect(tracker.note(poll(dropping), 'critical')).toBeNull();
  expect(tracker.note(poll(dropping), 'critical')).toEqual({ reason: 'frames', pct: 16.7 });
});

test('made-up sound strains the call only on a clean, steady line', () => {
  const madeUp = { concealedSamples: 7_200 };
  expect(feed(5, madeUp, 'critical')[4]).toEqual({ reason: 'sound', pct: 5 });
  // Lost, late or jittery packets explain the gaps: the line, not the computer.
  expect(none(feed(10, { ...madeUp, inboundLost: 3 }, 'critical'))).toBe(true);
  expect(none(feed(10, { ...madeUp, inboundDiscarded: 3 }, 'critical'))).toBe(true);
  expect(none(feed(10, { ...madeUp, jitterMs: 45 }, 'critical'))).toBe(true);
  expect(none(feed(10, madeUp, 'nominal'))).toBe(true);
});

test('the watch relieves once a call, logs why, and a new call starts from nothing', () => {
  clearLogBuffer();
  const relieve = vi.fn();
  startCallStrainWatch(relieve);
  noteCpuPressure('critical');
  for (let i = 0; i < 7; i += 1) noteCallStrain(poll({ concealedSamples: 7_200 }));
  expect(relieve).toHaveBeenCalledTimes(1);
  expect(relieve).toHaveBeenCalledWith({ reason: 'sound', pct: 5 });
  expect(readLogBuffer().filter((entry) => entry.msg === 'call strained')).toMatchObject([
    { level: 'warn', ctx: { reason: 'sound', pct: 5, pressure: 'critical' } }
  ]);

  // The next call forgets the pressure: made-up sound with no pressure reading is not the computer.
  const next = vi.fn();
  startCallStrainWatch(next);
  for (let i = 0; i < 7; i += 1) noteCallStrain(poll({ concealedSamples: 7_200 }));
  expect(next).not.toHaveBeenCalled();

  stopCallStrainWatch();
  noteCpuPressure('critical');
  for (let i = 0; i < 7; i += 1) noteCallStrain(poll({ concealedSamples: 7_200 }));
  expect(next).not.toHaveBeenCalled();
});

type Entry = { id: string } & Record<string, unknown>;
const report = (entries: Entry[]) => ({
  forEach: (callback: (value: unknown) => void) => entries.forEach((entry) => callback(entry))
});

async function loadStatsPoll() {
  vi.useFakeTimers();
  vi.doMock('@/entities/room/room-realtime', () => ({ updateVoicePeer: () => {} }));
  const stats = await freshImport(() => import('@/features/room/client/room/stats'));
  const strain = await import('@/features/room/client/room/call-strain');
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  Object.assign(state, createInitialRoomState());
  return { stats, strain, state };
}

test('the stats poll counts each camera once over its simulcast layers, from their baseline', async () => {
  const { stats, strain, state } = await loadStatsPoll();
  let seconds = 0;
  // Two layers of one camera; long before the first poll the encoder had run 100 s, all held back.
  const layer = (id: string) => ({
    id,
    type: 'outbound-rtp',
    kind: 'video',
    mediaSourceId: 'camera-source',
    qualityLimitationDurations: { none: seconds / 3, cpu: 100 + (seconds * 2) / 3 }
  });
  const camera = { getRTCStatsReport: async () => report([layer('cam-high'), layer('cam-low')]) };
  const remoteCamera = {
    getRTCStatsReport: vi.fn(async () =>
      report([{ id: 'peer-in', type: 'inbound-rtp', kind: 'video', framesReceived: 0, framesDropped: 0 }])
    )
  };
  Object.assign(state, {
    joined: true,
    localCameraPublication: { track: camera },
    peers: new Map([
      [
        'peer-a',
        {
          livekitParticipant: {
            audioTrackPublications: new Map<string, unknown>(),
            videoTrackPublications: new Map([['v', { track: remoteCamera }]])
          }
        }
      ]
    ])
  });

  const relieve = vi.fn();
  strain.startCallStrainWatch(relieve);
  stats.startPeerLatencyStats();
  await vi.advanceTimersByTimeAsync(0);
  // A camera encoding 2 s of each poll (a stalled encoder). The baseline and
  // four polls fill the window with 8 s of encoding counted once: too little to
  // judge. Counted per layer it would be 16 s, and the call relieved.
  for (let i = 0; i < 4; i += 1) {
    seconds += 2;
    await vi.advanceTimersByTimeAsync(3_000);
  }
  expect(relieve).not.toHaveBeenCalled();
  expect(remoteCamera.getRTCStatsReport).not.toHaveBeenCalled();

  // One more poll: the last five hold 10 s, two thirds of it held back for CPU.
  seconds += 2;
  await vi.advanceTimersByTimeAsync(3_000);
  stats.stopPeerLatencyStats();
  expect(relieve).toHaveBeenCalledTimes(1);
  expect(relieve).toHaveBeenCalledWith({ reason: 'encoder', pct: 66.7 });
});

test('while the system is busy the poll reads other cameras and their dropped frames on a clean line', async () => {
  const { stats, strain, state } = await loadStatsPoll();
  let polls = 0;
  const remoteCamera = {
    // 72 frames and 300 packets a poll, 12 frames dropped, none lost.
    getRTCStatsReport: vi.fn(async () =>
      report([
        {
          id: 'peer-in',
          type: 'inbound-rtp',
          kind: 'video',
          framesReceived: 72 * polls,
          framesDropped: 12 * polls,
          packetsReceived: 300 * polls,
          packetsLost: 0
        }
      ])
    )
  };
  Object.assign(state, {
    joined: true,
    peers: new Map([
      [
        'peer-a',
        {
          livekitParticipant: {
            audioTrackPublications: new Map<string, unknown>(),
            videoTrackPublications: new Map([['v', { track: remoteCamera }]])
          }
        }
      ]
    ])
  });

  const relieve = vi.fn();
  strain.startCallStrainWatch(relieve);
  strain.noteCpuPressure('critical');
  stats.startPeerLatencyStats();
  await vi.advanceTimersByTimeAsync(0);
  // The first reading is the baseline; five more fill the busy window.
  for (polls = 1; polls <= 5; polls += 1) await vi.advanceTimersByTimeAsync(3_000);
  stats.stopPeerLatencyStats();

  expect(remoteCamera.getRTCStatsReport).toHaveBeenCalledTimes(6);
  expect(relieve).toHaveBeenCalledWith({ reason: 'frames', pct: 16.7 });
});
