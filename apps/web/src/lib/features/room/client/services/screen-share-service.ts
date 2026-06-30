import type { LocalTrackPublication } from 'livekit-client';
import {
  DEFAULT_SCREEN_PROFILE_ID,
  SCREEN_ADAPT_GOOD_SAMPLE_TARGET,
  SCREEN_ADAPT_MIN_INTERVAL_MS,
  SCREEN_ADAPT_POOR_SAMPLE_TARGET,
  SCREEN_STATS_INTERVAL_MS
} from '../core/config';
import { elements } from '../ui/dom';
import { state } from '../core/state.svelte';
import { showToast } from '../ui/toast';
import { errorMessage, isCaptureCancelled, isSafariBrowser, stopStream } from '../core/utils';
import {
  getHigherScreenProfileId,
  getLowerScreenProfileId,
  getPreferredScreenVideoCodec,
  getScreenProfile
} from '../media/profiles';
import { postState } from '../room/presence';
import { setLocalAppAudioSuppressed } from './media-playback-service';
import { playStreamCue } from '../media/cues';
import { getDisplayName } from '../ui/names';
import { publishLocalScreenTracks, unpublishLocalScreenTracks } from './livekit-service';
import { applyScreenCaptureProfile, openScreenShare, stopLocalScreenAudioCapture } from './screen-capture-service';
import { TRACK_SOURCE } from '../media/livekit-runtime';
import { updateParticipant } from '../room/participants';
import {
  getActiveScreenPeer,
  hideScreenStage,
  openLocalStreamPreview,
  refreshScreenMeta,
  refreshScreenStage
} from '../ui/screen-view';
import type { ParsedScreenStats, ScreenProfile, ScreenStatsPrevious } from '../core/types';

export async function handleScreenButtonClick(): Promise<void> {
  if (state.localScreenStream) {
    await stopScreenShare();
    return;
  }

  await startScreenShare(DEFAULT_SCREEN_PROFILE_ID);
}

