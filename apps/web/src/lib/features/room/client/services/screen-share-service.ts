import type { LocalTrackPublication } from 'livekit-client';
import { DEFAULT_SCREEN_STREAM_MODE, SCREEN_STATS_INTERVAL_MS } from '../core/config';
import { state } from '../core/state.svelte';
import { showToast } from '../ui/toast';
import { errorMessage, isCaptureCancelled, isSafariBrowser, stopStream } from '../core/utils';
import {
  createSourceScreenProfile,
  getPreferredScreenVideoCodec,
  getScreenDegradationPreference,
  getScreenModeForProfile,
  getScreenProfile,
  getScreenProfileForMode
} from '../media/profiles';
import { postState } from '../room/presence';
import { setLocalAppAudioSuppressed } from './media-playback-service';
import { playStreamCue } from '../media/cues';
import { getDisplayName } from '../ui/names';
import { publishLocalScreenTracks, unpublishLocalScreenTracks } from './livekit-service';
import { openScreenShare, stopLocalScreenAudioCapture } from './screen-capture-service';
import { TRACK_SOURCE } from '../media/livekit-runtime';
import { updateParticipant } from '../room/participants';
import {
  getActiveScreenPeer,
  hideScreenStage,
  openLocalStreamPreview,
  refreshScreenMeta,
  refreshScreenStage
} from '../ui/screen-view';
import type { ParsedScreenStats, ScreenProfile, ScreenStatsPrevious, ScreenStreamMode } from '../core/types';

export async function handleScreenButtonClick(): Promise<void> {
  if (state.localScreenStream) {
    await stopScreenShare();
    return;
  }

  await startScreenShare(getSelectedScreenProfileId());
}

export function getSelectedScreenProfileId(): string {
  return getScreenProfileForMode(state.localScreenMode || DEFAULT_SCREEN_STREAM_MODE, state.localScreenProfileId).id;
}

function applyLocalScreenProfileState(profile: ScreenProfile, mode: ScreenStreamMode): void {
  state.localScreenMode = mode;
  state.localScreenProfileId = profile.id;
  state.localScreenQualityId = profile.qualityId;
  state.localScreenFpsId = profile.fpsId;
}

export async function startScreenShare(profileId: string = getSelectedScreenProfileId()): Promise<void> {
  if (!state.joined || state.connecting) {
    showToast('Сначала подключитесь к комнате');
    return;
  }
  if (state.localScreenStream) return;

  let profile = getScreenProfile(profileId);
  state.screenStarting = true;
  try {
    const capture = await openScreenShare(profile);
    const stream = capture.stream;
    profile = capture.profile || profile;
    const [videoTrack] = stream.getVideoTracks();
    if (!videoTrack) {
      stopLocalScreenAudioCapture();
      stopStream(stream);
      showToast('Браузер не отдал видео экрана');
      return;
    }

    profile = createSourceScreenProfile(profile, videoTrack);
    const mode = capture.mode || getScreenModeForProfile(profile.id);

    state.localScreenStream = stream;
    applyLocalScreenProfileState(profile, mode);
    state.screenStopping = false;
    setLocalAppAudioSuppressed(false);
    videoTrack.addEventListener('ended', () => {
      stopScreenShare().catch((error) => console.error(error));
    });
    await publishLocalScreenTracks();
    await applyLocalScreenEncodingProfile(profile);
    startLocalScreenStatsMonitor();

    updateParticipant({
      id: state.peerId,
      muted: state.muted,
      name: getDisplayName(),
      screen: true,
      screenAudio: hasScreenAudio(),
      screenProfileId: profile.id,
      screenStreamId: stream.id
    });
    refreshScreenControls();
    openLocalStreamPreview();
    await postState();

    playStreamCue('start');
    showScreenShareStartedToast(profile);
  } catch (error) {
    const cancelled = isCaptureCancelled(error);
    if (!cancelled) console.error(error);
    if (state.localScreenStream) {
      await stopScreenShare({ notify: false, quiet: true }).catch((cleanupError) => console.error(cleanupError));
    } else {
      setLocalAppAudioSuppressed(false);
    }
    showToast(
      cancelled ? 'Демонстрация отменена' : errorMessage(error) || 'Не удалось показать экран',
      cancelled ? undefined : { duration: 12000, variant: 'error' }
    );
  } finally {
    state.screenStarting = false;
    refreshScreenControls();
  }
}

