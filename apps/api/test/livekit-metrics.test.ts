// The media server's minute: LiveKit's Prometheus totals are read from its
// answer as LiveKit writes it, turned into each minute's own numbers (a
// restart counts from zero, the first reading only sets the baseline), and
// its CPU time becomes a share of the whole server's.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createSfuProbe, parsePrometheusText, sfuTotalsOf, type SfuTotals } from '../src/platform/livekit-metrics.ts';
import { createSystemSampler, sfuMinute } from '../src/domains/ops/system-snapshot.service.ts';
import type { SystemSnapshot } from '../src/domains/ops/system-snapshot.repository.ts';
import { readLiveKitMetricsUrl } from '../src/app/config.ts';
import type { CpuTimes } from '../src/platform/host-probe.ts';
import { defined } from './helpers/assert-defined.ts';

// Lines as LiveKit 1.13 writes them (prod, 2026-10-26), trimmed to a few series.
const NODE = 'node_id="ND_x",node_type="SERVER"';
const METRICS = `# HELP livekit_packet_total packets
# TYPE livekit_packet_total counter
livekit_packet_bytes{country="",direction="incoming",${NODE},transmission="initial"} 3.6194828034e+10
livekit_packet_bytes{country="",direction="outgoing",${NODE},transmission="initial"} 3.3100809191e+10
livekit_packet_bytes{country="",direction="outgoing",${NODE},transmission="retransmit"} 5.97747456e+08
livekit_packet_total{country="",direction="incoming",${NODE},transmission="initial"} 4.4799096e+07
livekit_packet_total{country="",direction="outgoing",${NODE},transmission="initial"} 4.8806911e+07
livekit_packet_total{country="",direction="outgoing",${NODE},transmission="retransmit"} 522838
livekit_packet_loss_total{country="",direction="incoming",${NODE},source="MICROPHONE",type="AUDIO"} 5254
livekit_packet_loss_total{country="",direction="incoming",${NODE},source="SCREEN_SHARE",type="VIDEO"} 24718
livekit_packet_loss_total{country="",direction="outgoing",${NODE},source="MICROPHONE",type="AUDIO"} 78940
livekit_packet_loss_total{country="",direction="outgoing",${NODE},source="SCREEN_SHARE",type="VIDEO"} 227907
livekit_packet_loss_percent_sum{country="",direction="incoming",${NODE},source="MICROPHONE",type="AUDIO"} 3933.38
process_cpu_seconds_total 56822.33
process_resident_memory_bytes 8.6982656e+07
go_goroutines 410
`;

test('LiveKit totals come from its Prometheus answer, each direction and transmission apart', () => {
  assert.deepEqual(sfuTotalsOf(parsePrometheusText(METRICS)), {
    bytesIn: 36_194_828_034,
    bytesOut: 33_100_809_191 + 597_747_456,
    packetsIn: 44_799_096,
    lostIn: 5254 + 24_718,
    packetsOut: 48_806_911,
    lostOut: 78_940 + 227_907,
    retransmitOut: 522_838,
    cpuSeconds: 56_822.33,
    rssBytes: 86_982_656
  });
  // Another exporter on the port, or an error page, is not LiveKit.
  assert.equal(sfuTotalsOf(parsePrometheusText('go_goroutines 410\n')), null);
});

test('the probe answers null without a URL, on a failed fetch, and for an answer without the counters', async () => {
  assert.equal(await createSfuProbe({ url: '' }).read(), null);
  const failing = createSfuProbe({
    url: 'http://livekit:6789/metrics',
    fetchText: async () => {
      throw new Error('connect ECONNREFUSED');
    }
  });
  assert.equal(await failing.read(), null);
  const asked: string[] = [];
  const probe = createSfuProbe({
    url: 'http://livekit:6789/metrics',
    fetchText: async (url) => {
      asked.push(url);
      return METRICS;
    }
  });
  assert.equal((await probe.read())?.packetsIn, 44_799_096);
  assert.deepEqual(asked, ['http://livekit:6789/metrics']);
});

test('the metrics URL is read only when it is an http(s) URL', () => {
  assert.equal(readLiveKitMetricsUrl({}), '');
  assert.equal(readLiveKitMetricsUrl({ LIVEKIT_METRICS_URL: 'livekit:6789' }), '');
  assert.equal(readLiveKitMetricsUrl({ LIVEKIT_METRICS_URL: 'file:///etc/passwd' }), '');
  assert.equal(
    readLiveKitMetricsUrl({ LIVEKIT_METRICS_URL: ' http://livekit:6789/metrics ' }),
    'http://livekit:6789/metrics'
  );
});

const MINUTE = 60_000;

