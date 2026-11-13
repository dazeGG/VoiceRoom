import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import type { reportVoicePoll } from '@/entities/room/room-realtime';
import { freshImport, stubWindow } from '../helpers/fresh-module';

type Entry = { id: string } & Record<string, unknown>;
const report = (entries: Entry[]) => ({
  forEach: (callback: (value: unknown) => void) => entries.forEach((entry) => callback(entry))
});
const outbound = (sent: number, rtt = 0.05) =>
  report([
    { id: 'out', type: 'outbound-rtp', kind: 'audio', packetsSent: sent },
    { id: 'remote', type: 'remote-inbound-rtp', kind: 'audio', packetsLost: 0 },
    {
      id: 'pair',
      type: 'candidate-pair',
      state: 'succeeded',
      selected: true,
      timestamp: sent * 10,
      responsesReceived: sent,
      currentRoundTripTime: rtt
    }
  ]);
const inbound = (received: number) =>
  report([{ id: 'in', type: 'inbound-rtp', kind: 'audio', packetsReceived: received, packetsLost: 0 }]);
const video = (seconds: number) =>
  report([
    {
      id: 'video',
      type: 'outbound-rtp',
      kind: 'video',
      qualityLimitationDurations: { none: seconds, cpu: 0 }
    }
  ]);

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.doUnmock('@/entities/room/room-realtime');
});

async function loadPoll() {
  vi.useFakeTimers();
  const polls: Array<Parameters<typeof reportVoicePoll>[0]> = [];
  vi.doMock('@/entities/room/room-realtime', () => ({
    updateVoicePeer: () => {},
    reportVoicePoll: (payload: Parameters<typeof reportVoicePoll>[0]) => polls.push(payload)
  }));
  const stats = await freshImport(() => import('@/features/room/client/room/stats'));
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  const strain = await import('@/features/room/client/room/call-strain');
  const noteStrain = vi.spyOn(strain, 'noteCallStrain');
  Object.assign(state, { joined: true, roomId: 'first', peerId: 'self', sessionToken: 'session-one' });
  onTestFinished(stats.stopPeerLatencyStats);
  return { stats, state, polls, noteStrain };
}

test('a slow stats request stays single-flight across timer ticks and polling resumes after it settles', async () => {
  const { stats, state, polls } = await loadPoll();
  const pending = Promise.withResolvers<ReturnType<typeof report>>();
  const read = vi.fn(() => pending.promise);
  Object.assign(state, { localMicPublication: { track: { getRTCStatsReport: read } } });
  stats.startPeerLatencyStats();
  await vi.advanceTimersByTimeAsync(9_000);
  expect(read).toHaveBeenCalledTimes(1);
  expect(polls).toHaveLength(0);
  pending.resolve(outbound(100));
  await vi.advanceTimersByTimeAsync(0);
  expect(polls).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(3_000);
  expect(read).toHaveBeenCalledTimes(2);
  expect(polls).toHaveLength(2);
});

test('a stopped call cannot report late RTT or overwrite the new call outbound baseline', async () => {
  const { stats, state, polls } = await loadPoll();
  const pending = Promise.withResolvers<ReturnType<typeof report>>();
  Object.assign(state, { localMicPublication: { track: { getRTCStatsReport: () => pending.promise } } });
  stats.startPeerLatencyStats();
  stats.stopPeerLatencyStats();
  const read = vi.fn().mockResolvedValueOnce(outbound(100)).mockResolvedValue(outbound(120));
  Object.assign(state, { roomId: 'second', localMicPublication: { track: { getRTCStatsReport: read } } });
  stats.startPeerLatencyStats();
  await vi.advanceTimersByTimeAsync(0);
  expect(polls).toHaveLength(1);
  pending.resolve(outbound(900, 9));
  await vi.advanceTimersByTimeAsync(0);
  expect(polls).toHaveLength(1);
  expect(state.localPingMs).toBeNull(); // the new room starts with an RTT baseline
  await vi.advanceTimersByTimeAsync(3_000);
  expect(polls.at(-1)?.uplink).toEqual({ packets: 20, lost: 0 });
  expect(state.localPingMs).toBe(50);
});

