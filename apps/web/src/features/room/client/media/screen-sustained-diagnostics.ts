import { createLogger, reportClientLogs, type LogContext } from '@/shared/log';
import { readRtcStats } from './rtc-stats';
import {
  receiverSample,
  senderSample,
  type ScreenStartupDiagnosticsOptions,
  type Snapshot
} from './screen-startup-diagnostics';

const log = createLogger('room:screen-sustained');
const SAMPLE_MS = 2000;
const SUMMARY_MS = 60_000;
const REPORT_EVERY = 5;
/** Two hours of one-minute summaries per publication; sampling stops after that. */
const SUMMARY_LIMIT = 120;
const LOW_FPS = 15;

type Series = (number | null)[];

interface Bucket {
  startedAt: number;
  samples: number;
  errors: number;
  fps: Series;
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

/**
 * Watches a publication beyond the 30-second startup window. It is independent of
 * the startup observer, so a new viewer never restarts it, and it never changes a
 * track, an encoding or a subscription.
 */
export function startScreenSustainedDiagnostics(options: ScreenStartupDiagnosticsOptions): () => void {
  const startedAt = Date.now();
  const probeId = `${options.direction}-sustained-${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const pending: LogContext[] = [];
  let summaries = 0;
  let bucket = emptyBucket(startedAt);
  let previous: Snapshot | undefined;
  let stopped = false;
  let next: ReturnType<typeof setTimeout> | undefined;

  function flush(): void {
    if (pending.length === 0) return;
    for (const context of pending) log.info('screen sustained summary', context);
    pending.length = 0;
    void reportClientLogs('screen sustained diagnostics', 'info').catch(() => {});
  }

  function summarize(now: number): void {
    if (bucket.samples > 0 || bucket.errors > 0) {
      pending.push({
        probeId,
        trackId: options.trackId,
        direction: options.direction,
        elapsedMs: now - startedAt,
        samples: bucket.samples,
        errors: bucket.errors,
        minFps: minOf(bucket.fps),
        medianFps: medianOf(bucket.fps),
        lowSamples:
          present(bucket.fps).length === 0 ? null : present(bucket.fps).filter((value) => value < LOW_FPS).length,
        avgBitrate: meanOf(bucket.bitrate),
        minHeight: minOf(bucket.height),
        ...(options.direction === 'send'
          ? {
              minCaptureFps: minOf(bucket.captureFps),
              minEncodedFps: minOf(bucket.encodedFps),
              maxGapMs: maxOf(bucket.gapMs),
              backpressure: sumOf(bucket.backpressure)
            }
          : { freezes: sumOf(bucket.freezes), lost: sumOf(bucket.lost), minRenderedFps: minOf(bucket.fps) })
      });
      summaries += 1;
    }
    bucket = emptyBucket(now);
    if (pending.length >= REPORT_EVERY) flush();
  }

  function finish(): void {
    if (stopped) return;
    stopped = true;
    clearTimeout(next);
    summarize(Date.now());
    flush();
    previous = undefined;
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
    if (now - bucket.startedAt >= SUMMARY_MS) summarize(now);
    if (summaries >= SUMMARY_LIMIT) {
      finish();
      return;
    }
    next = setTimeout(() => void sample(), SAMPLE_MS);
  }

  function record(current: Snapshot): void {
    bucket.samples += 1;
    if (options.direction === 'send') {
      const context = senderSample(current, previous);
      bucket.fps.push(number(context.sentFps));
      bucket.bitrate.push(number(context.bitrate));
      bucket.height.push(number(context.height));
      bucket.captureFps.push(number(context.captureFps));
      bucket.encodedFps.push(number(context.encodedFps));
      bucket.backpressure.push(number(context.backpressure));
      const gapUs = current.capture?.pipeline?.maxGapUs;
      bucket.gapMs.push(typeof gapUs === 'number' && Number.isFinite(gapUs) ? Math.round(gapUs / 10) / 100 : null);
    } else {
      const context = receiverSample(current, previous);
      bucket.fps.push(number(context.renderedFps));
      bucket.bitrate.push(number(context.bitrate));
      bucket.height.push(number(context.height));
      bucket.freezes.push(number(context.freezes));
      bucket.lost.push(number(context.lost));
    }
  }

  void sample();
  return finish;
}

function number(value: string | number | boolean | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function present(series: Series): number[] {
  return series.filter((value): value is number => value !== null);
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
