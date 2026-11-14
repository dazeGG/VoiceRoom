import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { freshImport } from './helpers/fresh-module';
import type { RtcStatsSource } from '@/features/room/client/media/rtc-stats';

async function load<Module>(importModule: () => Promise<Module>): Promise<Module> {
  vi.stubGlobal('window', { location: { hash: '', pathname: '/', search: '' } });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
  return freshImport(importModule);
}

function report(entries: Array<{ id: string } & Record<string, unknown>>) {
  const map = new Map(entries.map((entry) => [entry.id, entry]));
  const stats: RtcStatsSource = { forEach: (callback) => map.forEach((value) => callback(value)) };
  return stats;
}

test('upstream loss counters and a UDP transport come from the publisher stats, audio only', async () => {
  const { getOutboundNetworkFromStats } = await load(() => import('@/features/room/client/room/stats'));
  const stats = report([
    // The SFU's fraction of one short interval is not trusted: the counters are.
    { id: 'r1', type: 'remote-inbound-rtp', kind: 'audio', packetsLost: 12, fractionLost: 0.125 },
    { id: 'o1', type: 'outbound-rtp', kind: 'audio', packetsSent: 3000 },
    { id: 'o2', type: 'outbound-rtp', kind: 'video', packetsSent: 90000 },
    {
      id: 'p1',
      type: 'candidate-pair',
      state: 'succeeded',
      nominated: true,
      localCandidateId: 'l1',
      totalRoundTripTime: 0.6,
      responsesReceived: 20
    },
    { id: 'l1', type: 'local-candidate', candidateType: 'host', protocol: 'udp' }
  ]);
  assert.deepEqual(getOutboundNetworkFromStats(stats), {
    packetsLost: 12,
    packetsSent: 3000,
    rttSeconds: 0.6,
    rttChecks: 20,
    transport: 'udp'
  });
});

test('fresh RTT selection rejects unmeasured candidate zero and cached observations', async () => {
  const { selectFreshRoundTripTime } = await load(() => import('@/features/room/client/room/stats'));
  const { readRtcStats } = await import('@/features/room/client/media/rtc-stats');
  const publication = {};
  const sample = (timestamp: number, pairRtt: number, responses?: number) =>
    readRtcStats(
      report([
        {
          id: 'pair',
          type: 'candidate-pair',
          state: 'succeeded',
          selected: true,
          timestamp,
          currentRoundTripTime: pairRtt,
          responsesReceived: responses
        },
        { id: 'rtcp', type: 'remote-inbound-rtp', timestamp, roundTripTime: 0.1 }
      ])
    );
  assert.equal(selectFreshRoundTripTime(sample(1000, 0), 'room', publication, 0), null, 'identity baseline');
  assert.equal(selectFreshRoundTripTime(sample(2000, 0), 'room', publication, 1000), 100, 'RTCP fallback');
  assert.equal(selectFreshRoundTripTime(sample(2000, 0), 'room', publication, 2000), null, 'unchanged is unknown');
  assert.equal(
    selectFreshRoundTripTime(sample(3000, 0, 0), 'room', publication, 3000),
    100,
    'zero responses falls back'
  );
  assert.equal(selectFreshRoundTripTime(sample(4000, 0, 1), 'room', publication, 4000), null, 'pair source baseline');
  assert.equal(selectFreshRoundTripTime(sample(5000, 0, 2), 'room', publication, 5000), 0, 'measured zero');
  assert.equal(selectFreshRoundTripTime(sample(6000, 0, 2), 'room', publication, 6000), null, 'counter must advance');
});

test('pair/publication identity and invalid decoder fields force an unknown baseline', async () => {
  const { selectFreshRoundTripTime } = await load(() => import('@/features/room/client/room/stats'));
  const { readRtcStats } = await import('@/features/room/client/media/rtc-stats');
  const publication = {};
  const pair = (id: string, responsesReceived: number, timestamp: number, currentRoundTripTime: number) =>
    readRtcStats(
      report([
        {
          id,
          type: 'candidate-pair',
          state: 'succeeded',
          selected: true,
          responsesReceived,
          timestamp,
          currentRoundTripTime,
          totalRoundTripTime: responsesReceived / 10
        }
      ])
    );
  assert.equal(selectFreshRoundTripTime(pair('one', 1, 1000, 0.1), 'room', publication, 0), null);
  assert.equal(selectFreshRoundTripTime(pair('one', 2, 2000, 0.1), 'room', publication, 1000), 100);
  assert.equal(selectFreshRoundTripTime(pair('two', 100, 3000, 0.2), 'room', publication, 2000), null);
  assert.equal(selectFreshRoundTripTime(pair('two', 101, 4000, 0.2), 'room', publication, 3000), 200);
  assert.equal(selectFreshRoundTripTime(pair('two', 102, 5000, 0.2), 'room', {}, 4000), null);
  assert.equal(selectFreshRoundTripTime(pair('two', 103, 6000, 0.2), 'other-room', publication, 5000), null);
  const invalid = readRtcStats(
    report([
      {
        id: 'invalid',
        type: 'candidate-pair',
        timestamp: Infinity,
        responsesReceived: -1,
        currentRoundTripTime: NaN,
        totalRoundTripTime: -1
      }
    ])
  );
  const decoded = invalid.get('invalid');
  assert.deepEqual(
    [decoded?.timestamp, decoded?.responsesReceived, decoded?.currentRoundTripTime, decoded?.totalRoundTripTime],
    [undefined, undefined, undefined, undefined]
  );
});