test('sparse RTCP reports only new RTT samples while the UI briefly holds its last ping', async () => {
  const { stats, state, polls } = await loadPoll();
  const rtcp = (timestamp: number, measurements: number) =>
    report([
      { id: 'out', type: 'outbound-rtp', kind: 'audio', packetsSent: measurements * 10 },
      { id: 'pair', type: 'candidate-pair', state: 'succeeded', selected: true, currentRoundTripTime: 0 },
      {
        id: 'rtcp',
        type: 'remote-inbound-rtp',
        kind: 'audio',
        timestamp,
        roundTripTime: 0.1,
        roundTripTimeMeasurements: measurements
      }
    ]);
  const read = vi
    .fn()
    .mockResolvedValueOnce(rtcp(0, 1))
    .mockResolvedValueOnce(rtcp(3000, 2))
    .mockResolvedValueOnce(rtcp(3000, 2))
    .mockResolvedValueOnce(rtcp(9000, 3))
    .mockResolvedValueOnce(rtcp(9000, 3))
    .mockResolvedValueOnce(rtcp(15_000, 4))
    .mockResolvedValue(rtcp(15_000, 4));
  Object.assign(state, { localMicPublication: { track: { getRTCStatsReport: read } } });
  stats.startPeerLatencyStats();
  await vi.advanceTimersByTimeAsync(3_000);
  expect(polls.at(-1)).toMatchObject({ rttMs: 100 });
  await vi.advanceTimersByTimeAsync(3_000);
  expect(polls.at(-1)).toMatchObject({ rttMs: null, rttUnchanged: true });
  expect(state.localPingMs).toBe(100);
  await vi.advanceTimersByTimeAsync(9_000);
  expect(polls.at(-1)).toMatchObject({ rttMs: 100 });
  await vi.advanceTimersByTimeAsync(9_000);
  expect(polls.at(-1)).toMatchObject({ rttMs: null });
  expect(polls.at(-1)).not.toHaveProperty('rttUnchanged');
  expect(state.localPingMs).toBeNull();
});

test('an obsolete rejected stats read cannot clear the new call measured RTT', async () => {
  const { stats, state } = await loadPoll();
  const old = Promise.withResolvers<ReturnType<typeof report>>();
  Object.assign(state, { localMicPublication: { track: { getRTCStatsReport: () => old.promise } } });
  stats.startPeerLatencyStats();
  stats.stopPeerLatencyStats();
  const read = vi.fn().mockResolvedValueOnce(outbound(100)).mockResolvedValue(outbound(120));
  Object.assign(state, { roomId: 'second', localMicPublication: { track: { getRTCStatsReport: read } } });
  stats.startPeerLatencyStats();
  await vi.advanceTimersByTimeAsync(3_000);
  expect(state.localPingMs).toBe(50);

  old.reject(new Error('obsolete sender disappeared'));
  await vi.advanceTimersByTimeAsync(0);
  expect(state.localPingMs).toBe(50);
});

test('an old finally cannot unlock the next call pending poll', async () => {
  const { stats, state, polls } = await loadPoll();
  const old = Promise.withResolvers<ReturnType<typeof report>>();
  const current = Promise.withResolvers<ReturnType<typeof report>>();
  Object.assign(state, { localMicPublication: { track: { getRTCStatsReport: () => old.promise } } });
  stats.startPeerLatencyStats();
  stats.stopPeerLatencyStats();
  const read = vi.fn(() => current.promise);
  Object.assign(state, { localMicPublication: { track: { getRTCStatsReport: read } } });
  stats.startPeerLatencyStats();
  expect(read).toHaveBeenCalledOnce();
  old.resolve(outbound(900));
  await vi.advanceTimersByTimeAsync(9_000);
  expect(read).toHaveBeenCalledOnce();
  expect(polls).toHaveLength(0);
  current.resolve(outbound(100));
  await vi.advanceTimersByTimeAsync(0);
  expect(polls).toHaveLength(1);
});

test.each(['room', 'microphone'])(
  'a replaced %s can start polling before an obsolete request settles',
  async (changed) => {
    const { stats, state, polls } = await loadPoll();
    const old = Promise.withResolvers<ReturnType<typeof report>>();
    const read = vi
      .fn()
      .mockImplementationOnce(() => old.promise)
      .mockResolvedValue(outbound(100));
    Object.assign(state, { localMicPublication: { track: { getRTCStatsReport: read } } });
    stats.startPeerLatencyStats();
    if (changed === 'room') Object.assign(state, { livekitRoom: {} });
    else Object.assign(state, { localMicPublication: { track: { getRTCStatsReport: read } } });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(polls).toHaveLength(1);
    old.resolve(outbound(900, 9));
    await vi.advanceTimersByTimeAsync(0);
    expect(polls).toHaveLength(1);
    expect(state.localPingMs).toBeNull(); // a new room or publication starts with an RTT baseline
  }
);

