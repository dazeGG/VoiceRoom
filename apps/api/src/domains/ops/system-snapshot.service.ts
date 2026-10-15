// One maintenance tick of the server's own monitoring: what the host and the
// API look like this minute, written for the admin panel. Counters (CPU time,
// requests) become this minute's numbers by subtracting the previous tick's.

import type { CpuTimes, HostProbe } from '../../platform/host-probe.ts';
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

export function createSystemSampler(deps: SystemSamplerDeps) {
  const now = deps.now ?? Date.now;
  const keepMs = deps.keepMs ?? SYSTEM_SNAPSHOT_KEEP_MS;
  let previousCpu: CpuTimes | null = deps.host.cpuTimes();
  let previousHttp: HttpTotals = deps.http();

  /** What this minute looks like; also advances the counters. */
  async function read(): Promise<SystemSnapshot> {
    const at = now();
    const cpu = deps.host.cpuTimes();
    const http = deps.http();
    const requests = Math.max(0, http.count - previousHttp.count);
    const seconds = Math.max(0, http.durationSecondsSum - previousHttp.durationSecondsSum);
    const memory = deps.host.memory();
    const disk = await deps.host.disk();
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
      httpAvgMs: requests > 0 ? (seconds / requests) * 1000 : null
    };
    previousCpu = cpu;
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
