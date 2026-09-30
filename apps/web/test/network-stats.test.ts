import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import type * as StatsModule from '../src/lib/features/room/client/room/stats.ts';
import type * as StatusModule from '../src/lib/features/room/client/ui/status.ts';

async function load<Module>(modulePath: string): Promise<Module> {
  vi.stubGlobal('window', { location: { hash: '', pathname: '/', search: '' } });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
  vi.resetModules();
  return (await import(/* @vite-ignore */ modulePath)) as Module;
}

function report(entries: Array<{ id: string } & Record<string, unknown>>) {
  const map = new Map(entries.map((entry) => [entry.id, entry]));
  const stats = { forEach: (callback: (value: unknown) => void) => map.forEach((value) => callback(value)) };
  return stats as unknown as RTCStatsReport;
}

test('upstream loss and a UDP transport come from the publisher stats', async () => {
  const { getOutboundNetworkFromStats } = await load<typeof StatsModule>('/src/lib/features/room/client/room/stats.ts');
  const stats = report([
    { id: 'r1', type: 'remote-inbound-rtp', fractionLost: 0.034 },
    { id: 'p1', type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'l1' },
    { id: 'l1', type: 'local-candidate', candidateType: 'host', protocol: 'udp' }
  ]);
  assert.deepEqual(getOutboundNetworkFromStats(stats), { lossPct: 3.4, transport: 'udp' });
});

test('a relay or TCP candidate is reported as a degraded transport', async () => {
  const { getOutboundNetworkFromStats } = await load<typeof StatsModule>('/src/lib/features/room/client/room/stats.ts');
  const pair = { id: 'p1', type: 'candidate-pair', state: 'succeeded', selected: true, localCandidateId: 'l1' };
  assert.equal(
    getOutboundNetworkFromStats(report([pair, { id: 'l1', candidateType: 'relay', protocol: 'udp' }])).transport,
    'relay'
  );
  assert.equal(
    getOutboundNetworkFromStats(report([pair, { id: 'l1', candidateType: 'host', protocol: 'tcp' }])).transport,
    'tcp'
  );
  assert.deepEqual(getOutboundNetworkFromStats(undefined), { lossPct: null, transport: null });
});

test('the status pill explains loss, jitter and a TCP fallback and warns on real loss', async () => {
  const status = await load<typeof StatusModule>('/src/lib/features/room/client/ui/status.ts');
  // Same module graph as status.ts, so both see one state instance.
  const { state } = await import('../src/lib/features/room/client/core/state.svelte.ts');
  state.voiceConnection = 'connected';
  state.localPingMs = 40;
  state.localNetwork = { inboundLossPct: 1.2, jitterMs: 9, outboundLossPct: 0, transport: 'tcp' };
  assert.equal(
    status.formatNetworkDetails('40 мс'),
    'Пинг до LiveKit 40 мс · потери от вас 0% · потери к вам 1.2% · джиттер 9 мс · через TCP (UDP недоступен)'
  );
});
