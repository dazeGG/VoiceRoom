import { createLogger, reportClientLogs, type LogContext } from '../diagnostics';
import { readRtcStats, type RtcStat, type RtcStatsSource } from './rtc-stats';
import { playbackCounted, screenFpsSource } from './screen-fps-source';

const log = createLogger('room:screen-startup');
const WINDOW_MS = 30_000;
const SAMPLE_MS = 1000;
const SAMPLE_LIMIT = WINDOW_MS / SAMPLE_MS;
const STABLE_FPS = 27;
const STABLE_RUN = 3;

/** What the desktop's native capture reports; a browser share has none. */
export interface CaptureCounters {
  /** Cumulative frames delivered to the renderer. */
  framesReceived?: number | undefined;
  /** Cumulative frames dropped by flow control. */
  framesDroppedBackpressure?: number | undefined;
  /** `wgc` or `dxgi`; missing on desktops without the pipeline report. */
  backend?: string | undefined;
  /** The longest capture gap in about the last two seconds, in microseconds. */
  maxGapUs?: number | undefined;
}

/** What one sender sample measures, per second since the previous one. */
export interface SenderSample {
  captureFps: number | null;
  encodedFps: number | null;
  sentFps: number | null;
  bitrate: number | null;
  height: number | null;
  limitation: string | null;
  backpressure: number | null;
  codec: string | null;
  encoder: string | null;
}

/** What one viewer sample measures, per second since the previous one. */
export interface ReceiverSample {
  decodedFps: number | null;
  renderedFps: number | null;
  bitrate: number | null;
  height: number | null;
  lost: number | null;
  freezes: number | null;
  codec: string | null;
}

interface PlaybackCounters {
  totalVideoFrames: number;
  droppedVideoFrames: number;
}

export interface ScreenStartupDiagnosticsOptions {
  direction: 'send' | 'receive';
  /** The publication SID correlates sender and viewer, without names or room identifiers. */
  trackId: string;
  profileId: string;
  /** A report for this publication's sender/receiver, not the whole room connection. */
  read: () => Promise<RtcStatsSource | undefined>;
  capture?: (() => CaptureCounters | undefined) | undefined;
  playback?: (() => PlaybackCounters | undefined) | undefined;
}

export interface Snapshot {
  at: number;
  stats: Map<string, RtcStat>;
  capture: CaptureCounters | undefined;
  playback: PlaybackCounters | undefined;
}

interface Reading {
  elapsedMs: number;
  /** Sent FPS for a sender, rendered FPS for a viewer. */
  fps: number | null;
  /** Viewer only: the measure where the browser counts no playback frames. */
  decodedFps: number | null;
  height: number | null;
  limitation: string | null;
  codec: string | null;
  encoder: string | null;
  freezes: number | null;
  lost: number | null;
  backend: string | null;
  gapMs: number | null;
}

