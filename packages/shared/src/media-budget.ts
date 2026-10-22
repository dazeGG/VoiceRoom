// What a screen share or a camera costs the media server: the bitrate it sends
// each viewer. The web encodes at these rates, and the API adds them up against
// the server's media budget before it lets a new stream or camera start.

export type ScreenQualityId = 'balanced' | 'high' | 'source';
export type ScreenFpsId = '5' | '15' | '30' | '60';

/** Top-layer bitrate in bit/s for each quality and frame rate. */
export const SCREEN_BITRATE_BY_QUALITY: Readonly<Record<ScreenQualityId, Readonly<Record<ScreenFpsId, number>>>> = {
  balanced: { 5: 1_200_000, 15: 3_000_000, 30: 5_000_000, 60: 7_500_000 },
  high: { 5: 1_800_000, 15: 4_000_000, 30: 7_000_000, 60: 10_000_000 },
  // The floor for a 1080p capture: the web raises it with the screen's pixels.
  source: { 5: 1_800_000, 15: 3_000_000, 30: 7_000_000, 60: 10_000_000 }
};

/**
 * The budget counts a source capture at least at what a 1440p screen sends
 * (the web scales the rate by pixels, up to 12 Mbit/s for 4K), so text mode on
 * a big screen is not charged as 1080p.
 */
const SOURCE_BUDGET_FLOOR = Math.round((1_800_000 * (2560 * 1440)) / (1920 * 1080));

/** Each camera viewer is counted at the 360p simulcast layer a grid tile asks for. */
export const CAMERA_VIEWER_BITRATE = 450_000;

const SCREEN_QUALITIES: readonly ScreenQualityId[] = ['balanced', 'high', 'source'];
const SCREEN_FPS_STEPS: readonly ScreenFpsId[] = ['60', '30', '15', '5'];
const DEFAULT_SCREEN_PROFILE: { quality: ScreenQualityId; fps: ScreenFpsId } = { quality: 'balanced', fps: '30' };

function parseScreenProfile(profileId: string): { quality: ScreenQualityId; fps: ScreenFpsId } {
  const [rawQuality = '', rawFps = DEFAULT_SCREEN_PROFILE.fps] = String(profileId || '').split('-');
  // 'low' is the old name of 720p.
  const name = rawQuality === 'low' ? 'balanced' : rawQuality;
  const quality = SCREEN_QUALITIES.find((step) => step === name);
  if (!quality) return DEFAULT_SCREEN_PROFILE;
  const fps = SCREEN_FPS_STEPS.find((step) => step === rawFps) ?? DEFAULT_SCREEN_PROFILE.fps;
  return { quality, fps };
}

/** What one viewer of a screen share with this profile receives, in bit/s. Unknown ids count as 720p 30 FPS. */
export function screenProfileBitrate(profileId: string): number {
  const { quality, fps } = parseScreenProfile(profileId);
  const bitrate = SCREEN_BITRATE_BY_QUALITY[quality][fps];
  return quality === 'source' ? Math.max(bitrate, SOURCE_BUDGET_FLOOR) : bitrate;
}

/**
 * The profiles a busy server may offer instead, best first: the one asked for,
 * then 720p at the same frame rate, then 720p at each lower frame rate.
 */
export function screenProfileFallbacks(profileId: string): string[] {
  const { quality, fps } = parseScreenProfile(profileId);
  const ladder = [`${quality}-${fps}`];
  for (const step of SCREEN_FPS_STEPS.slice(SCREEN_FPS_STEPS.indexOf(fps))) {
    const fallback = `balanced-${step}`;
    if (!ladder.includes(fallback)) ladder.push(fallback);
  }
  return ladder;
}