export async function stopScreenShare(options: { notify?: boolean; quiet?: boolean } = {}): Promise<void> {
  if (!state.localScreenStream || state.screenStopping) return;

  state.screenStopping = true;
  try {
    const { notify = true, quiet = false } = options;
    const previousStream = state.localScreenStream;
    state.localScreenStream = null;
    stopLocalScreenStatsMonitor({ refresh: false });

    await unpublishLocalScreenTracks(false);
    stopLocalScreenAudioCapture();
    stopStream(previousStream);
    setLocalAppAudioSuppressed(false);

    updateParticipant({
      id: state.peerId,
      muted: state.muted,
      name: getDisplayName(),
      screen: false,
      screenAudio: false,
      screenProfileId: '',
      screenStreamId: ''
    });
    refreshScreenControls();
    refreshScreenStage();
    if (notify) await postState();
    if (!quiet) {
      playStreamCue('stop');
      showToast('Демонстрация остановлена');
    }
  } finally {
    state.screenStopping = false;
    refreshScreenControls();
  }
}

/** @deprecated Screen dock button is reactive in RoomDock.svelte. */
export function refreshScreenControls(): void {}

export function hasScreenAudio(): boolean {
  return Boolean(state.localScreenStream?.getAudioTracks().some((track) => track.readyState !== 'ended'));
}

function showScreenShareStartedToast(profile: ScreenProfile): void {
  if (hasScreenAudio()) {
    showToast(`Стрим запущен: ${profile.label}, звук включен`);
    return;
  }

  if (isSafariBrowser()) {
    showToast(`Стрим запущен: ${profile.label}, без звука. Safari обычно не дает выбор системного звука для демонстрации.`);
    return;
  }

  showToast(`Стрим запущен: ${profile.label}, без звука`);
}

export function stopLocalScreenStream(): void {
  if (!state.localScreenStream) return;
  stopLocalScreenAudioCapture();
  stopStream(state.localScreenStream);
  state.localScreenStream = null;
  state.screenStopping = false;
  setLocalAppAudioSuppressed(false);
  hideScreenStage();
}

function startLocalScreenStatsMonitor(): void {
  stopLocalScreenStatsMonitor({ refresh: false });
  updateLocalScreenStats().catch((error) => console.warn('Screen stats unavailable', error));
  state.localScreenStatsTimer = window.setInterval(() => {
    updateLocalScreenStats().catch((error) => console.warn('Screen stats unavailable', error));
  }, SCREEN_STATS_INTERVAL_MS);
}

function stopLocalScreenStatsMonitor(options: { refresh?: boolean } = {}): void {
  const { refresh = true } = options;
  window.clearInterval(state.localScreenStatsTimer);
  state.localScreenStatsTimer = 0;
  state.localScreenStats = null;
  state.localScreenStatsPrevious = null;
  if (refresh) refreshScreenMeta(getActiveScreenPeer());
}

async function updateLocalScreenStats(): Promise<void> {
  if (!state.localScreenStream) {
    stopLocalScreenStatsMonitor();
    return;
  }

  const publication = findLocalScreenVideoPublication();
  const track = publication?.track;
  const stats = await track?.getRTCStatsReport?.();
  const parsed = parseLocalScreenStats(stats, state.localScreenStatsPrevious);
  const captureStats = readNativeCaptureStats(state.localScreenStatsPrevious);
  const [mediaTrack] = state.localScreenStream.getVideoTracks();
  const settings = mediaTrack?.getSettings?.() || {};

  state.localScreenStats = {
    availableOutgoingBitrate: parsed.availableOutgoingBitrate ?? 0,
    bitrate: parsed.bitrate || track?.currentBitrate || 0,
    captureDropsBackpressure: captureStats.captureDropsBackpressure,
    captureDropsBackpressureDelta: captureStats.captureDropsBackpressureDelta,
    captureFramesReceived: captureStats.captureFramesReceived,
    captureFramesWritten: captureStats.captureFramesWritten,
    capturePixelFormat: captureStats.capturePixelFormat,
    captureRelayRestarts: captureStats.captureRelayRestarts,
    codec: parsed.codec || (track as { codec?: string } | undefined)?.codec || getPreferredScreenVideoCodec(),
    encoderImplementation: parsed.encoderImplementation || '',
    firCount: parsed.firCount ?? 0,
    firDelta: parsed.firDelta ?? 0,
    fps: parsed.fps || settings.frameRate || 0,
    framesDropped: parsed.framesDropped ?? 0,
    framesDroppedDelta: parsed.framesDroppedDelta ?? 0,
    framesEncoded: parsed.framesEncoded ?? 0,
    framesSent: parsed.framesSent ?? 0,
    height: parsed.height || settings.height || 0,
    keyFramesEncoded: parsed.keyFramesEncoded ?? 0,
    lossPct: parsed.lossPct ?? null,
    nackCount: parsed.nackCount ?? 0,
    nackDelta: parsed.nackDelta ?? 0,
    pliCount: parsed.pliCount ?? 0,
    pliDelta: parsed.pliDelta ?? 0,
    qualityLimitationReason: parsed.qualityLimitationReason || '',
    qpSum: parsed.qpSum ?? 0,
    rttMs: parsed.rttMs ?? null,
    width: parsed.width || settings.width || 0
  };
  state.localScreenStatsPrevious = parsed.previous
    ? { ...parsed.previous, ...captureStats.previous }
    : null;

  const peer = getActiveScreenPeer();
  if (peer?.isLocal) refreshScreenMeta(peer);
}

