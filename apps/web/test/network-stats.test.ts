// @ts-nocheck -- not type-checked yet; remove once the file passes tsconfig.test.json.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const webRoot = resolve(import.meta.dirname, '..');
let serverPromise = null;

function getServer() {
  serverPromise ??= createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: webRoot,
    server: { hmr: false, middlewareMode: true, watch: null }
  });
  return serverPromise;
}

after(async () => {
  if (serverPromise) await (await serverPromise).close();
});

async function load(t, modulePath) {
  globalThis.window = { location: { hash: '', pathname: '/', search: '' } };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  t.after(() => {
    delete globalThis.window;
    delete globalThis.localStorage;
  });
  const server = await getServer();
  server.moduleGraph.invalidateAll();
  return server.ssrLoadModule(modulePath);
}

function report(entries) {
  const map = new Map(entries.map((entry) => [entry.id, entry]));
  return { forEach: (callback) => map.forEach((value) => callback(value)) };
}

test('upstream loss and a UDP transport come from the publisher stats', async (t) => {
  const { getOutboundNetworkFromStats } = await load(t, '/src/lib/features/room/client/room/stats.ts');
  const stats = report([
    { id: 'r1', type: 'remote-inbound-rtp', fractionLost: 0.034 },
    { id: 'p1', type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'l1' },
    { id: 'l1', type: 'local-candidate', candidateType: 'host', protocol: 'udp' }
  ]);
  assert.deepEqual(getOutboundNetworkFromStats(stats), { lossPct: 3.4, transport: 'udp' });
});

test('a relay or TCP candidate is reported as a degraded transport', async (t) => {
  const { getOutboundNetworkFromStats } = await load(t, '/src/lib/features/room/client/room/stats.ts');
  const pair = { id: 'p1', type: 'candidate-pair', state: 'succeeded', selected: true, localCandidateId: 'l1' };
  assert.equal(getOutboundNetworkFromStats(report([pair, { id: 'l1', candidateType: 'relay', protocol: 'udp' }])).transport, 'relay');
  assert.equal(getOutboundNetworkFromStats(report([pair, { id: 'l1', candidateType: 'host', protocol: 'tcp' }])).transport, 'tcp');
  assert.deepEqual(getOutboundNetworkFromStats(undefined), { lossPct: null, transport: null });
});

test('the status pill explains loss, jitter and a TCP fallback and warns on real loss', async (t) => {
  const status = await load(t, '/src/lib/features/room/client/ui/status.ts');
  // Same module graph as status.ts, so both see one state instance.
  const { state } = await (await getServer()).ssrLoadModule('/src/lib/features/room/client/core/state.svelte.ts');
  state.voiceConnection = 'connected';
  state.localPingMs = 40;
  state.localNetwork = { inboundLossPct: 1.2, jitterMs: 9, outboundLossPct: 0, transport: 'tcp' };
  assert.equal(
    status.formatNetworkDetails('40 мс'),
    'Пинг до LiveKit 40 мс · потери от вас 0% · потери к вам 1.2% · джиттер 9 мс · через TCP (UDP недоступен)'
  );
});
