// What the API can read about the machine it runs on. Inside a container the
// kernel is the host's, so CPU times, load and memory are the host's, and the
// root filesystem sits on the host's Docker disk.

import fs from 'node:fs/promises';
import os from 'node:os';
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

export interface CpuTimes {
  idle: number;
  total: number;
}

export interface HostProbe {
  cpuTimes(): CpuTimes;
  load1(): number;
  memory(): { totalBytes: number; freeBytes: number };
  /** Null where the platform cannot tell. */
  disk(): Promise<{ totalBytes: number; freeBytes: number } | null>;
  rssBytes(): number;
  /** The 99th percentile of event loop delay since the last call, in milliseconds. */
  takeEventLoopP99Ms(): number;
}

export function createHostProbe({ diskPath = '/' }: { diskPath?: string } = {}): HostProbe {
  let histogram: IntervalHistogram | null = null;

  function cpuTimes(): CpuTimes {
    let idle = 0;
    let total = 0;
    for (const cpu of os.cpus()) {
      const { user, nice, sys, idle: cpuIdle, irq } = cpu.times;
      idle += cpuIdle;
      total += user + nice + sys + cpuIdle + irq;
    }
    return { idle, total };
  }

  async function disk() {
    try {
      const stats = await fs.statfs(diskPath);
      return { totalBytes: stats.blocks * stats.bsize, freeBytes: stats.bavail * stats.bsize };
    } catch {
      return null;
    }
  }

  function takeEventLoopP99Ms(): number {
    // Started on the first call: the histogram's timer is unreferenced, so it
    // never holds a process open, but there is no reason to run it unread.
    if (!histogram) {
      histogram = monitorEventLoopDelay({ resolution: 20 });
      histogram.enable();
      return 0;
    }
    const p99 = histogram.count > 0 ? histogram.percentile(99) / 1e6 : 0;
    histogram.reset();
    return p99;
  }

  return {
    cpuTimes,
    load1: () => os.loadavg()[0] ?? 0,
    memory: () => ({ totalBytes: os.totalmem(), freeBytes: os.freemem() }),
    disk,
    rssBytes: () => process.memoryUsage.rss(),
    takeEventLoopP99Ms
  };
}