/** Observes startup only; it never changes a track, an encoding or a subscription. */
export function startScreenStartupDiagnostics(options: ScreenStartupDiagnosticsOptions): () => void {
  const startedAt = Date.now();
  const probeId = `${options.direction}-${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const observed: Reading[] = [];
  let playbackCounts = false;
  let previous: Snapshot | undefined;
  let stopped = false;
  let errors = 0;
  let next: ReturnType<typeof setTimeout> | undefined;
  const deadline = setTimeout(() => finish('complete'), WINDOW_MS);

  function finish(reason: 'complete' | 'stopped'): void {
    if (stopped) return;
    stopped = true;
    clearTimeout(deadline);
    clearTimeout(next);
    // One record at the end, within the intake's 18-key / primitive-value limit.
    log.info('screen startup summary', summaryContext(reason));
    observed.length = 0;
    previous = undefined;
    void reportClientLogs('screen startup diagnostics', 'info').catch(() => {});
  }

  function summaryContext(reason: 'complete' | 'stopped'): LogContext {
    const fpsSource = screenFpsSource(options.direction, playbackCounts);
    const readings =
      fpsSource === 'decoded' ? observed.map((reading) => ({ ...reading, fps: reading.decodedFps })) : observed;
    const maxHeight = maxOf(readings.map((reading) => reading.height));
    const stableMs = stableElapsed(readings, maxHeight);
    // Sender is 18 keys and viewer is 17, within the intake's limit.
    const shared = {
      probeId,
      trackId: options.trackId,
      direction: options.direction,
      profileId: options.profileId,
      reason,
      elapsedMs: Date.now() - startedAt,
      samples: readings.length,
      errors,
      firstFrameMs: readings.find((reading) => reading.fps !== null && reading.fps > 0)?.elapsedMs ?? null,
      stableMs,
      minFpsAfterStable: minFpsFrom(readings, stableMs),
      medianFps: medianOf(readings.map((reading) => reading.fps)),
      maxHeight,
      codec: lastText(readings.map((reading) => reading.codec))
    };
    if (options.direction === 'send') {
      return {
        ...shared,
        limitation: frequentLimitation(readings.map((reading) => reading.limitation)),
        encoder: lastText(readings.map((reading) => reading.encoder)),
        backend: lastText(readings.map((reading) => reading.backend)),
        maxGapMs: maxOf(readings.map((reading) => reading.gapMs))
      };
    }
    return {
      ...shared,
      fpsSource,
      freezes: sumOf(readings.map((reading) => reading.freezes)),
      lost: sumOf(readings.map((reading) => reading.lost))
    };
  }

  async function sample(): Promise<void> {
    try {
      const report = await options.read();
      if (stopped) return;
      const current: Snapshot = {
        at: Date.now(),
        stats: readRtcStats(report),
        capture: options.capture?.(),
        playback: options.playback?.()
      };
      if (playbackCounted(current.playback)) playbackCounts = true;
      if (observed.length < SAMPLE_LIMIT) observed.push(readingFrom(current, previous));
      previous = current;
    } catch {
      // Exceptions can contain URLs/SDP. Count failures, never serialize them.
      if (!stopped) errors += 1;
    }
    // Schedule after completion: even a slow getStats cannot overlap itself.
    if (!stopped) next = setTimeout(() => void sample(), SAMPLE_MS);
  }

  function readingFrom(current: Snapshot, before: Snapshot | undefined): Reading {
    const shared = {
      elapsedMs: current.at - startedAt,
      backend: captureBackend(current),
      gapMs: captureGapMs(current)
    };
    if (options.direction === 'send') {
      const sample = senderSample(current, before);
      return {
        ...shared,
        fps: sample.sentFps,
        decodedFps: null,
        height: sample.height,
        limitation: sample.limitation,
        codec: sample.codec,
        encoder: sample.encoder,
        freezes: null,
        lost: null
      };
    }
    const sample = receiverSample(current, before);
    return {
      ...shared,
      fps: sample.renderedFps,
      decodedFps: sample.decodedFps,
      height: sample.height,
      limitation: null,
      codec: sample.codec,
      encoder: null,
      freezes: sample.freezes,
      lost: sample.lost
    };
  }

  void sample();
  return () => finish('stopped');
}

export function captureBackend(snapshot: Snapshot): string | null {
  return snapshot.capture?.backend?.slice(0, 20) ?? null;
}

export function captureGapMs(snapshot: Snapshot): number | null {
  const gapUs = finite(snapshot.capture?.maxGapUs);
  return gapUs === null ? null : Math.round(gapUs / 10) / 100;
}

/**
 * First sample of the first run of three at the window's largest height and at
 * least 27 FPS. A failed or late read between two samples breaks the run.
 */
function stableElapsed(readings: Reading[], maxHeight: number | null): number | null {
  if (maxHeight === null) return null;
  let run = 0;
  let before: Reading | undefined;
  for (let index = 0; index < readings.length; index += 1) {
    const reading = readings[index];
    const stable =
      reading !== undefined && reading.fps !== null && reading.fps >= STABLE_FPS && reading.height === maxHeight;
    const continuous =
      before !== undefined && reading !== undefined && reading.elapsedMs - before.elapsedMs <= SAMPLE_MS * 1.5;
    run = stable ? (continuous ? run + 1 : 1) : 0;
    before = reading;
    if (run === STABLE_RUN) return readings[index - (STABLE_RUN - 1)]?.elapsedMs ?? null;
  }
  return null;
}

function minFpsFrom(readings: Reading[], stableMs: number | null): number | null {
  if (stableMs === null) return null;
  return minOf(readings.filter((reading) => reading.elapsedMs >= stableMs).map((reading) => reading.fps));
}

function lastText(values: (string | null)[]): string | null {
  let last: string | null = null;
  for (const value of values) if (value !== null) last = value;
  return last;
}

function frequentLimitation(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value === null) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let selected: string | null = null;
  let selectedCount = 0;
  for (const [reason, count] of counts) {
    if (reason === 'none' || count <= selectedCount) continue;
    selected = reason;
    selectedCount = count;
  }
  if (selected !== null) return selected;
  return counts.has('none') ? 'none' : null;
}

function present(series: (number | null)[]): number[] {
  return series.filter((value): value is number => value !== null);
}

function minOf(series: (number | null)[]): number | null {
  const values = present(series);
  return values.length === 0 ? null : Math.min(...values);
}

function maxOf(series: (number | null)[]): number | null {
  const values = present(series);
  return values.length === 0 ? null : Math.max(...values);
}

function sumOf(series: (number | null)[]): number | null {
  const values = present(series);
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0);
}

function medianOf(series: (number | null)[]): number | null {
  const values = present(series).sort((left, right) => left - right);
  if (values.length === 0) return null;
  const middle = Math.floor(values.length / 2);
  const value = values.length % 2 === 1 ? values[middle] : ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2;
  return value === undefined ? null : Math.round(value * 100) / 100;
}

function finite(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) ? value : null;
}

function rounded(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

function delta(value: number | undefined, before: number | undefined): number | null {
  const current = finite(value);
  const previous = finite(before);
  return current === null || previous === null || current < previous ? null : current - previous;
}

function perSecond(value: number | null, elapsed: number): number | null {
  return value === null || elapsed <= 0 ? null : rounded((value * 1000) / elapsed);
}

function videoLayer(stats: Map<string, RtcStat>, type: 'outbound-rtp' | 'inbound-rtp'): RtcStat | undefined {
  let selected: RtcStat | undefined;
  for (const stat of stats.values()) {
    if (stat.type !== type || stat.isRemote || (stat.kind !== 'video' && stat.mediaType !== 'video')) continue;
    const pixels = (finite(stat.frameWidth) ?? 0) * (finite(stat.frameHeight) ?? 0);
    const selectedPixels = (finite(selected?.frameWidth) ?? 0) * (finite(selected?.frameHeight) ?? 0);
    if (!selected || pixels > selectedPixels) selected = stat;
  }
  return selected;
}

function frameInterval(current: Snapshot, previous: Snapshot | undefined, stat: RtcStat | undefined): number {
  const before = stat ? previous?.stats.get(stat.id) : undefined;
  if (!before || !previous) return 0;
  return (finite(stat?.timestamp) ?? current.at) - (finite(before.timestamp) ?? previous.at);
}

function codecName(current: Snapshot, stat: RtcStat | undefined): string | null {
  return stat?.codecId ? (current.stats.get(stat.codecId)?.mimeType?.slice(0, 200) ?? null) : null;
}

export function senderSample(current: Snapshot, previous: Snapshot | undefined): SenderSample {
  const stat = videoLayer(current.stats, 'outbound-rtp');
  const before = stat ? previous?.stats.get(stat.id) : undefined;
  const interval = frameInterval(current, previous, stat);
  const elapsed = previous ? current.at - previous.at : 0;
  const source = stat?.mediaSourceId ? current.stats.get(stat.mediaSourceId) : undefined;
  const previousSource = source ? previous?.stats.get(source.id) : undefined;
  const bytes = delta(stat?.bytesSent, before?.bytesSent);
  return {
    captureFps:
      current.capture?.framesReceived !== undefined
        ? perSecond(delta(current.capture.framesReceived, previous?.capture?.framesReceived), elapsed)
        : (finite(source?.framesPerSecond) ??
          perSecond(delta(source?.frames, previousSource?.frames), frameInterval(current, previous, source))),
    encodedFps: finite(stat?.framesPerSecond) ?? perSecond(delta(stat?.framesEncoded, before?.framesEncoded), interval),
    sentFps: perSecond(delta(stat?.framesSent, before?.framesSent), interval),
    bitrate: perSecond(bytes === null ? null : bytes * 8, interval),
    height: finite(stat?.frameHeight),
    limitation: stat?.qualityLimitationReason?.slice(0, 200) ?? null,
    backpressure: delta(current.capture?.framesDroppedBackpressure, previous?.capture?.framesDroppedBackpressure),
    codec: codecName(current, stat),
    encoder: stat?.encoderImplementation?.slice(0, 200) ?? null
  };
}

export function receiverSample(current: Snapshot, previous: Snapshot | undefined): ReceiverSample {
  const stat = videoLayer(current.stats, 'inbound-rtp');
  const before = stat ? previous?.stats.get(stat.id) : undefined;
  const interval = frameInterval(current, previous, stat);
  const shown = current.playback ? current.playback.totalVideoFrames - current.playback.droppedVideoFrames : undefined;
  const shownBefore = previous?.playback
    ? previous.playback.totalVideoFrames - previous.playback.droppedVideoFrames
    : undefined;
  const bytes = delta(stat?.bytesReceived, before?.bytesReceived);
  return {
    decodedFps: finite(stat?.framesPerSecond) ?? perSecond(delta(stat?.framesDecoded, before?.framesDecoded), interval),
    renderedFps: perSecond(delta(shown, shownBefore), previous ? current.at - previous.at : 0),
    bitrate: perSecond(bytes === null ? null : bytes * 8, interval),
    height: finite(stat?.frameHeight),
    lost: delta(stat?.packetsLost, before?.packetsLost),
    freezes: delta(stat?.freezeCount, before?.freezeCount),
    codec: codecName(current, stat)
  };
}
