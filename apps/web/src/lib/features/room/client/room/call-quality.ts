// A short account of how a call went: loss, jitter and latency from the stats
// poll, reconnects, microphone drops and how hard the computer was working. It is written to the
// client log when the call ends, and a call that clearly went badly sends the
// log as a report — Discord watches the same signals to catch degradation. A
// good call sends nothing.

import { reportClientLogs, createLogger, type LogContext } from '$lib/shared/log';
import { maxCpuPressure, type CpuPressureState } from '../services/cpu-pressure';

const log = createLogger('room:quality');

/** Shorter calls are mostly joins and leaves, whose numbers say little. */
export const QUALITY_MIN_CALL_MS = 30_000;
export const DEGRADED_LOSS_PCT = 5;
export const DEGRADED_RECONNECTS = 2;

export interface NetworkSample {
  inboundLossPct: number | null;
  outboundLossPct: number | null;
  jitterMs: number | null;
  rttMs: number | null;
  transport: 'udp' | 'tcp' | 'relay' | null;
}

interface Series {
  count: number;
  max: number;
  sum: number;
}

interface CallQuality {
  cpu: CpuPressureState;
  cpuRelieved: boolean;
  inboundLoss: Series;
  jitter: Series;
  micDrops: number;
  outboundLoss: Series;
  peersMax: number;
  reconnects: number;
  rtt: Series;
  startedAt: number;
  transport: NetworkSample['transport'];
}

let current: CallQuality | null = null;

function emptySeries(): Series {
  return { count: 0, max: 0, sum: 0 };
}

function add(series: Series, value: number | null): void {
  if (value === null || !Number.isFinite(value) || value < 0) return;
  series.count += 1;
  series.sum += value;
  series.max = Math.max(series.max, value);
}

function worst(series: Series): number | null {
  return series.count > 0 ? series.max : null;
}

function average(series: Series): number | null {
  return series.count > 0 ? Math.round((series.sum / series.count) * 10) / 10 : null;
}

/** A rejoin inside the same call (recovery) keeps counting into the same account. */
export function startCallQuality(now = Date.now()): void {
  if (current) return;
  current = {
    cpu: 'nominal',
    cpuRelieved: false,
    inboundLoss: emptySeries(),
    jitter: emptySeries(),
    micDrops: 0,
    outboundLoss: emptySeries(),
    peersMax: 0,
    reconnects: 0,
    rtt: emptySeries(),
    startedAt: now,
    transport: null
  };
}

export function recordNetworkSample(sample: NetworkSample): void {
  if (!current) return;
  add(current.inboundLoss, sample.inboundLossPct);
  add(current.outboundLoss, sample.outboundLossPct);
  add(current.jitter, sample.jitterMs);
  add(current.rtt, sample.rttMs);
  // Relay or TCP at any point is what explains a bad call, so it sticks.
  if (sample.transport && current.transport !== 'relay' && current.transport !== 'tcp') {
    current.transport = sample.transport;
  }
}

/** How many other people are in the call now; the call keeps its largest company. */
export function recordPeerCount(count: number): void {
  if (current) current.peersMax = Math.max(current.peersMax, count);
}

export function recordReconnect(): void {
  if (current) current.reconnects += 1;
}

/** The microphone went away mid-call: unplugged, revoked, a headset reconnecting. */
export function recordMicDrop(): void {
  if (current) current.micDrops += 1;
}

export function recordCpuPressure(state: CpuPressureState): void {
  if (current) current.cpu = maxCpuPressure(current.cpu, state);
}

export function recordCpuRelief(): void {
  if (current) current.cpuRelieved = true;
}

/** The call's numbers that "how was the call?" sends along with the answer. */
export interface CallStats {
  durationS: number;
  peersMax: number;
  rttAvgMs: number | null;
  inboundLossAvgPct: number | null;
  outboundLossAvgPct: number | null;
  jitterAvgMs: number | null;
  reconnects: number;
  transport: NetworkSample['transport'];
  rttMaxMs: number | null;
  inboundLossMaxPct: number | null;
  outboundLossMaxPct: number | null;
  jitterMaxMs: number | null;
  cpuPressureMax: CpuPressureState;
  cpuRelieved: boolean;
  micDrops: number;
}

export interface CallQualitySummary {
  context: LogContext;
  degraded: boolean;
  stats: CallStats;
}

/** Ends the call's account. Returns null when no call was being measured. */
export function finishCallQuality(now = Date.now()): CallQualitySummary | null {
  const quality = current;
  current = null;
  if (!quality) return null;

  const durationMs = Math.max(0, now - quality.startedAt);
  const inboundLoss = average(quality.inboundLoss);
  const outboundLoss = average(quality.outboundLoss);
  const stats: CallStats = {
    durationS: Math.round(durationMs / 1000),
    peersMax: quality.peersMax,
    rttAvgMs: average(quality.rtt),
    inboundLossAvgPct: inboundLoss,
    outboundLossAvgPct: outboundLoss,
    jitterAvgMs: average(quality.jitter),
    reconnects: quality.reconnects,
    transport: quality.transport,
    rttMaxMs: worst(quality.rtt),
    inboundLossMaxPct: worst(quality.inboundLoss),
    outboundLossMaxPct: worst(quality.outboundLoss),
    jitterMaxMs: worst(quality.jitter),
    cpuPressureMax: quality.cpu,
    cpuRelieved: quality.cpuRelieved,
    micDrops: quality.micDrops
  };
  // The intake keeps twelve keys of a log context (client-log-intake.ts); the
  // rest goes with the answer to "how was the call?" only.
  const context: LogContext = {
    durationS: stats.durationS,
    peersMax: stats.peersMax,
    rttAvgMs: stats.rttAvgMs,
    inboundLossAvgPct: stats.inboundLossAvgPct,
    outboundLossAvgPct: stats.outboundLossAvgPct,
    jitterAvgMs: stats.jitterAvgMs,
    reconnects: stats.reconnects,
    transport: stats.transport,
    inboundLossMaxPct: stats.inboundLossMaxPct,
    rttMaxMs: stats.rttMaxMs,
    cpuPressureMax: stats.cpuPressureMax,
    cpuRelieved: stats.cpuRelieved
  };
  const degraded =
    durationMs >= QUALITY_MIN_CALL_MS &&
    ((inboundLoss ?? 0) >= DEGRADED_LOSS_PCT ||
      (outboundLoss ?? 0) >= DEGRADED_LOSS_PCT ||
      quality.reconnects >= DEGRADED_RECONNECTS ||
      quality.cpu === 'critical');

  log.info('call quality', context);
  if (degraded) void reportClientLogs('call_quality_degraded');
  return { context, degraded, stats };
}
