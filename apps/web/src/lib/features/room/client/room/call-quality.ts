// A short account of how a call went: loss, concealment, jitter and latency
// from the stats poll, reconnects, microphone drops and how hard the computer
// was working. It is written to the client log when the call ends, and a call
// that clearly went badly sends the log as a report — Discord watches the same
// signals to catch degradation. A good call sends nothing.
//
// Accurate rather than flattering: the averages come from the browser's own
// counters summed over the whole call (all lost packets over all packets, all
// round trips over all checks, all made-up sound over all sound), not from
// averaging per-poll percentages; the worst moments are the worst 15-second
// windows (loss-window.ts); too little to count says nothing.

import { CONCEALMENT_THRESHOLDS } from '@voice-room/shared/network-quality';
import { reportClientLogs, createLogger, type LogContext } from '$lib/shared/log';
import { maxCpuPressure, type CpuPressureState } from '../services/cpu-pressure';
import { CONCEALMENT_MIN_SAMPLES, LOSS_MIN_PACKETS, createConcealmentWindow, createRatioWindow } from './loss-window';

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

/** One stats poll's own share of the browser's cumulative counters (stats.ts). */
export interface PollCounts {
  /** Incoming audio packets, the lost ones included, and the lost ones. */
  inboundPackets: number;
  inboundLost: number;
  /** Our audio packets sent, and those the SFU says it never got. */
  outboundPackets: number;
  outboundLost: number;
  /** Round trips of the connection's checks, in seconds summed, and how many checks. */
  rttSeconds: number;
  rttChecks: number;
  /** Incoming audio samples played, and those made up for missing packets outside silence. */
  playedSamples: number;
  concealedSamples: number;
}

/** One stats poll's share of the desktop app's running CPU totals (stats.ts), in ms; zeros outside the app. */
export interface LoadCounts {
  /** CPU time of VoiceRoom's own processes. */
  appCpuMs: number;
  /** Every core's busy time, and every core's time. */
  systemBusyMs: number;
  systemTotalMs: number;
}

/** Less core time than this (a few seconds of a few cores) gives no CPU share. */
export const LOAD_MIN_MS = 10_000;

interface Series {
  count: number;
  max: number;
  sum: number;
}