function findLocalScreenVideoPublication(): LocalTrackPublication | null {
  for (const publication of state.localScreenPublications.values()) {
    if (publication?.source === TRACK_SOURCE.ScreenShare) return publication;
    const track = publication?.track;
    if (track?.kind === 'video' || track?.mediaStreamTrack?.kind === 'video') return publication;
  }
  return null;
}

function readNativeCaptureStats(previous: ScreenStatsPrevious | null): {
  captureDropsBackpressure?: number;
  captureDropsBackpressureDelta?: number;
  captureFramesReceived?: number;
  captureFramesWritten?: number;
  capturePixelFormat?: 'NV12' | 'BGRX';
  captureRelayRestarts?: number;
  previous: Partial<ScreenStatsPrevious>;
} {
  if (typeof window.__voiceRoomNativeCaptureStats !== 'function') {
    return { previous: {} };
  }

  const snapshot = window.__voiceRoomNativeCaptureStats();
  const captureFramesReceived = Number(snapshot.framesReceived || 0);
  const captureFramesWritten = Number(snapshot.framesWritten || 0);
  const capturePixelFormat = snapshot.pixelFormat === 'NV12' || snapshot.pixelFormat === 'BGRX'
    ? snapshot.pixelFormat
    : undefined;
  const captureDropsBackpressure = Number(snapshot.framesDroppedBackpressure || 0)
    + Number(snapshot.relay?.framesDroppedBackpressure || 0);
  const captureRelayRestarts = Number(snapshot.relay?.restarts || 0);

  return {
    captureDropsBackpressure,
    captureDropsBackpressureDelta: previous?.captureDropsBackpressure === undefined
      ? 0
      : Math.max(0, captureDropsBackpressure - Number(previous.captureDropsBackpressure || 0)),
    captureFramesReceived,
    captureFramesWritten,
    capturePixelFormat,
    captureRelayRestarts,
    previous: {
      captureDropsBackpressure,
      captureFramesReceived,
      captureFramesWritten
    }
  };
}

