import { createLogger, reportClientLogs, type LogContext } from '@/shared/log';
import { isActiveCandidatePair, readRtcStats, type RtcStat, type RtcStatsSource } from './rtc-stats';

const log = createLogger('room:screen-startup');
const WINDOW_MS = 30_000;
const SAMPLE_MS = 1000;
const PIPELINE_RECORD_LIMIT = 16;

/** Cumulative since helper start, except the max*Us fields (about the last 2 s). */
export interface PipelineCounters {
  seq: number;
  backend: string;
  acquired: number;
  acquireAttempts?: number | undefined;
  acquireEmpty?: number | undefined;
  callbackArrivals?: number | undefined;
  maxLockWaitUs?: number | undefined;
  pacingSkips: number;
  pausedSkips: number;
  written: number;
  accumulated?: number | undefined;
  sumMapUs: number;
  sumWriteUs: number;
  maxGapUs: number;
  maxMapUs: number;
  maxWriteUs: number;
}

export interface CaptureCounters {
  sessionId?: string | undefined;
  restarts?: number | undefined;
  pipeline?: PipelineCounters | undefined;
  framesReceived?: number | undefined;
  framesWritten?: number | undefined;
  framesDroppedBackpressure?: number | undefined;
  relayPausedMs?: number | undefined;
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

/** Observes startup only; it never changes a track, an encoding or a subscription. */
export function startScreenStartupDiagnostics(options: ScreenStartupDiagnosticsOptions): () => void {
  const startedAt = Date.now();
  const probeId = `${options.direction}-${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const samples: LogContext[] = [];
  // Separate records: the sender sample already uses all 18 intake keys.
  const pipelineRecords: LogContext[] = [];
  let previousPipeline: PipelineCounters | undefined;
  let previousIdentity: Pick<CaptureCounters, 'sessionId' | 'restarts'> | undefined;
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
    // Keep the global log ring free during sampling. At most 32 records enter it
    // at once (30 samples, at most 16 pipeline records, 2 markers), each within
    // the intake's 18-key / primitive-value limit.
    log.info('screen startup started', {
      probeId,
      startedAt,
      direction: options.direction,
      trackId: options.trackId,
      profileId: options.profileId
    });
    for (const context of samples) log.info('screen startup sample', context);
    for (const context of pipelineRecords) log.info('screen capture pipeline', context);
    log.info('screen startup ended', {
      probeId,
      elapsedMs: Date.now() - startedAt,
      samples: samples.length,
      errors,
      reason
    });
    samples.length = 0;
    pipelineRecords.length = 0;
    previous = undefined;
    void reportClientLogs('screen startup diagnostics', 'info').catch(() => {});
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
      if (samples.length < WINDOW_MS / SAMPLE_MS) {
        samples.push({
          probeId,
          elapsedMs: current.at - startedAt,
          ...(options.direction === 'send' ? senderSample(current, previous) : receiverSample(current, previous))
        });
      }
      const pipeline = current.capture?.pipeline;
      const identity = current.capture;
      if (!pipeline) {
        previousPipeline = undefined;
        previousIdentity = undefined;
      } else {
        const changed =
          previousPipeline &&
          (pipeline.backend !== previousPipeline.backend ||
            pipeline.seq < previousPipeline.seq ||
            (identity?.sessionId !== undefined &&
              previousIdentity?.sessionId !== undefined &&
              identity.sessionId !== previousIdentity.sessionId) ||
            (identity?.restarts !== undefined &&
              previousIdentity?.restarts !== undefined &&
              identity.restarts !== previousIdentity.restarts));
        if (changed) previousPipeline = undefined;
        // Compare identity before deduplicating repeated relay snapshots.
        if (pipeline.seq !== previousPipeline?.seq) {
          if (pipelineRecords.length < PIPELINE_RECORD_LIMIT) {
            pipelineRecords.push({
              probeId,
              elapsedMs: current.at - startedAt,
              ...pipelineRecord(pipeline, previousPipeline)
            });
          }
          previousPipeline = pipeline;
        }
        previousIdentity = {
          sessionId: identity?.sessionId ?? previousIdentity?.sessionId,
          restarts: identity?.restarts ?? previousIdentity?.restarts
        };
      }
      previous = current;
    } catch {
      // Exceptions can contain URLs/SDP. Count failures, never serialize them.
      if (!stopped) errors += 1;
    }
    // Schedule after completion: even a slow getStats cannot overlap itself.
    if (!stopped) next = setTimeout(() => void sample(), SAMPLE_MS);
  }

  void sample();
  return () => finish('stopped');
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

function pipelineRecord(current: PipelineCounters, before: PipelineCounters | undefined): LogContext {
  const written = delta(current.written, before?.written);
  const averageMs = (sumUs: number | null) =>
    sumUs !== null && written !== null && written > 0 ? rounded(sumUs / written / 1000) : null;
  const ms = (us: number | undefined) => {
    const value = finite(us);
    return value === null ? null : rounded(value / 1000);
  };
  return {
    seq: finite(current.seq),
    backend: current.backend.slice(0, 20),
    acquired: delta(current.acquired, before?.acquired),
    acquireAttempts: delta(current.acquireAttempts, before?.acquireAttempts),
    acquireEmpty: delta(current.acquireEmpty, before?.acquireEmpty),
    callbackArrivals: delta(current.callbackArrivals, before?.callbackArrivals),
    maxLockWaitMs: ms(current.maxLockWaitUs),
    pacingSkips: delta(current.pacingSkips, before?.pacingSkips),
    pausedSkips: delta(current.pausedSkips, before?.pausedSkips),
    written,
    accumulated: delta(current.accumulated, before?.accumulated),
    maxGapMs: ms(current.maxGapUs),
    maxMapMs: ms(current.maxMapUs),
    avgMapMs: averageMs(delta(current.sumMapUs, before?.sumMapUs)),
    maxWriteMs: ms(current.maxWriteUs),
    avgWriteMs: averageMs(delta(current.sumWriteUs, before?.sumWriteUs))
  };
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

export function senderSample(current: Snapshot, previous: Snapshot | undefined): LogContext {
  const stat = videoLayer(current.stats, 'outbound-rtp');
  const before = stat ? previous?.stats.get(stat.id) : undefined;
  const interval = frameInterval(current, previous, stat);
  const elapsed = previous ? current.at - previous.at : 0;
  const encoded = delta(stat?.framesEncoded, before?.framesEncoded);
  const encodeSeconds = delta(stat?.totalEncodeTime, before?.totalEncodeTime);
  const source = stat?.mediaSourceId ? current.stats.get(stat.mediaSourceId) : undefined;
  const previousSource = source ? previous?.stats.get(source.id) : undefined;
  const nativeReceived = delta(current.capture?.framesReceived, previous?.capture?.framesReceived);
  const pair = [...current.stats.values()].find(isActiveCandidatePair);
  const bytes = delta(stat?.bytesSent, before?.bytesSent);
  return {
    layerId: stat?.id.slice(0, 200) ?? null,
    captureFps:
      current.capture?.framesReceived !== undefined
        ? perSecond(nativeReceived, elapsed)
        : (finite(source?.framesPerSecond) ??
          perSecond(delta(source?.frames, previousSource?.frames), frameInterval(current, previous, source))),
    writtenFps: perSecond(delta(current.capture?.framesWritten, previous?.capture?.framesWritten), elapsed),
    encodedFps: finite(stat?.framesPerSecond) ?? perSecond(encoded, interval),
    sentFps: perSecond(delta(stat?.framesSent, before?.framesSent), interval),
    bitrate: perSecond(bytes === null ? null : bytes * 8, interval),
    width: finite(stat?.frameWidth),
    height: finite(stat?.frameHeight),
    limitation: stat?.qualityLimitationReason?.slice(0, 200) ?? null,
    availableBitrate: finite(pair?.availableOutgoingBitrate) ?? finite(pair?.estimatedOutgoingBitrate),
    encodeMs:
      encoded !== null && encoded > 0 && encodeSeconds !== null ? rounded((encodeSeconds * 1000) / encoded) : null,
    dropped: delta(stat?.framesDropped, before?.framesDropped),
    backpressure: delta(current.capture?.framesDroppedBackpressure, previous?.capture?.framesDroppedBackpressure),
    // Cumulative, not a 1s delta: relay snapshots arrive only every 2 seconds.
    // Missing on older desktops; do not mistake missing telemetry for no pause.
    relayPausedMs: rounded(finite(current.capture?.relayPausedMs)),
    codec: codecName(current, stat),
    encoder: stat?.encoderImplementation?.slice(0, 200) ?? null
  };
}

export function receiverSample(current: Snapshot, previous: Snapshot | undefined): LogContext {
  const stat = videoLayer(current.stats, 'inbound-rtp');
  const before = stat ? previous?.stats.get(stat.id) : undefined;
  const interval = frameInterval(current, previous, stat);
  const shown = current.playback ? current.playback.totalVideoFrames - current.playback.droppedVideoFrames : undefined;
  const shownBefore = previous?.playback
    ? previous.playback.totalVideoFrames - previous.playback.droppedVideoFrames
    : undefined;
  const bytes = delta(stat?.bytesReceived, before?.bytesReceived);
  const jitter = finite(stat?.jitter);
  return {
    layerId: stat?.id.slice(0, 200) ?? null,
    receivedFps: perSecond(delta(stat?.framesReceived, before?.framesReceived), interval),
    decodedFps: finite(stat?.framesPerSecond) ?? perSecond(delta(stat?.framesDecoded, before?.framesDecoded), interval),
    renderedFps: perSecond(delta(shown, shownBefore), previous ? current.at - previous.at : 0),
    bitrate: perSecond(bytes === null ? null : bytes * 8, interval),
    width: finite(stat?.frameWidth),
    height: finite(stat?.frameHeight),
    dropped: delta(stat?.framesDropped, before?.framesDropped),
    lost: delta(stat?.packetsLost, before?.packetsLost),
    freezes: delta(stat?.freezeCount, before?.freezeCount),
    jitterMs: jitter === null ? null : rounded(jitter * 1000),
    codec: codecName(current, stat)
  };
}
