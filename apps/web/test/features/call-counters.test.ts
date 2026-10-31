// The stats poll turns the browser's ever-growing counters into each poll's
// own share, so the call's account sums every packet and sample exactly once:
// the first reading of a stream counts from its start, upstream counters and
// the connection's round trips start from a baseline, and concealment that
// only filled in silence is not counted as heard.

import { afterEach, expect, test, vi } from 'vitest';
import { freshImport } from '../helpers/fresh-module';
import { defined } from '../helpers/assert';

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('@/entities/room/room-realtime');
});

type Entry = { id: string } & Record<string, unknown>;
const report = (entries: Entry[]) => ({
  forEach: (callback: (value: unknown) => void) => entries.forEach((entry) => callback(entry))
});

test('two polls of growing counters add up to the exact loss, concealment and round trip of the call', async () => {
  vi.useFakeTimers();
  vi.doMock('@/entities/room/room-realtime', () => ({ updateVoicePeer: () => {}, reportVoicePoll: () => {} }));
  const stats = await freshImport(() => import('@/features/room/client/room/stats'));
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  const quality = await import('@/features/room/client/room/call-quality');

  let pollNo = 0;
  const readings = [
    {
      inbound: {
        packetsLost: 0,
        packetsReceived: 100,
        totalSamplesReceived: 96_000,
        concealedSamples: 2_000,
        silentConcealedSamples: 2_000
      },
      outbound: { packetsSent: 100, packetsLost: 0, totalRoundTripTime: 0.1, responsesReceived: 2 }
    },
    {
      inbound: {
        packetsLost: 2,
        packetsReceived: 298,
        totalSamplesReceived: 288_000,
        concealedSamples: 6_800,
        silentConcealedSamples: 2_000
      },
      outbound: { packetsSent: 300, packetsLost: 3, totalRoundTripTime: 0.3, responsesReceived: 6 }
    }
  ];
  const now = () => defined(readings[Math.min(pollNo, readings.length - 1)], 'reading');
  const inboundTrack = {
    getRTCStatsReport: async () => report([{ id: 'in-1', type: 'inbound-rtp', kind: 'audio', ...now().inbound }])
  };
  const micTrack = {
    getRTCStatsReport: async () => {
      const { packetsSent, packetsLost, totalRoundTripTime, responsesReceived } = now().outbound;
      return report([
        { id: 'out-1', type: 'outbound-rtp', kind: 'audio', packetsSent },
        { id: 'rin-1', type: 'remote-inbound-rtp', kind: 'audio', packetsLost },
        {
          id: 'pair',
          type: 'candidate-pair',
          state: 'succeeded',
          nominated: true,
          currentRoundTripTime: 0.05,
          totalRoundTripTime,
          responsesReceived
        }
      ]);
    }
  };
  Object.assign(state, {
    joined: true,
    localMicPublication: { track: micTrack },
    peers: new Map([
      ['peer-a', { livekitParticipant: { audioTrackPublications: new Map([['a', { track: inboundTrack }]]) } }]
    ])
  });

  quality.startCallQuality(0);
  stats.startPeerLatencyStats();
  await vi.advanceTimersByTimeAsync(0);
  pollNo = 1;
  await vi.advanceTimersByTimeAsync(3_000);
  stats.stopPeerLatencyStats();

  const call = defined(quality.finishCallQuality(60_000), 'the call quality summary').stats;
  expect(call).toMatchObject({
    // 2 of 300 incoming packets, counted from the stream's start.
    inboundPackets: 300,
    inboundLostPackets: 2,
    inboundLossAvgPct: 0.7,
    // Upstream counts from the first reading on: 3 of 200.
    outboundPackets: 200,
    outboundLostPackets: 3,
    outboundLossAvgPct: 1.5,
    // 0.2 s over 4 checks since the first reading.
    rttAvgMs: 50,
    // 4 800 audible of 288 000 played; the 2 000 that filled silence do not count.
    concealedAvgPct: 1.7
  });
});

