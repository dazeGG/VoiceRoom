import { createLogger, reportClientLogs, type LogContext } from '../diagnostics';
import { readRtcStats } from './rtc-stats';
import { playbackCounted, screenFpsSource, type ScreenFpsSource } from './screen-fps-source';
import {
  captureGapMs,
  receiverSample,
  senderSample,
  type ScreenStartupDiagnosticsOptions,
  type Snapshot
} from './screen-startup-diagnostics';

const log = createLogger('room:screen-sustained');
const SAMPLE_MS = 2000;
const SUMMARY_MS = 60_000;
/** Degraded minutes only. A healthy publication logs the total and nothing else. */
const DEGRADED_RECORD_LIMIT = 10;
/** A running total every quarter hour, so a share whose page closes without a stop still leaves one. */
const RUNNING_TOTAL_MINUTES = 15;
/** Two hours of one-minute buckets per publication; sampling stops after that. */
const SUMMARY_LIMIT = 120;
const LOW_FPS = 15;

type Series = (number | null)[];

interface Bucket {
  startedAt: number;
  samples: number;
  errors: number;
  fps: Series;
  /** Viewer only: replaces fps while the browser counts no playback frames. */
  decodedFps: Series;
  bitrate: Series;
  height: Series;
  captureFps: Series;
  encodedFps: Series;
  gapMs: Series;
  backpressure: Series;
  freezes: Series;
  lost: Series;
}

function emptyBucket(startedAt: number): Bucket {
  return {
    startedAt,
    samples: 0,
    errors: 0,
    fps: [],
    decodedFps: [],
    bitrate: [],
    height: [],
    captureFps: [],
    encodedFps: [],
    gapMs: [],
    backpressure: [],
    freezes: [],
    lost: []
  };
}

interface Aggregate {
  samples: number;
  errors: number;
  fps: Series;
  bitrate: Series;
  height: Series;
  gapMs: Series;
  backpressure: Series;
  freezes: Series;
  lost: Series;
}

function emptyAggregate(): Aggregate {
  return {
    samples: 0,
    errors: 0,
    fps: [],
    bitrate: [],
    height: [],
    gapMs: [],
    backpressure: [],
    freezes: [],
    lost: []
  };
}

/**
 * Watches a publication beyond the 30-second startup window. It is independent of
 * the startup observer, so a new viewer never restarts it, and it never changes a
 * track, an encoding or a subscription.
 */