export async function startScreenShare(profileId: string = state.localScreenProfileId): Promise<void> {
  if (!state.joined || state.connecting) {
    showToast('Сначала подключитесь к комнате');
    return;
  }
  if (state.localScreenStream) return;

  let profile = getScreenProfile(profileId);
  elements.screenButton.disabled = true;
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

    state.localScreenStream = stream;
    state.localScreenProfileId = profile.id;
    state.localScreenQualityId = profile.qualityId;
    state.localScreenFpsId = profile.fpsId;
    state.localScreenTargetProfileId = profile.id;
    resetLocalScreenAdaptation();
    state.screenStopping = false;
    setLocalAppAudioSuppressed(false);
    videoTrack.addEventListener('ended', () => {
      stopScreenShare().catch((error) => console.error(error));
    });
    await publishLocalScreenTracks();
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
    elements.screenButton.disabled = false;
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
    resetLocalScreenAdaptation();

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

export function refreshScreenControls(): void {
  const sharing = Boolean(state.localScreenStream);
  const label = sharing ? 'Закончить стрим' : 'Показать экран';

  elements.screenText.textContent = label;
  elements.screenButton.disabled = !state.joined || state.connecting;
  elements.screenButton.setAttribute('aria-label', label);
  elements.screenButton.setAttribute('aria-pressed', String(sharing));
  elements.screenButton.dataset.state = sharing ? 'live' : 'idle';
}

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

function resetLocalScreenAdaptation(): void {
  state.localScreenAdaptGoodSamples = 0;
  state.localScreenAdaptPoorSamples = 0;
  state.localScreenAdaptLastAt = 0;
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
  const [mediaTrack] = state.localScreenStream.getVideoTracks();
  const settings = mediaTrack?.getSettings?.() || {};

  state.localScreenStats = {
    availableOutgoingBitrate: parsed.availableOutgoingBitrate ?? 0,
    bitrate: parsed.bitrate || track?.currentBitrate || 0,
    codec: parsed.codec || (track as { codec?: string } | undefined)?.codec || getPreferredScreenVideoCodec(),
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
  state.localScreenStatsPrevious = parsed.previous;

  const peer = getActiveScreenPeer();
  if (peer?.isLocal) refreshScreenMeta(peer);
  await adaptLocalScreenProfile();
}

function findLocalScreenVideoPublication(): LocalTrackPublication | null {
  for (const publication of state.localScreenPublications.values()) {
    if (publication?.source === TRACK_SOURCE.ScreenShare) return publication;
    const track = publication?.track;
    if (track?.kind === 'video' || track?.mediaStreamTrack?.kind === 'video') return publication;
  }
  return null;
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
    previous: { bytesSent, firCount, framesDropped, framesEncoded, nackCount, pliCount, timestamp },
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

async function adaptLocalScreenProfile(): Promise<void> {
  if (!state.localScreenStream || !state.localScreenStats) return;

  const health = getLocalScreenStatsHealth(state.localScreenStats);
  if (health === 'poor') {
    state.localScreenAdaptPoorSamples += 1;
    state.localScreenAdaptGoodSamples = 0;
  } else if (health === 'good') {
    state.localScreenAdaptGoodSamples += 1;
    state.localScreenAdaptPoorSamples = Math.max(0, state.localScreenAdaptPoorSamples - 1);
  } else {
    state.localScreenAdaptGoodSamples = 0;
    state.localScreenAdaptPoorSamples = Math.max(0, state.localScreenAdaptPoorSamples - 1);
  }

  const now = Date.now();
  if (now - state.localScreenAdaptLastAt < SCREEN_ADAPT_MIN_INTERVAL_MS) return;

  if (state.localScreenAdaptPoorSamples >= SCREEN_ADAPT_POOR_SAMPLE_TARGET) {
    const nextProfileId = getLowerScreenProfileId(state.localScreenProfileId);
    if (nextProfileId) {
      await setLocalScreenProfile(nextProfileId, {
        toast: 'Сеть просела, снизили качество стрима'
      });
      return;
    }
  }

  if (state.localScreenAdaptGoodSamples >= SCREEN_ADAPT_GOOD_SAMPLE_TARGET) {
    const nextProfileId = getHigherScreenProfileId(state.localScreenProfileId, state.localScreenTargetProfileId);
    if (nextProfileId) {
      await setLocalScreenProfile(nextProfileId, {
        toast: 'Сеть стабильна, вернули качество стрима'
      });
    }
  }
}

function getLocalScreenStatsHealth(stats: NonNullable<typeof state.localScreenStats>): 'poor' | 'good' | 'fair' {
  const lossPct = Number(stats.lossPct || 0);
  const rttMs = Number(stats.rttMs || 0);
  const availableOutgoingBitrate = Number(stats.availableOutgoingBitrate || 0);
  const profile = getScreenProfile(state.localScreenProfileId);
  const bandwidthLimited = stats.qualityLimitationReason === 'bandwidth';
  const bitrateConstrained = availableOutgoingBitrate > 0 && availableOutgoingBitrate < profile.videoBitrate * 0.72;
  const receiverPressure = Number(stats.nackDelta || 0) >= 8 || Number(stats.pliDelta || 0) > 0 || Number(stats.firDelta || 0) > 0;
  const encoderPressure = Number(stats.framesDroppedDelta || 0) >= Math.max(3, Math.round(profile.frameRate * 0.25));
  const poorLoss = lossPct >= 5;
  const poorRtt = rttMs >= 650;
  const goodLoss = !stats.lossPct || lossPct < 1;
  const goodRtt = !stats.rttMs || rttMs < 260;
  const goodBitrate = !availableOutgoingBitrate || availableOutgoingBitrate > profile.videoBitrate * 1.25;

  if (bandwidthLimited || bitrateConstrained || receiverPressure || encoderPressure || poorLoss || poorRtt) return 'poor';
  if (goodLoss && goodRtt && goodBitrate) return 'good';
  return 'fair';
}

async function setLocalScreenProfile(profileId: string, options: { toast?: string } = {}): Promise<void> {
  if (!state.localScreenStream) return;

  const profile = getScreenProfile(profileId);
  if (profile.id === state.localScreenProfileId) return;

  state.localScreenProfileId = profile.id;
  state.localScreenQualityId = profile.qualityId;
  state.localScreenFpsId = profile.fpsId;
  state.localScreenAdaptGoodSamples = 0;
  state.localScreenAdaptPoorSamples = 0;
  state.localScreenAdaptLastAt = Date.now();

  await applyScreenCaptureProfile(state.localScreenStream, profile);
  await applyLocalScreenEncodingProfile(profile);

  updateParticipant({
    id: state.peerId,
    muted: state.muted,
    name: getDisplayName(),
    screen: true,
    screenAudio: hasScreenAudio(),
    screenProfileId: profile.id,
    screenStreamId: state.localScreenStream.id
  });
  refreshScreenControls();
  refreshScreenStage();
  await postState();
  if (options.toast) showToast(options.toast);
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
  if (!parameters.encodings?.length) return;

  for (const encoding of parameters.encodings) {
    encoding.maxBitrate = profile.videoBitrate;
    (encoding as RTCRtpEncodingParameters & { maxFramerate?: number }).maxFramerate = profile.frameRate;
  }
  await sender.setParameters(parameters);
}
