// The stats poll turns the browser's ever-growing counters into each poll's
// own share, so the call's account sums every packet and sample exactly once:
// the first reading of a stream counts from its start, upstream counters and
// the connection's round trips start from a baseline, and concealment that
// only filled in silence is not counted as heard.

import { afterEach, expect, test, vi } from 'vitest';
import { freshImport } from '../helpers/fresh-module.ts';
import { defined } from '../helpers/assert.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('../../src/lib/entities/room/room-realtime');
});

type Entry = { id: string } & Record<string, unknown>;
const report = (entries: Entry[]) => ({
  forEach: (callback: (value: unknown) => void) => entries.forEach((entry) => callback(entry))
});

test('two polls of growing counters add up to the exact loss, concealment and round trip of the call', async () => {
  vi.useFakeTimers();
  vi.doMock('../../src/lib/entities/room/room-realtime', () => ({ updateVoicePeer: () => {} }));
  const stats = await freshImport(() => import('../../src/lib/features/room/client/room/stats.ts'));
  const { state } = await import('../../src/lib/features/room/client/core/state.svelte.ts');
  const quality = await import('../../src/lib/features/room/client/room/call-quality.ts');

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