test("each poll tells the server what this tab heard of every speaker's microphone over the poll", async () => {
  vi.useFakeTimers();
  const polls: unknown[] = [];
  vi.doMock('@/entities/room/room-realtime', () => ({
    updateVoicePeer: () => {},
    reportVoicePoll: (payload: unknown) => polls.push(payload)
  }));
  const stats = await freshImport(() => import('@/features/room/client/room/stats'));
  const { state } = await import('@/features/room/client/core/room-runtime.store');

  let pollNo = 0;
  const voiceOf = (packets: number, lost: number, concealed: number, gaps: number, buffered: number) => ({
    packetsReceived: packets - lost,
    packetsLost: lost,
    concealedSamples: concealed,
    silentConcealedSamples: 0,
    concealmentEvents: gaps,
    jitterBufferDelay: buffered,
    jitterBufferEmittedCount: packets * 960
  });
  const readings = [voiceOf(150, 0, 0, 0, 7_200), voiceOf(300, 10, 9_600, 4, 21_600)];
  const audio = (id: string) => ({
    getRTCStatsReport: async () =>
      report([
        { id, type: 'inbound-rtp', kind: 'audio', ...defined(readings[Math.min(pollNo, readings.length - 1)], 'r') }
      ])
  });
  const mic = {
    getRTCStatsReport: async () =>
      report([
        { id: 'out-1', type: 'outbound-rtp', kind: 'audio', packetsSent: 150 * (pollNo + 1) },
        { id: 'rin-1', type: 'remote-inbound-rtp', kind: 'audio', packetsLost: 3 * pollNo },
        { id: 'pair', type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.08 }
      ])
  };
  const publications = new Map([
    ['mic', { source: 'microphone', track: audio('in-mic') }],
    // Screen audio is not the voice the status speaks of.
    ['screen', { source: 'screen_share_audio', track: audio('in-screen') }]
  ]);
  Object.assign(state, {
    joined: true,
    roomId: 'kitchen',
    peerId: 'peer-self-1',
    sessionToken: 's'.repeat(32),
    localMicPublication: { track: mic },
    peers: new Map([['peer-anna-1', { livekitParticipant: { audioTrackPublications: publications } }]])
  });

  stats.startPeerLatencyStats();
  await vi.advanceTimersByTimeAsync(0);
  pollNo = 1;
  await vi.advanceTimersByTimeAsync(3_000);
  stats.stopPeerLatencyStats();

  expect(polls.at(-1)).toEqual({
    roomId: 'kitchen',
    peerId: 'peer-self-1',
    sessionToken: 's'.repeat(32),
    rttMs: 80,
    // 14 400 s of waiting summed over 144 000 samples: 100 ms a sample.
    jitterBufferMs: 100,
    uplink: { packets: 150, lost: 3 },
    transport: null,
    heard: [{ peerId: 'peer-anna-1', packets: 150, lost: 10, concealedSamples: 9_600, gaps: 4 }]
  });
});

test("the desktop app's CPU totals give VoiceRoom's share of the computer apart from the whole computer's", async () => {
  vi.useFakeTimers();
  vi.doMock('@/entities/room/room-realtime', () => ({ updateVoicePeer: () => {}, reportVoicePoll: () => {} }));
  const stats = await freshImport(() => import('@/features/room/client/room/stats'));
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  const quality = await import('@/features/room/client/room/call-quality');

  // Eight cores for 3 s are 24 000 ms of core time a poll; a game keeps 80 % of it busy.
  const readings = [
    { appCpuMs: 900_000, systemBusyMs: 5_000_000, systemTotalMs: 9_000_000 },
    { appCpuMs: 901_200, systemBusyMs: 5_019_200, systemTotalMs: 9_024_000 },
    { appCpuMs: 904_800, systemBusyMs: 5_038_400, systemTotalMs: 9_048_000 },
    // The app restarted its totals (a new window process tree): no poll, no harm.
    { appCpuMs: 10, systemBusyMs: 5_057_600, systemTotalMs: 9_072_000 },
    { appCpuMs: 'broken' }
  ];
  let pollNo = 0;
  Object.assign(window, {
    voiceRoomDesktopLoad: { read: async () => readings[Math.min(pollNo, readings.length - 1)] }
  });
  Object.assign(state, { joined: true, localMicPublication: null, peers: new Map<string, never>() });

  quality.startCallQuality(0);
  stats.startPeerLatencyStats();
  await vi.advanceTimersByTimeAsync(0);
  for (pollNo = 1; pollNo < readings.length; pollNo += 1) await vi.advanceTimersByTimeAsync(3_000);
  stats.stopPeerLatencyStats();
  Reflect.deleteProperty(window, 'voiceRoomDesktopLoad');

  const call = defined(quality.finishCallQuality(60_000), 'the call quality summary').stats;
  expect(call).toMatchObject({
    // 1 200 + 3 600 ms of VoiceRoom over 48 000 ms of the computer.
    appCpuAvgPct: 10,
    // Its worst window holds both polls here: the same 10 %.
    appCpuMaxPct: 10,
    // 38 400 busy of 48 000.
    systemCpuAvgPct: 80
  });
});
