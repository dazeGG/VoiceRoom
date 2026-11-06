import { createLogger, reportClientLogs, type LogContext } from '@/shared/log';
import { isActiveCandidatePair, readRtcStats, type RtcStat, type RtcStatsSource } from './rtc-stats';

const log = createLogger('room:screen-startup');
const WINDOW_MS = 30_000;
const SAMPLE_MS = 1000;

interface CaptureCounters {
  framesReceived?: number | undefined;
  framesWritten?: number | undefined;
  framesDroppedBackpressure?: number | undefined;
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

interface Snapshot {
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
    // at once, each within the intake's 18-key / primitive-value limit.
    log.info('screen startup started', {
      probeId,
      startedAt,
      direction: options.direction,
      trackId: options.trackId,
      profileId: options.profileId
    });
    for (const context of samples) log.info('screen startup sample', context);
    log.info('screen startup ended', {
      probeId,
      elapsedMs: Date.now() - startedAt,
      samples: samples.length,
      errors,
      reason
    });
    samples.length = 0;
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

function senderSample(current: Snapshot, previous: Snapshot | undefined): LogContext {
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
    codec: codecName(current, stat),
    encoder: stat?.encoderImplementation?.slice(0, 200) ?? null
  };
}

function receiverSample(current: Snapshot, previous: Snapshot | undefined): LogContext {
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
