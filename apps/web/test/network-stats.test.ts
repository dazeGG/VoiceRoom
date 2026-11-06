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
    'Пинг до LiveKit 40 мс · потери от вас 0% · потери к вам 1.2% · джиттер 9 мс · через TCP (UDP недоступен)'
  );
});