interface CallQuality {
  concealment: ReturnType<typeof createConcealmentWindow>;
  concealedMax: number | null;
  counts: PollCounts;
  load: LoadCounts;
  appLoad: ReturnType<typeof createRatioWindow>;
  appCpuMax: number | null;
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

const emptyCounts = (): PollCounts => ({
  inboundPackets: 0,
  inboundLost: 0,
  outboundPackets: 0,
  outboundLost: 0,
  rttSeconds: 0,
  rttChecks: 0,
  playedSamples: 0,
  concealedSamples: 0
});

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

/** `part` of `whole` in percent with one decimal; null while `whole` is under `minWhole`. */
function share(part: number, whole: number, minWhole: number): number | null {
  if (whole < minWhole || whole <= 0) return null;
  return Math.round((Math.min(part, whole) / whole) * 1000) / 10;
}

/** A rejoin inside the same call (recovery) keeps counting into the same account. */
export function startCallQuality(now = Date.now()): void {
  if (current) return;
  current = {
    concealment: createConcealmentWindow(),
    concealedMax: null,
    counts: emptyCounts(),
    load: { appCpuMs: 0, systemBusyMs: 0, systemTotalMs: 0 },
    appLoad: createRatioWindow(LOAD_MIN_MS),
    appCpuMax: null,
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

/** One poll's display figures: the 15-second loss windows give the worst moments, the samples the ping and jitter. */
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

/** One poll's counters: summed for the call's averages, windowed for its worst concealment. */
export function recordPollCounts(counts: PollCounts): void {
  if (!current) return;
  const total = current.counts;
  const more = (value: number) => Math.max(0, value);
  total.inboundPackets += more(counts.inboundPackets);
  total.inboundLost += more(counts.inboundLost);
  total.outboundPackets += more(counts.outboundPackets);
  total.outboundLost += more(counts.outboundLost);
  total.rttSeconds += more(counts.rttSeconds);
  total.rttChecks += more(counts.rttChecks);
  total.playedSamples += more(counts.playedSamples);
  total.concealedSamples += more(counts.concealedSamples);
  const concealed = current.concealment.add(counts.concealedSamples, counts.playedSamples);
  if (concealed !== null) current.concealedMax = Math.max(current.concealedMax ?? 0, concealed);
}

/** One poll's desktop CPU counts: summed for the call's shares, windowed for VoiceRoom's worst 15 seconds. */
export function recordLoadCounts(counts: LoadCounts): void {
  if (!current) return;
  const total = current.load;
  total.appCpuMs += Math.max(0, counts.appCpuMs);
  total.systemBusyMs += Math.max(0, counts.systemBusyMs);
  total.systemTotalMs += Math.max(0, counts.systemTotalMs);
  const app = current.appLoad.add(counts.appCpuMs, counts.systemTotalMs);
  if (app !== null) current.appCpuMax = Math.max(current.appCpuMax ?? 0, app);
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
  /** The counts behind the loss averages, so any figure can be checked. */
  inboundPackets: number;
  inboundLostPackets: number;
  outboundPackets: number;
  outboundLostPackets: number;
  /** Audible concealment over the call, and its worst 15 seconds. */
  concealedAvgPct: number | null;
  concealedMaxPct: number | null;
  /** The desktop app's own CPU share of the computer, its worst 15 seconds, and the computer's busy share. */
  appCpuAvgPct: number | null;
  appCpuMaxPct: number | null;
  systemCpuAvgPct: number | null;
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
  const counts = quality.counts;
  const inboundLoss = share(counts.inboundLost, counts.inboundPackets, LOSS_MIN_PACKETS);
  const outboundLoss = share(counts.outboundLost, counts.outboundPackets, LOSS_MIN_PACKETS);
  const concealed = share(counts.concealedSamples, counts.playedSamples, CONCEALMENT_MIN_SAMPLES);
  const stats: CallStats = {
    durationS: Math.round(durationMs / 1000),
    peersMax: quality.peersMax,
    // The connection's own sum of round trips; sampled pings only where the browser keeps none.
    rttAvgMs:
      counts.rttChecks > 0 ? Math.round((counts.rttSeconds / counts.rttChecks) * 10_000) / 10 : average(quality.rtt),
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
    micDrops: quality.micDrops,
    inboundPackets: counts.inboundPackets,
    inboundLostPackets: counts.inboundLost,
    outboundPackets: counts.outboundPackets,
    outboundLostPackets: counts.outboundLost,
    concealedAvgPct: concealed,
    concealedMaxPct: quality.concealedMax,
    appCpuAvgPct: share(quality.load.appCpuMs, quality.load.systemTotalMs, LOAD_MIN_MS),
    appCpuMaxPct: quality.appCpuMax,
    systemCpuAvgPct: share(quality.load.systemBusyMs, quality.load.systemTotalMs, LOAD_MIN_MS)
  };
  // The intake keeps eighteen keys of a log context (client-log-intake.ts); the
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
    cpuRelieved: stats.cpuRelieved,
    concealedAvgPct: stats.concealedAvgPct,
    concealedMaxPct: stats.concealedMaxPct,
    inboundPackets: stats.inboundPackets,
    inboundLostPackets: stats.inboundLostPackets,
    appCpuAvgPct: stats.appCpuAvgPct,
    systemCpuAvgPct: stats.systemCpuAvgPct
  };
  // Degraded is what people heard or lost, not how busy the computer was: a
  // game keeps the CPU critical through calls that sound fine.
  const degraded =
    durationMs >= QUALITY_MIN_CALL_MS &&
    ((inboundLoss ?? 0) >= DEGRADED_LOSS_PCT ||
      (outboundLoss ?? 0) >= DEGRADED_LOSS_PCT ||
      (concealed ?? 0) >= CONCEALMENT_THRESHOLDS.noticeablePct ||
      quality.reconnects >= DEGRADED_RECONNECTS);

  log.info('call quality', context);
  if (degraded) void reportClientLogs('call_quality_degraded');
  return { context, degraded, stats };
}