const totals = (overrides: Partial<SfuTotals> = {}): SfuTotals => ({
  bytesIn: 1_000_000,
  bytesOut: 2_000_000,
  packetsIn: 10_000,
  lostIn: 10,
  packetsOut: 20_000,
  lostOut: 100,
  retransmitOut: 50,
  cpuSeconds: 100,
  rssBytes: 80_000_000,
  ...overrides
});

test('a minute of the media server is the growth of its totals, and a restart counts from zero', () => {
  // Nothing read, nothing to say; the first reading gives only the memory.
  assert.equal(sfuMinute(null, null, 120_000, MINUTE).sfuBytesIn, null);
  const first = sfuMinute(null, totals(), 120_000, MINUTE);
  assert.equal(first.sfuPacketsIn, null);
  assert.equal(first.sfuCpuPct, null);
  assert.equal(first.sfuRssBytes, 80_000_000);

  // Two cores for a minute are 120 000 ms of CPU time; LiveKit used 6 s of it.
  assert.deepEqual(
    sfuMinute(
      totals(),
      totals({
        bytesIn: 23_500_000,
        bytesOut: 47_000_000,
        packetsIn: 40_000,
        lostIn: 25,
        packetsOut: 80_000,
        lostOut: 400,
        retransmitOut: 170,
        cpuSeconds: 106,
        rssBytes: 90_000_000
      }),
      120_000,
      MINUTE
    ),
    {
      sfuBytesIn: 22_500_000,
      sfuBytesOut: 45_000_000,
      sfuPacketsIn: 30_000,
      sfuLostIn: 15,
      sfuPacketsOut: 60_000,
      sfuLostOut: 300,
      sfuRetransmitOut: 120,
      sfuCpuPct: 5,
      sfuRssBytes: 90_000_000
    }
  );

  // LiveKit restarted: its totals went back, and what it counted since is the minute.
  const restarted = sfuMinute(totals(), totals({ packetsIn: 900, lostIn: 2, cpuSeconds: 3 }), 120_000, MINUTE);
  assert.equal(restarted.sfuPacketsIn, 900);
  assert.equal(restarted.sfuLostIn, 2);
  assert.equal(restarted.sfuCpuPct, 2.5);
  // No host CPU span (the sampler's first tick) gives no share.
  assert.equal(sfuMinute(totals(), totals({ cpuSeconds: 106 }), null, MINUTE).sfuCpuPct, null);

  // Ticks 30 s apart: the bytes read as a minute's worth, the packets as counted.
  const half = sfuMinute(totals(), totals({ bytesIn: 2_000_000, packetsIn: 12_000 }), 60_000, MINUTE / 2);
  assert.equal(half.sfuBytesIn, 2_000_000);
  assert.equal(half.sfuPacketsIn, 2_000);
});

test("the sampler takes LiveKit's baseline at once and writes the media minute beside the host minute", async () => {
  const cpu: CpuTimes[] = [
    { idle: 1000, total: 2000 },
    { idle: 1000, total: 2000 + 120_000 },
    { idle: 1000, total: 2000 + 240_000 }
  ];
  const sfu: Array<SfuTotals | null> = [totals(), totals({ packetsIn: 40_000, cpuSeconds: 112 })];
  const recorded: SystemSnapshot[] = [];
  let clock = Date.parse('2026-10-26T10:00:30Z');
  const sampler = createSystemSampler({
    host: {
      cpuTimes: () => defined(cpu.shift(), 'a cpu reading'),
      load1: () => 0.5,
      memory: () => ({ totalBytes: 4, freeBytes: 1 }),
      disk: async () => null,
      rssBytes: () => 1,
      takeEventLoopP99Ms: () => 1
    },
    http: () => ({ count: 0, errors5xx: 0, durationSecondsSum: 0 }),
    live: () => ({ wsConnections: 0, guestConnections: 0, voicePeers: 0, voiceRooms: 0 }),
    snapshots: () => ({
      record: async (snapshot) => {
        recorded.push(snapshot);
      },
      pruneBefore: async () => 0
    }),
    sfu: async () => sfu.shift() ?? null,
    now: () => clock
  });

  clock += 60_000;
  await sampler.sample();
  clock += 60_000;
  await sampler.sample();

  // The baseline was read when the sampler started, so the first tick already counts.
  const first = defined(recorded[0], 'the first minute');
  assert.equal(first.sfuPacketsIn, 30_000);
  // 12 s of LiveKit over 120 000 ms of the server's CPU time.
  assert.equal(first.sfuCpuPct, 10);
  // LiveKit did not answer the second tick: no media numbers, and no guess.
  assert.equal(defined(recorded[1], 'the second minute').sfuPacketsIn, null);
});
