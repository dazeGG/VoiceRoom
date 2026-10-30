import type { ScreenShareCaptureOptions, ScreenSharePresets, TrackPublishOptions, VideoPreset } from 'livekit-client';
import {
  DEFAULT_SCREEN_FPS,
  DEFAULT_SCREEN_FPS_ID,
  DEFAULT_SCREEN_QUALITY,
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
import { loadLiveKitClient } from './livekit-runtime';

export function getScreenProfile(profileId: string): ScreenProfile {
  const { qualityId, fpsId } = parseScreenProfileId(profileId);
  const quality = SCREEN_QUALITY_OPTIONS[qualityId] ?? DEFAULT_SCREEN_QUALITY;
  const fps = SCREEN_FPS_OPTIONS[fpsId] ?? DEFAULT_SCREEN_FPS;
  const videoBitrate = quality.bitrateByFps[fps.id];

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

export function getScreenProfileForMode(
  mode: ScreenStreamMode,
  fallbackProfileId: string = DEFAULT_SCREEN_PROFILE_ID
): ScreenProfile {
  return getScreenProfile(SCREEN_STREAM_MODE_PROFILES[mode] || fallbackProfileId || DEFAULT_SCREEN_PROFILE_ID);
}

export function getScreenModeForProfile(profileId: string): ScreenStreamMode {
  const profile = getScreenProfile(profileId);
  const modes: ScreenStreamMode[] = ['games', 'text'];
  for (const mode of modes) {
    if (profile.id === getScreenProfile(SCREEN_STREAM_MODE_PROFILES[mode]).id) return mode;
  }
  return profile.fpsId === '5' ? 'text' : 'games';
}

export function getScreenModeSummary(
  mode: ScreenStreamMode,
  fallbackProfileId: string = DEFAULT_SCREEN_PROFILE_ID
): string {
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

function parseScreenProfileId(profileId: string): { qualityId: string; fpsId: string } {
  const normalized = String(profileId || '').trim();
  if (Object.hasOwn(SCREEN_QUALITY_OPTIONS, normalized)) {
    return { qualityId: normalizeScreenQualityId(normalized), fpsId: DEFAULT_SCREEN_FPS_ID };
  }

  const [rawQualityId = '', rawFpsId = ''] = normalized.split('-');
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
function supportsVideoCodec(pattern: RegExp): boolean {
  const codecs = RTCRtpSender.getCapabilities?.('video')?.codecs || [];
  return codecs.some((codec) => pattern.test(codec.mimeType));
}

/**
 * A camera goes out in H.264 where the browser can send it: most graphics
 * cards encode and nearly all decode it in hardware, where VP8 stays on the
 * CPU. VP8 is the fallback, and the backup codec for viewers without H.264.
 */
export function getPreferredCameraVideoCodec(): 'h264' | 'vp8' {
  return supportsVideoCodec(/video\/h264/i) ? 'h264' : 'vp8';
}

export function getPreferredScreenVideoCodec(contentHint = 'motion'): 'h264' | 'vp9' | 'vp8' {
  const supports = supportsVideoCodec;
  const order = contentHint === 'detail' ? (['vp9', 'h264'] as const) : (['h264', 'vp9'] as const);
  for (const codec of order) {
    if (supports(codec === 'vp9' ? /video\/vp9/i : /video\/h264/i)) return codec;
  }
  return 'vp8';
}

/**
 * Every mode keeps its resolution. With "maintain-framerate" (or "balanced")
 * Chrome starts a 720p stream at 180p and climbs back over about a minute, both
 * when the share starts and when dynacast wakes a paused layer for a new viewer.
 */
export const SCREEN_DEGRADATION_PREFERENCE: RTCDegradationPreference = 'maintain-resolution';

export async function getScreenPublishVideoOptions(profile: ScreenProfile): Promise<TrackPublishOptions> {
  const { Track, VideoPreset } = await loadLiveKitClient();
  const videoCodec = getPreferredScreenVideoCodec(profile.contentHint);
  const encoding = {
    maxBitrate: profile.videoBitrate,
    maxFramerate: profile.frameRate
  };

  return {
    backupCodec:
      videoCodec === SCREEN_VIDEO_BACKUP_CODEC
        ? false
        : {
            codec: SCREEN_VIDEO_BACKUP_CODEC,
            encoding
          },
    // Decided at publish, not only on a later profile switch, so the first
    // frames already go out at the full resolution.
    degradationPreference: SCREEN_DEGRADATION_PREFERENCE,
    screenShareSimulcastLayers: getScreenSimulcastLayers(profile, VideoPreset),
    screenShareEncoding: encoding,
    simulcast: true,
    source: Track.Source.ScreenShare,
    videoCodec
  };
}

function getScreenSimulcastLayers(profile: ScreenProfile, VideoPresetClass: typeof VideoPreset): VideoPreset[] {
  const maxBitrate = getSimulcastLayerBitrate(profile.fpsId);
  return [
    new VideoPresetClass({
      height: SCREEN_SIMULCAST_LAYER.height,
      maxBitrate,
      maxFramerate: profile.frameRate,
      width: SCREEN_SIMULCAST_LAYER.width
    })
  ];
}

function getSimulcastLayerBitrate(fpsId: string): number {
  if (fpsId === '5') return SCREEN_SIMULCAST_LAYER.bitrateByFps[5];
  if (fpsId === '15') return SCREEN_SIMULCAST_LAYER.bitrateByFps[15];
  if (fpsId === '60') return SCREEN_SIMULCAST_LAYER.bitrateByFps[60];
  return SCREEN_SIMULCAST_LAYER.bitrateByFps[30];
}

export function createSourceScreenProfile(
  baseProfile: ScreenProfile,
  track: MediaStreamTrack | undefined
): ScreenProfile {
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

function formatBitrate(bitrate: number): string {
  if (bitrate >= 1_000_000) {
    return `${(bitrate / 1_000_000).toFixed(bitrate >= 10_000_000 ? 0 : 1)} Mbps`;
  }
  return `${Math.round(bitrate / 1_000)} kbps`;
}

export type { ScreenShareCaptureOptions, ScreenSharePresets };
