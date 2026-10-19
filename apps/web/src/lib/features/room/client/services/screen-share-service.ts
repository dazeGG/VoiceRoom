import type { LocalTrackPublication } from 'livekit-client';
import { DEFAULT_SCREEN_STREAM_MODE, SCREEN_STATS_INTERVAL_MS } from '../core/config';
import { state } from '../core/state.svelte';
import { showToast } from '../ui/toast';
import { errorMessage, isCaptureCancelled, isSafariBrowser, stopStream } from '../core/utils';
import {
  createSourceScreenProfile,
  getPreferredScreenVideoCodec,
  SCREEN_DEGRADATION_PREFERENCE,
  getScreenModeForProfile,
  getScreenProfile,
  getScreenProfileForMode
} from '../media/profiles';
import { postState } from '../room/presence';
import { setLocalAppAudioSuppressed } from './media-playback-service';
import { playStreamCue } from '../media/cues';
import { getDisplayName } from '../ui/names';
import { publishLocalScreenTracks, unpublishLocalScreenTracks } from './livekit-service';
import { applyScreenCaptureProfile, openScreenShare } from './screen-capture-service';
import { askForMedia, describeMediaRefusal } from './media-grant';
import { screenProfileBitrate } from '@voice-room/shared/media-budget';
import { onDesktopScreenAudioLost, stopLocalScreenAudioCapture } from './desktop-screen-audio';
import { readRtcStats, type RtcStat } from '../media/rtc-stats';
import { isScreenVideoPublication } from './livekit/publication-kinds';
import { updateParticipant } from '../room/participants';
import { isMicrophoneShownMuted } from '../core/microphone-mute';
import {
  getActiveScreenPeer,
  hideScreenStage,
  openLocalStreamPreview,
  refreshScreenMeta,
  refreshScreenStage
} from '../ui/screen-view';
import type { ParsedScreenStats, ScreenProfile, ScreenStatsPrevious, ScreenStreamMode } from '../core/types';

import { createLogger, errorContext } from '$lib/shared/log';

const log = createLogger('room:screen-share');

// The desktop app gave up restarting its stream-audio helper: the picture keeps
// going without sound. Offer a restart, which reopens the picker.
onDesktopScreenAudioLost(() => {
  if (!state.localScreenStream) return;
  showToast('Звук стрима пропал', {
    action: restartScreenShare,
    actionLabel: 'Перезапустить',
    description: 'Картинка продолжает идти. Перезапустите демонстрацию, чтобы вернуть звук.',
    duration: 15000,
    variant: 'error'
  });
});

async function restartScreenShare(): Promise<void> {
  const profileId = getSelectedScreenProfileId();
  await stopScreenShare({ quiet: true });
  await startScreenShare(profileId);
}

export async function handleScreenButtonClick(): Promise<void> {
  if (state.localScreenStream) {
    await stopScreenShare();
    return;
  }

  await startScreenShare(getSelectedScreenProfileId());
}

function getSelectedScreenProfileId(): string {
  return getScreenProfileForMode(state.localScreenMode || DEFAULT_SCREEN_STREAM_MODE, state.localScreenProfileId).id;
}

function applyLocalScreenProfileState(profile: ScreenProfile, mode: ScreenStreamMode): void {
  state.localScreenMode = mode;
  state.localScreenProfileId = profile.id;
  state.localScreenQualityId = profile.qualityId;
  state.localScreenFpsId = profile.fpsId;
}

