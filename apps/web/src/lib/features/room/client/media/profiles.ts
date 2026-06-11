import type { ScreenShareCaptureOptions, ScreenSharePresets, TrackPublishOptions, VideoPreset } from 'livekit-client';
import {
  DEFAULT_SCREEN_FPS_ID,
  DEFAULT_SCREEN_PROFILE_ID,
  DEFAULT_SCREEN_QUALITY_ID,
  SCREEN_ADAPT_PROFILE_ORDER,
  SCREEN_FPS_OPTIONS,
  SCREEN_QUALITY_OPTIONS,
  SCREEN_QUALITY_ORDER,
  SCREEN_VIDEO_BACKUP_CODEC
} from '../core/config';
import type { ScreenProfile } from '../core/types';
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

export function parseScreenProfileId(profileId: string): { qualityId: string; fpsId: string } {
  const normalized = String(profileId || '').trim();
  if (Object.hasOwn(SCREEN_QUALITY_OPTIONS, normalized)) {
    return { qualityId: normalized, fpsId: DEFAULT_SCREEN_FPS_ID };
  }

  const [qualityId, fpsId] = normalized.split('-');
  return {
    fpsId: Object.hasOwn(SCREEN_FPS_OPTIONS, fpsId) ? fpsId : DEFAULT_SCREEN_FPS_ID,
    qualityId: Object.hasOwn(SCREEN_QUALITY_OPTIONS, qualityId) ? qualityId : DEFAULT_SCREEN_QUALITY_ID
  };
}

export function createScreenProfileId(qualityId: string, fpsId: string): string {
  return `${qualityId}-${fpsId}`;
}

export function getScreenProfileRank(profileId: string): number {
  const rank = SCREEN_ADAPT_PROFILE_ORDER.indexOf(getScreenProfile(profileId).id);
  return rank >= 0 ? rank : SCREEN_ADAPT_PROFILE_ORDER.indexOf(DEFAULT_SCREEN_PROFILE_ID);
}

export function getLowerScreenProfileId(profileId: string): string {
  const rank = getScreenProfileRank(profileId);
  return rank > 0 ? SCREEN_ADAPT_PROFILE_ORDER[rank - 1] : '';
}

export function getHigherScreenProfileId(profileId: string, ceilingProfileId: string): string {
  const rank = getScreenProfileRank(profileId);
  const ceilingRank = getScreenProfileRank(ceilingProfileId);
  return rank < ceilingRank ? SCREEN_ADAPT_PROFILE_ORDER[rank + 1] : '';
}

export function getPreferredScreenVideoCodec(): 'vp9' | 'h264' {
  const codecs = RTCRtpSender.getCapabilities?.('video')?.codecs || [];
  return codecs.some((codec) => /video\/vp9/i.test(codec.mimeType)) ? 'vp9' : 'h264';
}

export async function getScreenPublishVideoOptions(profile: ScreenProfile): Promise<TrackPublishOptions> {
  const { VideoPreset } = await loadLiveKitClient();
  const videoCodec = getPreferredScreenVideoCodec();
  const encoding = {
    maxBitrate: profile.videoBitrate,
    maxFramerate: profile.frameRate
  };

  return {
    backupCodec: videoCodec === SCREEN_VIDEO_BACKUP_CODEC ? false : {
      codec: SCREEN_VIDEO_BACKUP_CODEC,
      encoding
    },
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
): VideoPreset[] | undefined {
  const qualityRank = SCREEN_QUALITY_ORDER.indexOf(profile.qualityId);
  const layers: VideoPreset[] = [];
  for (const qualityId of SCREEN_QUALITY_ORDER.slice(0, qualityRank)) {
    const layer = getScreenProfile(createScreenProfileId(qualityId, profile.fpsId));
    layers.push(new VideoPresetClass({
      height: layer.height,
      maxBitrate: layer.videoBitrate,
      maxFramerate: layer.frameRate,
      width: layer.width
    }));
  }
  return layers.length ? layers : undefined;
}

export function formatBitrate(bitrate: number): string {
  if (bitrate >= 1_000_000) {
    return `${(bitrate / 1_000_000).toFixed(bitrate >= 10_000_000 ? 0 : 1)} Mbps`;
  }
  return `${Math.round(bitrate / 1_000)} kbps`;
}

export type { ScreenShareCaptureOptions, ScreenSharePresets };
