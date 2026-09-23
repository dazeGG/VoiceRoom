import type { ScreenShareCaptureOptions, ScreenSharePresets, TrackPublishOptions, VideoPreset } from 'livekit-client';
import {
  DEFAULT_SCREEN_FPS_ID,
  DEFAULT_SCREEN_PROFILE_ID,
  DEFAULT_SCREEN_QUALITY_ID,
  SCREEN_STREAM_MODE_PROFILES,
  SCREEN_FPS_OPTIONS,
  SCREEN_QUALITY_OPTIONS,
  SCREEN_SIMULCAST_LAYER,
  SCREEN_SOURCE_BASE_BITRATE,
  SCREEN_SOURCE_BASE_PIXELS,
  SCREEN_SOURCE_MAX_BITRATE,
  SCREEN_VIDEO_BACKUP_CODEC
} from '../core/config';
import type { ScreenProfile, ScreenStreamMode } from '../core/types';
import { loadLiveKitClient, TRACK_SOURCE } from './livekit-runtime';

export function getScreenProfile(profileId: string): ScreenProfile {
  const { qualityId, fpsId } = parseScreenProfileId(profileId);
  const quality = SCREEN_QUALITY_OPTIONS[qualityId] || SCREEN_QUALITY_OPTIONS[DEFAULT_SCREEN_QUALITY_ID];
  const fps = SCREEN_FPS_OPTIONS[fpsId] || SCREEN_FPS_OPTIONS[DEFAULT_SCREEN_FPS_ID];
  const videoBitrate = quality.bitrateByFps[fps.id] || quality.bitrateByFps[DEFAULT_SCREEN_FPS_ID];

  return {
    contentHint: fps.contentHint,
    detail: `${quality.label} · ${fps.label} · до ${formatBitrate(videoBitrate)}`,
    frameRate: fps.frameRate,
    fpsId: fps.id,
    height: quality.height,
    id: createScreenProfileId(quality.id, fps.id),
    label: `${quality.label} ${fps.label}`,
    qualityId: quality.id,
    videoBitrate,
    width: quality.width
  };
}

export function getScreenProfileForMode(mode: ScreenStreamMode, fallbackProfileId: string = DEFAULT_SCREEN_PROFILE_ID): ScreenProfile {
  return getScreenProfile(SCREEN_STREAM_MODE_PROFILES[mode] || fallbackProfileId || DEFAULT_SCREEN_PROFILE_ID);
}

export function getScreenModeForProfile(profileId: string): ScreenStreamMode {
  const profile = getScreenProfile(profileId);
  for (const [mode, modeProfileId] of Object.entries(SCREEN_STREAM_MODE_PROFILES)) {
    if (profile.id === getScreenProfile(modeProfileId).id) return mode as ScreenStreamMode;
  }
  return profile.fpsId === '5' ? 'text' : 'games';
}

export function getScreenModeSummary(mode: ScreenStreamMode, fallbackProfileId: string = DEFAULT_SCREEN_PROFILE_ID): string {
  const profile = getScreenProfileForMode(mode, fallbackProfileId);
  if (mode === 'games') return `Более плавное видео (${profile.label})`;
  return `Более чёткий текст (${profile.label})`;
}

export function getScreenProfileLabels(profileId: string): { qualityLabel: string; fpsLabel: string } {
  const profile = getScreenProfile(profileId);
  const { qualityId, fpsId } = parseScreenProfileId(profile.id);
  return {
    qualityLabel: SCREEN_QUALITY_OPTIONS[qualityId]?.label || '',
    fpsLabel: SCREEN_FPS_OPTIONS[fpsId]?.label || ''
  };
}

export function parseScreenProfileId(profileId: string): { qualityId: string; fpsId: string } {
  const normalized = String(profileId || '').trim();
  if (Object.hasOwn(SCREEN_QUALITY_OPTIONS, normalized)) {
    return { qualityId: normalizeScreenQualityId(normalized), fpsId: DEFAULT_SCREEN_FPS_ID };
  }

  const [rawQualityId, rawFpsId] = normalized.split('-');
  return {
    fpsId: normalizeScreenFpsId(rawFpsId),
    qualityId: normalizeScreenQualityId(rawQualityId)
  };
}

function normalizeScreenQualityId(qualityId: string): string {
  if (qualityId === 'low') return 'balanced';
  return Object.hasOwn(SCREEN_QUALITY_OPTIONS, qualityId) ? qualityId : DEFAULT_SCREEN_QUALITY_ID;
}

function normalizeScreenFpsId(fpsId: string): string {
  return Object.hasOwn(SCREEN_FPS_OPTIONS, fpsId) ? fpsId : DEFAULT_SCREEN_FPS_ID;
}