test('a late inbound report cannot seed the next call incoming packet baseline', async () => {
  const { stats, state, polls } = await loadPoll();
  const old = Promise.withResolvers<ReturnType<typeof report>>();
  const oldRead = vi.fn(() => old.promise);
  const peers = (read: () => Promise<ReturnType<typeof report>>) =>
    new Map([
      [
        'peer',
        {
          livekitParticipant: {
            audioTrackPublications: new Map([['mic', { source: 'microphone', track: { getRTCStatsReport: read } }]])
          }
        }
      ]
    ]);
  Object.assign(state, { peers: peers(oldRead) });
  stats.startPeerLatencyStats();
  await vi.advanceTimersByTimeAsync(0);
  expect(oldRead).toHaveBeenCalledOnce();
  stats.stopPeerLatencyStats();
  const read = vi.fn().mockResolvedValueOnce(inbound(100)).mockResolvedValue(inbound(120));
  Object.assign(state, { peers: peers(read) });
  stats.startPeerLatencyStats();
  await vi.advanceTimersByTimeAsync(0);
  old.resolve(inbound(900));
  await vi.advanceTimersByTimeAsync(0);
  expect(polls).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(3_000);
  expect(polls.at(-1)?.heard).toEqual([{ peerId: 'peer', packets: 20, lost: 0, concealedSamples: 0, gaps: 0 }]);
});

test('a late video report cannot seed the next call encoder baseline', async () => {
  const { stats, state, polls, noteStrain } = await loadPoll();
  const old = Promise.withResolvers<ReturnType<typeof report>>();
  const oldRead = vi.fn(() => old.promise);
  Object.assign(state, { localCameraPublication: { track: { getRTCStatsReport: oldRead } } });
  stats.startPeerLatencyStats();
  await vi.advanceTimersByTimeAsync(0);
  expect(oldRead).toHaveBeenCalledOnce();
  stats.stopPeerLatencyStats();
  const read = vi.fn().mockResolvedValueOnce(video(10)).mockResolvedValue(video(12));
  Object.assign(state, { localCameraPublication: { track: { getRTCStatsReport: read } } });
  stats.startPeerLatencyStats();
  await vi.advanceTimersByTimeAsync(0);
  old.resolve(video(900));
  await vi.advanceTimersByTimeAsync(0);
  expect(polls).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(3_000);
  expect(noteStrain).toHaveBeenLastCalledWith(expect.objectContaining({ encodeSeconds: 2 }));
});

test('a late desktop IPC response cannot overwrite the next call CPU baseline', async () => {
  const { stats, polls } = await loadPoll();
  const old = Promise.withResolvers<{ appCpuMs: number; systemBusyMs: number; systemTotalMs: number }>();
  const read = vi
    .fn()
    .mockImplementationOnce(() => old.promise)
    .mockResolvedValueOnce({ appCpuMs: 1000, systemBusyMs: 4000, systemTotalMs: 10000 })
    .mockResolvedValue({ appCpuMs: 1200, systemBusyMs: 5000, systemTotalMs: 12000 });
  stubWindow({ voiceRoomDesktopLoad: { read } });
  stats.startPeerLatencyStats();
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledOnce();
  stats.stopPeerLatencyStats();
  stats.startPeerLatencyStats();
  await vi.advanceTimersByTimeAsync(0);
  old.resolve({ appCpuMs: 900, systemBusyMs: 2000, systemTotalMs: 8000 });
  await vi.advanceTimersByTimeAsync(0);
  expect(polls).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(3_000);
  expect(polls.at(-1)?.cpu).toMatchObject({ appPct: 10, systemPct: 50 });
});

test('a rejected stats request releases the poll for the next timer tick', async () => {
  const { stats, state, polls } = await loadPoll();
  const read = vi
    .fn()
    .mockRejectedValueOnce(new Error('stats unavailable'))
    .mockResolvedValueOnce(outbound(100))
    .mockResolvedValue(outbound(120));
  Object.assign(state, { localMicPublication: { track: { getRTCStatsReport: read } } });
  stats.startPeerLatencyStats();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(3_000);
  expect(read).toHaveBeenCalledTimes(2);
  expect(polls).toHaveLength(2);
  expect(polls.at(-1)?.rttMs).toBeNull(); // first successful reading establishes the baseline
  await vi.advanceTimersByTimeAsync(3_000);
  expect(polls.at(-1)?.rttMs).toBe(50);
});