test('a relay or TCP candidate is reported as a degraded transport', async () => {
  const { getOutboundNetworkFromStats } = await load(() => import('@/features/room/client/room/stats'));
  const pair = { id: 'p1', type: 'candidate-pair', state: 'succeeded', selected: true, localCandidateId: 'l1' };
  assert.equal(
    getOutboundNetworkFromStats(report([pair, { id: 'l1', candidateType: 'relay', protocol: 'udp' }])).transport,
    'relay'
  );
  assert.equal(
    getOutboundNetworkFromStats(report([pair, { id: 'l1', candidateType: 'host', protocol: 'tcp' }])).transport,
    'tcp'
  );
  assert.deepEqual(getOutboundNetworkFromStats(undefined), {
    packetsLost: null,
    packetsSent: null,
    rttSeconds: null,
    rttChecks: null,
    transport: null
  });
});

test.each(['udp', 'tcp', 'tls'])('a prflx candidate using TURN over %s is shown as a relay', async (relayProtocol) => {
  const { getOutboundNetworkFromStats } = await load(() => import('@/features/room/client/room/stats'));
  const { getConnectionStatusView } = await import('@/features/room/client/ui/status');
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  const { transport } = getOutboundNetworkFromStats(
    report([
      { id: 'p1', type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'l1' },
      // Observed on production: the mapped candidate is prflx, but the endpoint still uses TURN.
      { id: 'l1', type: 'local-candidate', candidateType: 'prflx', protocol: 'udp', relayProtocol }
    ])
  );
  assert.equal(transport, 'relay');
  state.voiceConnection = 'connected';
  state.localPingMs = 20;
  state.localNetwork = { inboundLossPct: null, jitterMs: null, outboundLossPct: null, transport };
  assert.equal(getConnectionStatusView().title, 'Пинг до LiveKit 20 мс · через ретранслятор');
});

test.each([undefined, '', 'unknown', true, 1])(
  'invalid relayProtocol %s does not turn a direct candidate into TURN',
  async (relayProtocol) => {
    const { getOutboundNetworkFromStats } = await load(() => import('@/features/room/client/room/stats'));
    const pair = { id: 'p1', type: 'candidate-pair', state: 'succeeded', selected: true, localCandidateId: 'l1' };
    for (const protocol of ['udp', 'tcp']) {
      assert.equal(
        getOutboundNetworkFromStats(
          report([
            pair,
            {
              id: 'l1',
              type: 'local-candidate',
              candidateType: 'prflx',
              protocol,
              relayProtocol,
              url: 'stun:turn.example.com:3478'
            }
          ])
        ).transport,
        protocol
      );
    }
  }
);

test('an unused TURN candidate does not override the selected direct route', async () => {
  const { getOutboundNetworkFromStats } = await load(() => import('@/features/room/client/room/stats'));
  assert.equal(
    getOutboundNetworkFromStats(
      report([
        { id: 'p1', type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'l1' },
        { id: 'l1', type: 'local-candidate', candidateType: 'host', protocol: 'udp' },
        { id: 'p2', type: 'candidate-pair', state: 'succeeded', nominated: false, localCandidateId: 'l2' },
        { id: 'l2', type: 'local-candidate', candidateType: 'prflx', protocol: 'udp', relayProtocol: 'tls' }
      ])
    ).transport,
    'udp'
  );
});

test('the status pill explains loss, jitter and a TCP fallback and warns on real loss', async () => {
  const status = await load(() => import('@/features/room/client/ui/status'));
  // Same module graph as status.ts, so both see one state instance.
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  state.voiceConnection = 'connected';
  state.localPingMs = 40;
  state.localNetwork = { inboundLossPct: 1.2, jitterMs: 9, outboundLossPct: 0, transport: 'tcp' };
  assert.equal(
    status.formatNetworkDetails('40 мс'),
    'Пинг до LiveKit 40 мс · потери от вас 0% · потери к вам 1,2% · джиттер 9 мс · через TCP (UDP недоступен)'
  );
  const { useLocaleStore } = await import('@/shared/i18n');
  await useLocaleStore().select('en');
  assert.equal(
    status.formatNetworkDetails('40 ms'),
    'Ping to LiveKit 40 ms · losses from you 0% · loss to you 1.2% · jitter 9 ms · via TCP (UDP not available)'
  );
  await useLocaleStore().select('fr');
  assert.equal(
    status.formatNetworkDetails('40 ms'),
    'Ping vers LiveKit 40 ms · pertes de votre part 0% · perte pour vous 1,2 % · gigue 9 ms · via TCP (UDP non disponible)'
  );
});
