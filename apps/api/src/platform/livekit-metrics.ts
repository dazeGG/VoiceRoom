// What the media server (LiveKit) says about itself on its Prometheus port:
// the totals since it started of the media it took in and sent out, the
// packets lost on the way (in: from the people speaking to the server; out:
// from the server to the people listening, as their receivers report it),
// the packets it sent again, and the CPU time and memory of its process. The
// system sampler turns the totals into each minute's own numbers.

/** LiveKit's totals since it started. */
export interface SfuTotals {
  bytesIn: number;
  bytesOut: number;
  packetsIn: number;
  lostIn: number;
  /** First sends only; retransmits are counted apart. */
  packetsOut: number;
  lostOut: number;
  retransmitOut: number;
  cpuSeconds: number;
  rssBytes: number;
}

export interface SfuProbe {
  /** Null when the metrics cannot be read: no URL, the server down or an answer without them. */
  read(): Promise<SfuTotals | null>;
}

const TIMEOUT_MS = 2_000;

interface Sample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

const LINE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+(\S+)/;
const LABEL = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;

/** The samples of a Prometheus text answer; comments and lines it cannot read are skipped. */
export function parsePrometheusText(text: string): Sample[] {
  const samples: Sample[] = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const match = LINE.exec(line);
    if (!match) continue;
    const [, name = '', labelText = '', raw = ''] = match;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const labels: Record<string, string> = {};
    for (const [, key = '', label = ''] of labelText.matchAll(LABEL)) labels[key] = label;
    samples.push({ name, labels, value });
  }
  return samples;
}

/** LiveKit's totals from its samples; null when the answer carries none of its packet counters. */
export function sfuTotalsOf(samples: Sample[]): SfuTotals | null {
  const sum = (name: string, labels: Record<string, string> = {}) =>
    samples
      .filter(
        (sample) => sample.name === name && Object.entries(labels).every(([key, value]) => sample.labels[key] === value)
      )
      .reduce((total, sample) => total + sample.value, 0);
  if (!samples.some((sample) => sample.name === 'livekit_packet_total')) return null;
  return {
    bytesIn: sum('livekit_packet_bytes', { direction: 'incoming' }),
    bytesOut: sum('livekit_packet_bytes', { direction: 'outgoing' }),
    packetsIn: sum('livekit_packet_total', { direction: 'incoming' }),
    lostIn: sum('livekit_packet_loss_total', { direction: 'incoming' }),
    packetsOut: sum('livekit_packet_total', { direction: 'outgoing', transmission: 'initial' }),
    lostOut: sum('livekit_packet_loss_total', { direction: 'outgoing' }),
    retransmitOut: sum('livekit_packet_total', { direction: 'outgoing', transmission: 'retransmit' }),
    cpuSeconds: sum('process_cpu_seconds_total'),
    rssBytes: sum('process_resident_memory_bytes')
  };
}

export function createSfuProbe({
  url,
  fetchText = defaultFetchText
}: {
  url: string;
  fetchText?: (url: string) => Promise<string>;
}): SfuProbe {
  async function read(): Promise<SfuTotals | null> {
    if (!url) return null;
    try {
      return sfuTotalsOf(parsePrometheusText(await fetchText(url)));
    } catch {
      return null;
    }
  }
  return { read };
}

async function defaultFetchText(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`metrics answered ${response.status}`);
  return response.text();
}