export function createScreenProfileId(qualityId: string, fpsId: string): string {
  return `${normalizeScreenQualityId(qualityId)}-${normalizeScreenFpsId(fpsId)}`;
}

/**
 * Text and UI (contentHint "detail") compress far better with VP9's screen
 * tools than with H.264, while motion keeps H.264 for its hardware encoders
 * and lower CPU. Either way the VP8 backup codec covers viewers that cannot
 * decode the primary one.
 */
export function getPreferredScreenVideoCodec(contentHint = 'motion'): 'h264' | 'vp9' | 'vp8' {
  const codecs = RTCRtpSender.getCapabilities?.('video')?.codecs || [];
  const supports = (pattern: RegExp) => codecs.some((codec) => pattern.test(codec.mimeType));
  const order = contentHint === 'detail' ? ['vp9', 'h264'] as const : ['h264', 'vp9'] as const;
  for (const codec of order) {
    if (supports(codec === 'vp9' ? /video\/vp9/i : /video\/h264/i)) return codec;
  }
  return 'vp8';
}

export function getScreenDegradationPreference(contentHint: string): RTCDegradationPreference {
  return contentHint === 'motion' ? 'maintain-framerate' : 'maintain-resolution';
}

export async function getScreenPublishVideoOptions(profile: ScreenProfile): Promise<TrackPublishOptions> {
  const { VideoPreset } = await loadLiveKitClient();
  const videoCodec = getPreferredScreenVideoCodec(profile.contentHint);
  const encoding = {
    maxBitrate: profile.videoBitrate,
    maxFramerate: profile.frameRate
  };

  return {
    backupCodec: videoCodec === SCREEN_VIDEO_BACKUP_CODEC ? false : {
      codec: SCREEN_VIDEO_BACKUP_CODEC,
      encoding
    },
    // Decided at publish, not only on a later profile switch: motion keeps
    // its frame rate under congestion, text keeps its resolution.
    degradationPreference: getScreenDegradationPreference(profile.contentHint),
    screenShareSimulcastLayers: getScreenSimulcastLayers(profile, VideoPreset),
    screenShareEncoding: encoding,
    simulcast: true,
    source: TRACK_SOURCE.ScreenShare,
    videoCodec
  } as TrackPublishOptions;
}

export function getScreenSimulcastLayers(
  profile: ScreenProfile,
  VideoPresetClass: typeof VideoPreset
): VideoPreset[] {
  const maxBitrate = getSimulcastLayerBitrate(profile.fpsId);
  return [new VideoPresetClass({
    height: SCREEN_SIMULCAST_LAYER.height,
    maxBitrate,
    maxFramerate: profile.frameRate,
    width: SCREEN_SIMULCAST_LAYER.width
  })];
}

function getSimulcastLayerBitrate(fpsId: string): number {
  if (fpsId === '5') return SCREEN_SIMULCAST_LAYER.bitrateByFps[5];
  if (fpsId === '15') return SCREEN_SIMULCAST_LAYER.bitrateByFps[15];
  if (fpsId === '60') return SCREEN_SIMULCAST_LAYER.bitrateByFps[60];
  return SCREEN_SIMULCAST_LAYER.bitrateByFps[30];
}

export function createSourceScreenProfile(baseProfile: ScreenProfile, track: MediaStreamTrack | undefined): ScreenProfile {
  if (baseProfile.qualityId !== 'source') return baseProfile;

  const settings = track?.getSettings?.() || {};
  const width = Math.round(Number(settings.width || 0));
  const height = Math.round(Number(settings.height || 0));
  const pixels = width > 0 && height > 0 ? width * height : SCREEN_SOURCE_BASE_PIXELS;
  const videoBitrate = Math.min(
    SCREEN_SOURCE_MAX_BITRATE,
    Math.max(baseProfile.videoBitrate, Math.round(SCREEN_SOURCE_BASE_BITRATE * (pixels / SCREEN_SOURCE_BASE_PIXELS)))
  );
  const qualityLabel = width > 0 && height > 0 ? `${width}×${height}` : 'Источник';

  return {
    ...baseProfile,
    detail: `${qualityLabel} · ${baseProfile.frameRate} FPS · до ${formatBitrate(videoBitrate)}`,
    height,
    label: `${qualityLabel} ${baseProfile.frameRate} FPS`,
    videoBitrate,
    width
  };
}

export function formatBitrate(bitrate: number): string {
  if (bitrate >= 1_000_000) {
    return `${(bitrate / 1_000_000).toFixed(bitrate >= 10_000_000 ? 0 : 1)} Mbps`;
  }
  return `${Math.round(bitrate / 1_000)} kbps`;
}

export type { ScreenShareCaptureOptions, ScreenSharePresets };