function parseLocalScreenStats(stats: RTCStatsReport | undefined, previous: ScreenStatsPrevious | null): ParsedScreenStats {
  if (!stats?.forEach) return { previous: null };

  const codecs = new Map<string, any>();
  let candidatePair: any = null;
  let outbound: any = null;
  let remoteInbound: any = null;

  stats.forEach((report) => {
    if (report.type === 'codec') {
      codecs.set(report.id, report);
      return;
    }

    if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
      candidatePair = report;
      return;
    }

    if (report.type === 'remote-inbound-rtp' && isVideoStatsReport(report)) {
      remoteInbound = report;
      return;
    }

    if (report.type !== 'outbound-rtp' || report.isRemote || !isVideoStatsReport(report)) return;
    if (!outbound || Number(report.bytesSent || 0) > Number(outbound.bytesSent || 0)) {
      outbound = report;
    }
  });

  if (!outbound) return { previous: null };

  const bytesSent = Number(outbound.bytesSent || 0);
  const framesEncoded = Number(outbound.framesEncoded || 0);
  const timestamp = Number(outbound.timestamp || Date.now());
  const elapsedMs = previous?.timestamp ? timestamp - previous.timestamp : 0;
  const bitrate = elapsedMs > 0 && bytesSent >= previous!.bytesSent
    ? ((bytesSent - previous!.bytesSent) * 8 * 1000) / elapsedMs
    : 0;
  const fps = Number(outbound.framesPerSecond || 0) || (
    elapsedMs > 0 && framesEncoded >= (previous?.framesEncoded ?? Number.POSITIVE_INFINITY)
      ? ((framesEncoded - previous!.framesEncoded) * 1000) / elapsedMs
      : 0
  );
  const codec = getCodecNameFromStats(outbound, codecs);
  const encoderImplementation = String(outbound.encoderImplementation || '');
  const lossPct = Number.isFinite(remoteInbound?.fractionLost) ? remoteInbound.fractionLost * 100 : null;
  const rttMs = Number.isFinite(remoteInbound?.roundTripTime) ? remoteInbound.roundTripTime * 1000 : null;
  const availableOutgoingBitrate = Number(candidatePair?.availableOutgoingBitrate || candidatePair?.availableOutgoingBitrate === 0
    ? candidatePair.availableOutgoingBitrate
    : candidatePair?.estimatedOutgoingBitrate || 0);
  const framesDropped = Number(outbound.framesDropped || 0);
  const firCount = Number(outbound.firCount || 0);
  const nackCount = Number(outbound.nackCount || 0);
  const pliCount = Number(outbound.pliCount || 0);

  return {
    availableOutgoingBitrate,
    bitrate,
    codec,
    encoderImplementation,
    firCount,
    firDelta: previous ? Math.max(0, firCount - Number(previous.firCount || 0)) : 0,
    fps,
    framesDropped,
    framesDroppedDelta: previous ? Math.max(0, framesDropped - Number(previous.framesDropped || 0)) : 0,
    framesEncoded,
    framesSent: Number(outbound.framesSent || 0),
    height: Number(outbound.frameHeight || 0),
    keyFramesEncoded: Number(outbound.keyFramesEncoded || 0),
    lossPct,
    nackCount,
    nackDelta: previous ? Math.max(0, nackCount - Number(previous.nackCount || 0)) : 0,
    pliCount,
    pliDelta: previous ? Math.max(0, pliCount - Number(previous.pliCount || 0)) : 0,
    previous: { bytesSent, encoderImplementation, firCount, framesDropped, framesEncoded, nackCount, pliCount, timestamp },
    qualityLimitationReason: outbound.qualityLimitationReason || '',
    qpSum: Number(outbound.qpSum || 0),
    rttMs,
    width: Number(outbound.frameWidth || 0)
  };
}

function isVideoStatsReport(report: { kind?: string; mediaType?: string }): boolean {
  return report.kind === 'video' || report.mediaType === 'video';
}

function getCodecNameFromStats(report: { codecId?: string }, codecs: Map<string, any>): string {
  const codec = report.codecId ? codecs.get(report.codecId) : undefined;
  const mimeType = codec?.mimeType || codec?.mime || '';
  return mimeType.replace(/^video\//i, '').toUpperCase();
}

async function applyLocalScreenEncodingProfile(profile: ScreenProfile): Promise<void> {
  const tasks: Promise<void>[] = [];

  for (const publication of state.localScreenPublications.values()) {
    const track = publication?.track;
    if (publication?.source !== TRACK_SOURCE.ScreenShare && track?.mediaStreamTrack?.kind !== 'video') continue;
    const sender = (track as { sender?: RTCRtpSender } | undefined)?.sender;
    if (sender) tasks.push(applyScreenSenderEncoding(sender, profile));
  }

  await Promise.allSettled(tasks);
}

async function applyScreenSenderEncoding(sender: RTCRtpSender, profile: ScreenProfile): Promise<void> {
  if (!sender?.getParameters || !sender.setParameters) return;

  const parameters = sender.getParameters();
  if (!parameters.encodings?.length) parameters.encodings = [{}];

  const contentHint = sender.track?.contentHint || profile.contentHint;
  const degradationPreference = getScreenDegradationPreference(contentHint);
  const primaryEncoding = getPrimaryScreenEncoding(parameters.encodings);
  primaryEncoding.maxBitrate = profile.videoBitrate;
  primaryEncoding.maxFramerate = profile.frameRate;
  parameters.degradationPreference = degradationPreference;

  await sender.setParameters(parameters);
}

function getPrimaryScreenEncoding(encodings: RTCRtpEncodingParameters[]): RTCRtpEncodingParameters {
  return encodings.reduce((primary, encoding) => {
    const primaryBitrate = Number(primary.maxBitrate || 0);
    const encodingBitrate = Number(encoding.maxBitrate || 0);
    if (encodingBitrate > primaryBitrate) return encoding;
    if (!primaryBitrate && !primary.rid) return primary;
    return primary;
  }, encodings[0]);
}