async function startScreenShare(profileId: string = getSelectedScreenProfileId()): Promise<void> {
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

    const mode = capture.mode || getScreenModeForProfile(profile.id);
    // Asked once the picker settled the profile: a busy server may offer a
    // lower one, or refuse. The person's chosen mode stays as it was.
    const grant = await askForMedia('screen', profile.id);
    // While the server answered, the person may have left the room or ended
    // the capture from the browser's sharing bar.
    if ((grant && !grant.granted) || !state.joined || videoTrack.readyState === 'ended') {
      stopLocalScreenAudioCapture();
      stopStream(stream);
      if (grant && !grant.granted) showToast(describeMediaRefusal(grant), { duration: 12000, variant: 'error' });
      return;
    }
    const requestedLabel = profile.label;
    const grantedProfileId = grant?.profileId || profile.id;
    const lowered = screenProfileBitrate(grantedProfileId) < screenProfileBitrate(profile.id);
    if (lowered) {
      profile = getScreenProfile(grantedProfileId);
      await applyScreenCaptureProfile(stream, profile);
    }
    profile = createSourceScreenProfile(profile, videoTrack);

    state.localScreenStream = stream;
    applyLocalScreenProfileState(profile, mode);
    state.screenStopping = false;
    setLocalAppAudioSuppressed(false);
    // 'ended' never fires for our own stop(): the OS, the browser's sharing bar,
    // a closed window or a capture helper that gave up ended the share.
    videoTrack.addEventListener('ended', () => {
      stopScreenShare({ offerRestart: true }).catch((error: unknown) =>
        log.error('screen share failed', errorContext(error))
      );
    });
    await publishLocalScreenTracks();
    await applyLocalScreenEncodingProfile(profile);
    startLocalScreenStatsMonitor();

    updateParticipant({
      id: state.peerId,
      muted: isMicrophoneShownMuted(),
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
    if (lowered) {
      showToast(`Сервер загружен: стрим идёт в ${profile.label} вместо ${requestedLabel}`, { duration: 8000 });
    } else {
      showScreenShareStartedToast(profile);
    }
  } catch (error) {
    const cancelled = isCaptureCancelled(error);
    if (!cancelled) log.error('screen share failed', errorContext(error));
    if (state.localScreenStream) {
      await stopScreenShare({ notify: false, quiet: true }).catch((cleanupError: unknown) =>
        log.error('screen share failed', errorContext(cleanupError))
      );
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

async function stopScreenShare(
  options: { notify?: boolean; offerRestart?: boolean; quiet?: boolean } = {}
): Promise<void> {
  if (!state.localScreenStream || state.screenStopping) return;

  state.screenStopping = true;
  try {
    const { notify = true, offerRestart = false, quiet = false } = options;
    const previousStream = state.localScreenStream;
    state.localScreenStream = null;
    stopLocalScreenStatsMonitor({ refresh: false });

    await unpublishLocalScreenTracks(false);
    stopLocalScreenAudioCapture();
    stopStream(previousStream);
    setLocalAppAudioSuppressed(false);

    updateParticipant({
      id: state.peerId,
      muted: isMicrophoneShownMuted(),
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
      showToast(
        'Демонстрация остановлена',
        offerRestart && state.joined
          ? {
              action: () => startScreenShare(getSelectedScreenProfileId()),
              actionLabel: 'Показать снова'
            }
          : undefined
      );
    }
  } finally {
    state.screenStopping = false;
    refreshScreenControls();
  }
}

/** @deprecated Screen dock button is reactive in RoomDock.svelte. */
export function refreshScreenControls(): void {}

function hasScreenAudio(): boolean {
  return Boolean(state.localScreenStream?.getAudioTracks().some((track) => track.readyState !== 'ended'));
}

function showScreenShareStartedToast(profile: ScreenProfile): void {
  if (hasScreenAudio()) {
    showToast(`Стрим запущен: ${profile.label}, звук включен`);
    return;
  }

  if (isSafariBrowser()) {
    showToast(
      `Стрим запущен: ${profile.label}, без звука. Safari обычно не дает выбор системного звука для демонстрации.`
    );
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
  updateLocalScreenStats().catch((error: unknown) => log.warn('screen stats unavailable', errorContext(error)));
  state.localScreenStatsTimer = window.setInterval(() => {
    updateLocalScreenStats().catch((error: unknown) => log.warn('screen stats unavailable', errorContext(error)));
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
    codec: parsed.codec || track?.codec || getPreferredScreenVideoCodec(),
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
  state.localScreenStatsPrevious = parsed.previous ? { ...parsed.previous, ...captureStats.previous } : null;

  const peer = getActiveScreenPeer();
  if (peer?.isLocal) refreshScreenMeta(peer);
}

function findLocalScreenVideoPublication(): LocalTrackPublication | null {
  for (const publication of state.localScreenPublications.values()) {
    if (isScreenVideoPublication(publication)) return publication;
    const track = publication?.track;
    const kind: string | undefined = track?.kind;
    if (kind === 'video' || track?.mediaStreamTrack?.kind === 'video') return publication;
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
  const capturePixelFormat =
    snapshot.pixelFormat === 'NV12' || snapshot.pixelFormat === 'BGRX' ? snapshot.pixelFormat : undefined;
  const captureDropsBackpressure =
    Number(snapshot.framesDroppedBackpressure || 0) + Number(snapshot.relay?.framesDroppedBackpressure || 0);
  const captureRelayRestarts = Number(snapshot.relay?.restarts || 0);

  return {
    captureDropsBackpressure,
    captureDropsBackpressureDelta:
      previous?.captureDropsBackpressure === undefined
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

function parseLocalScreenStats(
  report: RTCStatsReport | undefined,
  previous: ScreenStatsPrevious | null
): ParsedScreenStats {
  const stats = readRtcStats(report);
  let candidatePair: RtcStat | null = null;
  let outbound: RtcStat | null = null;
  let remoteInbound: RtcStat | null = null;

  for (const stat of stats.values()) {
    if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && stat.nominated) {
      candidatePair = stat;
      continue;
    }

    if (stat.type === 'remote-inbound-rtp' && isVideoStatsReport(stat)) {
      remoteInbound = stat;
      continue;
    }

    if (stat.type !== 'outbound-rtp' || stat.isRemote || !isVideoStatsReport(stat)) continue;
    if (!outbound || (stat.bytesSent || 0) > (outbound.bytesSent || 0)) {
      outbound = stat;
    }
  }

  if (!outbound) return { previous: null };

  const bytesSent = outbound.bytesSent || 0;
  const framesEncoded = outbound.framesEncoded || 0;
  const timestamp = outbound.timestamp || Date.now();
  const elapsedMs = previous?.timestamp ? timestamp - previous.timestamp : 0;
  const bitrate =
    previous && elapsedMs > 0 && bytesSent >= previous.bytesSent
      ? ((bytesSent - previous.bytesSent) * 8 * 1000) / elapsedMs
      : 0;
  const fps =
    outbound.framesPerSecond ||
    0 ||
    (previous && elapsedMs > 0 && framesEncoded >= previous.framesEncoded
      ? ((framesEncoded - previous.framesEncoded) * 1000) / elapsedMs
      : 0);
  const codec = getCodecNameFromStats(outbound, stats);
  const encoderImplementation = outbound.encoderImplementation || '';
  const fractionLost = remoteInbound?.fractionLost;
  const lossPct = fractionLost !== undefined && Number.isFinite(fractionLost) ? fractionLost * 100 : null;
  const roundTripTime = remoteInbound?.roundTripTime;
  const rttMs = roundTripTime !== undefined && Number.isFinite(roundTripTime) ? roundTripTime * 1000 : null;
  const available = candidatePair?.availableOutgoingBitrate;
  const availableOutgoingBitrate =
    available || available === 0 ? available : candidatePair?.estimatedOutgoingBitrate || 0;
  const framesDropped = outbound.framesDropped || 0;
  const firCount = outbound.firCount || 0;
  const nackCount = outbound.nackCount || 0;
  const pliCount = outbound.pliCount || 0;

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
    framesSent: outbound.framesSent || 0,
    height: outbound.frameHeight || 0,
    keyFramesEncoded: outbound.keyFramesEncoded || 0,
    lossPct,
    nackCount,
    nackDelta: previous ? Math.max(0, nackCount - Number(previous.nackCount || 0)) : 0,
    pliCount,
    pliDelta: previous ? Math.max(0, pliCount - Number(previous.pliCount || 0)) : 0,
    previous: {
      bytesSent,
      encoderImplementation,
      firCount,
      framesDropped,
      framesEncoded,
      nackCount,
      pliCount,
      timestamp
    },
    qualityLimitationReason: outbound.qualityLimitationReason || '',
    qpSum: outbound.qpSum || 0,
    rttMs,
    width: outbound.frameWidth || 0
  };
}

function isVideoStatsReport(report: RtcStat): boolean {
  return report.kind === 'video' || report.mediaType === 'video';
}

function getCodecNameFromStats(report: RtcStat, stats: Map<string, RtcStat>): string {
  const entry = report.codecId ? stats.get(report.codecId) : undefined;
  const codec = entry?.type === 'codec' ? entry : undefined;
  const mimeType = codec?.mimeType || codec?.mime || '';
  return mimeType.replace(/^video\//i, '').toUpperCase();
}

async function applyLocalScreenEncodingProfile(profile: ScreenProfile): Promise<void> {
  const tasks: Promise<void>[] = [];

  for (const publication of state.localScreenPublications.values()) {
    const track = publication?.track;
    if (!isScreenVideoPublication(publication) && track?.mediaStreamTrack?.kind !== 'video') continue;
    const sender = track?.sender;
    if (sender) tasks.push(applyScreenSenderEncoding(sender, profile));
  }

  await Promise.allSettled(tasks);
}

async function applyScreenSenderEncoding(sender: RTCRtpSender, profile: ScreenProfile): Promise<void> {
  if (!sender?.getParameters || !sender.setParameters) return;

  const parameters = sender.getParameters();
  if (!parameters.encodings?.length) parameters.encodings = [{}];

  const primaryEncoding = getPrimaryScreenEncoding(parameters.encodings);
  primaryEncoding.maxBitrate = profile.videoBitrate;
  primaryEncoding.maxFramerate = profile.frameRate;
  parameters.degradationPreference = SCREEN_DEGRADATION_PREFERENCE;

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
