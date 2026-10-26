// One maintenance tick of the server's own monitoring: what the host, the
// API and the media server look like this minute, written for the admin
// panel. Counters (CPU time, requests, LiveKit's media totals) become this
// minute's numbers by subtracting the previous tick's.

import type { CpuTimes, HostProbe } from '../../platform/host-probe.ts';
import type { SfuTotals } from '../../platform/livekit-metrics.ts';
import type { SystemSnapshot, SystemSnapshotRepository } from './system-snapshot.repository.ts';

export const SYSTEM_SNAPSHOT_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export type HttpTotals = { count: number; errors5xx: number; durationSecondsSum: number };

export type LiveConnections = {
  wsConnections: number;
  guestConnections: number;
  voicePeers: number;
  voiceRooms: number;
};

export interface SystemSamplerDeps {
  host: HostProbe;
  http(): HttpTotals;
  live(): LiveConnections;
  snapshots(): Pick<SystemSnapshotRepository, 'record' | 'pruneBefore'> | null;
  /** LiveKit's totals; when it answers null the minute has no media numbers. */
  sfu(): Promise<SfuTotals | null>;
  now?: () => number;
  keepMs?: number;
}

export function cpuPercent(previous: CpuTimes | null, current: CpuTimes): number | null {
  if (!previous) return null;
  const total = current.total - previous.total;
  if (total <= 0) return null;
  const busy = total - (current.idle - previous.idle);
  return Math.min(100, Math.max(0, (busy / total) * 100));
}

type SfuMinute = Pick<
  SystemSnapshot,
  | 'sfuBytesIn'
  | 'sfuBytesOut'
  | 'sfuPacketsIn'
  | 'sfuLostIn'
  | 'sfuPacketsOut'
  | 'sfuLostOut'
  | 'sfuRetransmitOut'
  | 'sfuCpuPct'
  | 'sfuRssBytes'
>;

const NO_SFU: SfuMinute = {
  sfuBytesIn: null,
  sfuBytesOut: null,
  sfuPacketsIn: null,
  sfuLostIn: null,
  sfuPacketsOut: null,
  sfuLostOut: null,
  sfuRetransmitOut: null,
  sfuCpuPct: null,
  sfuRssBytes: null
};

/** A total's growth since the last reading; a total that went back (LiveKit restarted) counts from zero. */
const growth = (now: number, before: number) => (now >= before ? now - before : now);

/**
 * The minute's media numbers from two readings of LiveKit's totals `spanMs`
 * apart. Bytes are scaled to a whole minute, so a tick interval other than a
 * minute still reads as a rate; packets stay as counted, their shares exact.
 * The CPU time is a share of the whole server's, like the host's figure:
 * LiveKit's seconds over every core's time in the same span (host CPU times
 * are in ms).
 */
export function sfuMinute(
  previous: SfuTotals | null,
  current: SfuTotals | null,
  hostCpuMs: number | null,
  spanMs: number
): SfuMinute {
  if (!current) return NO_SFU;
  if (!previous || spanMs <= 0) return { ...NO_SFU, sfuRssBytes: current.rssBytes };
  const cpuMs = growth(current.cpuSeconds, previous.cpuSeconds) * 1000;
  const perMinute = (bytes: number) => (bytes * MINUTE_MS) / spanMs;
  return {
    sfuBytesIn: perMinute(growth(current.bytesIn, previous.bytesIn)),
    sfuBytesOut: perMinute(growth(current.bytesOut, previous.bytesOut)),
    sfuPacketsIn: growth(current.packetsIn, previous.packetsIn),
    sfuLostIn: growth(current.lostIn, previous.lostIn),
    sfuPacketsOut: growth(current.packetsOut, previous.packetsOut),
    sfuLostOut: growth(current.lostOut, previous.lostOut),
    sfuRetransmitOut: growth(current.retransmitOut, previous.retransmitOut),
    sfuCpuPct: hostCpuMs !== null && hostCpuMs > 0 ? Math.min(100, (cpuMs / hostCpuMs) * 100) : null,
    sfuRssBytes: current.rssBytes
  };
}

export function createSystemSampler(deps: SystemSamplerDeps) {
  const now = deps.now ?? Date.now;
  const keepMs = deps.keepMs ?? SYSTEM_SNAPSHOT_KEEP_MS;
  let previousCpu: CpuTimes | null = deps.host.cpuTimes();
  let previousHttp: HttpTotals = deps.http();
  let previousSfu: SfuTotals | null = null;
  let previousSfuAt = now();
  // LiveKit's baseline is taken at once, like the CPU and request counters
  // above, so the first tick after a deploy already has media numbers.
  void deps
    .sfu()
    .then((totals) => {
      previousSfu ??= totals;
    })
    .catch(() => {});

  /** What this minute looks like; also advances the counters. */
  async function read(): Promise<SystemSnapshot> {
    const at = now();
    const cpu = deps.host.cpuTimes();
    const http = deps.http();
    const requests = Math.max(0, http.count - previousHttp.count);
    const seconds = Math.max(0, http.durationSecondsSum - previousHttp.durationSecondsSum);
    const memory = deps.host.memory();
    const disk = await deps.host.disk();
    const sfu = await deps.sfu();
    const snapshot: SystemSnapshot = {
      at: new Date(at - (at % MINUTE_MS)),
      cpuPct: cpuPercent(previousCpu, cpu),
      load1: deps.host.load1(),
      memUsedBytes: Math.max(0, memory.totalBytes - memory.freeBytes),
      memTotalBytes: memory.totalBytes,
      diskUsedBytes: disk ? Math.max(0, disk.totalBytes - disk.freeBytes) : null,
      diskTotalBytes: disk ? disk.totalBytes : null,
      apiRssBytes: deps.host.rssBytes(),
      eventLoopP99Ms: deps.host.takeEventLoopP99Ms(),
      ...deps.live(),
      httpRequests: requests,
      http5xx: Math.max(0, http.errors5xx - previousHttp.errors5xx),
      httpAvgMs: requests > 0 ? (seconds / requests) * 1000 : null,
      ...sfuMinute(previousSfu, sfu, previousCpu ? cpu.total - previousCpu.total : null, at - previousSfuAt)
    };
    previousCpu = cpu;
    previousSfu = sfu;
    previousSfuAt = at;
    previousHttp = http;
    return snapshot;
  }

  async function sample(): Promise<void> {
    const snapshots = deps.snapshots();
    const snapshot = await read();
    if (!snapshots) return;
    await snapshots.record(snapshot);
    await snapshots.pruneBefore(new Date(snapshot.at.getTime() - keepMs));
  }

  return { sample };
}

export type SystemSampler = ReturnType<typeof createSystemSampler>;