export function startScreenSustainedDiagnostics(options: ScreenStartupDiagnosticsOptions): () => void {
  const startedAt = Date.now();
  const probeId = `${options.direction}-sustained-${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const pending: LogContext[] = [];
  const total = emptyAggregate();
  let minutes = 0;
  let degradedMinutes = 0;
  let loggedDegraded = 0;
  let bucket = emptyBucket(startedAt);
  let playbackCounts = false;
  let previous: Snapshot | undefined;
  let stopped = false;
  let next: ReturnType<typeof setTimeout> | undefined;

  function publishPending(): boolean {
    if (pending.length === 0) return false;
    for (const context of pending) log.info('screen sustained summary', context);
    pending.length = 0;
    return true;
  }

  function report(): void {
    void reportClientLogs('screen sustained diagnostics', 'info').catch(() => {});
  }

  function isDegraded(): boolean {
    if (present(bucket.fps).some((value) => value < LOW_FPS)) return true;
    if (options.direction === 'send') {
      const backpressure = sumOf(bucket.backpressure);
      return backpressure !== null && backpressure > 0;
    }
    const freezes = sumOf(bucket.freezes);
    return freezes !== null && freezes > 0;
  }

  function minuteRecord(now: number): LogContext {
    return {
      probeId,
      trackId: options.trackId,
      direction: options.direction,
      elapsedMs: now - startedAt,
      samples: bucket.samples,
      errors: bucket.errors,
      minFps: minOf(bucket.fps),
      medianFps: medianOf(bucket.fps),
      lowSamples: lowSamples(bucket.fps),
      avgBitrate: meanOf(bucket.bitrate),
      minHeight: minOf(bucket.height),
      ...(options.direction === 'send'
        ? {
            minCaptureFps: minOf(bucket.captureFps),
            minEncodedFps: minOf(bucket.encodedFps),
            maxGapMs: maxOf(bucket.gapMs),
            backpressure: sumOf(bucket.backpressure)
          }
        : { freezes: sumOf(bucket.freezes), lost: sumOf(bucket.lost), fpsSource: fpsSource() })
    };
  }

  function fold(): void {
    total.samples += bucket.samples;
    total.errors += bucket.errors;
    total.fps.push(...bucket.fps);
    total.bitrate.push(...bucket.bitrate);
    total.height.push(...bucket.height);
    total.gapMs.push(...bucket.gapMs);
    total.backpressure.push(...bucket.backpressure);
    total.freezes.push(...bucket.freezes);
    total.lost.push(...bucket.lost);
  }

  function fpsSource(): ScreenFpsSource {
    return screenFpsSource(options.direction, playbackCounts);
  }

  function closeBucket(now: number): void {
    if (bucket.samples === 0 && bucket.errors === 0) {
      bucket = emptyBucket(now);
      return;
    }
    if (fpsSource() === 'decoded') bucket.fps = bucket.decodedFps;
    const degraded = isDegraded();
    const record = degraded ? minuteRecord(now) : undefined;
    fold();
    minutes += 1;
    if (degraded) {
      degradedMinutes += 1;
      if (record && loggedDegraded < DEGRADED_RECORD_LIMIT) {
        pending.push(record);
        loggedDegraded += 1;
      }
    }
    bucket = emptyBucket(now);
  }

  function totalContext(now: number, final: boolean): LogContext {
    const shared = {
      probeId,
      trackId: options.trackId,
      direction: options.direction,
      final,
      elapsedMs: now - startedAt,
      minutes,
      degradedMinutes,
      samples: total.samples,
      errors: total.errors,
      minFps: minOf(total.fps),
      medianFps: medianOf(total.fps),
      lowSamples: lowSamples(total.fps),
      avgBitrate: meanOf(total.bitrate),
      minHeight: minOf(total.height)
    };
    if (options.direction === 'send')
      return { ...shared, maxGapMs: maxOf(total.gapMs), backpressure: sumOf(total.backpressure) };
    return { ...shared, fpsSource: fpsSource(), freezes: sumOf(total.freezes), lost: sumOf(total.lost) };
  }

  function finish(): void {
    if (stopped) return;
    stopped = true;
    clearTimeout(next);
    const now = Date.now();
    closeBucket(now);
    publishPending();
    log.info('screen sustained total', totalContext(now, true));
    previous = undefined;
    report();
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
      record(current);
      previous = current;
    } catch {
      // Exceptions can contain URLs/SDP. Count failures, never serialize them.
      if (!stopped) bucket.errors += 1;
    }
    if (stopped) return;
    const now = Date.now();
    if (now - bucket.startedAt >= SUMMARY_MS) {
      const closed = minutes;
      closeBucket(now);
      // At the cap finish() publishes and reports once.
      if (minutes >= SUMMARY_LIMIT) {
        finish();
        return;
      }
      let logged = publishPending();
      if (minutes > closed && minutes % RUNNING_TOTAL_MINUTES === 0) {
        log.info('screen sustained total', totalContext(now, false));
        logged = true;
      }
      if (logged) report();
    }
    next = setTimeout(() => void sample(), SAMPLE_MS);
  }

  function record(current: Snapshot): void {
    bucket.samples += 1;
    if (options.direction === 'send') {
      const sample = senderSample(current, previous);
      bucket.fps.push(sample.sentFps);
      bucket.bitrate.push(sample.bitrate);
      bucket.height.push(sample.height);
      bucket.captureFps.push(sample.captureFps);
      bucket.encodedFps.push(sample.encodedFps);
      bucket.backpressure.push(sample.backpressure);
      bucket.gapMs.push(captureGapMs(current));
    } else {
      const sample = receiverSample(current, previous);
      if (playbackCounted(current.playback)) playbackCounts = true;
      bucket.fps.push(sample.renderedFps);
      bucket.decodedFps.push(sample.decodedFps);
      bucket.bitrate.push(sample.bitrate);
      bucket.height.push(sample.height);
      bucket.freezes.push(sample.freezes);
      bucket.lost.push(sample.lost);
    }
  }

  void sample();
  return finish;
}

function present(series: Series): number[] {
  return series.filter((value): value is number => value !== null);
}

function lowSamples(series: Series): number | null {
  const values = present(series);
  return values.length === 0 ? null : values.filter((value) => value < LOW_FPS).length;
}

function minOf(series: Series): number | null {
  const values = present(series);
  return values.length === 0 ? null : Math.min(...values);
}

function maxOf(series: Series): number | null {
  const values = present(series);
  return values.length === 0 ? null : Math.max(...values);
}

function sumOf(series: Series): number | null {
  const values = present(series);
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0);
}

function meanOf(series: Series): number | null {
  const values = present(series);
  return values.length === 0 ? null : Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

function medianOf(series: Series): number | null {
  const values = present(series).sort((a, b) => a - b);
  if (values.length === 0) return null;
  const middle = Math.floor(values.length / 2);
  const value = values.length % 2 ? values[middle] : ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2;
  return value === undefined ? null : Math.round(value * 100) / 100;
}
