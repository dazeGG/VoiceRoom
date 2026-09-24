// Screen share profiles: what each mode sends and how it is published.

import { afterEach, expect, test, vi } from 'vitest';
import {
  createScreenProfileId,
  createSourceScreenProfile,
  getPreferredScreenVideoCodec,
  getScreenDegradationPreference,
  getScreenModeForProfile,
  getScreenModeSummary,
  getScreenProfile,
  getScreenProfileForMode,
  getScreenProfileLabels,
  getScreenPublishVideoOptions
} from '../../src/lib/features/room/client/media/profiles.ts';

afterEach(() => vi.unstubAllGlobals());

function stubCodecs(...mimeTypes: string[]) {
  vi.stubGlobal('RTCRtpSender', { getCapabilities: () => ({ codecs: mimeTypes.map((mimeType) => ({ mimeType })) }) });
}

test('the default mode is smooth video at 30 FPS; text mode sends the source resolution at 5 FPS', () => {
  const games = getScreenProfileForMode('games');
  expect(games).toMatchObject({ id: 'balanced-30', frameRate: 30, contentHint: 'motion', videoBitrate: 5_000_000 });
  const text = getScreenProfileForMode('text');
  expect(text).toMatchObject({ id: 'source-5', frameRate: 5, contentHint: 'detail', videoBitrate: 1_800_000 });
  expect(getScreenModeSummary('games')).toMatch(/^Более плавное видео/);
  expect(getScreenModeSummary('text')).toMatch(/^Более чёткий текст/);
});

test('quality and FPS pick the bitrate; 60 FPS is available for motion', () => {
  expect(getScreenProfile('balanced-15').videoBitrate).toBe(3_000_000);
  expect(getScreenProfile('high-15').videoBitrate).toBe(4_000_000);
  expect(getScreenProfile('high-30').videoBitrate).toBe(7_000_000);
  expect(getScreenProfile('high-60')).toMatchObject({ frameRate: 60, contentHint: 'motion', fpsId: '60' });
});

test('unknown or retired profile ids fall back to supported ones', () => {
  expect(createScreenProfileId('low', '30')).toBe('balanced-30');
  expect(getScreenProfile('nonsense').id).toBe(getScreenProfile('balanced-30').id);
  expect(getScreenModeForProfile('source-5')).toBe('text');
  expect(getScreenModeForProfile('high-60')).toBe('games');
  const labels = getScreenProfileLabels('high-60');
  expect(labels.qualityLabel).not.toBe('');
  expect(labels.fpsLabel).toContain('60');
});

test('text prefers VP9 and motion H.264, with VP8 when neither is available', () => {
  stubCodecs('video/VP9', 'video/H264');
  expect(getPreferredScreenVideoCodec('detail')).toBe('vp9');
  expect(getPreferredScreenVideoCodec('motion')).toBe('h264');
  stubCodecs('video/VP8');
  expect(getPreferredScreenVideoCodec('motion')).toBe('vp8');
});

test('under congestion motion keeps its frame rate and text keeps its resolution', () => {
  expect(getScreenDegradationPreference('motion')).toBe('maintain-framerate');
  expect(getScreenDegradationPreference('detail')).toBe('maintain-resolution');
});

test('publishing caps bitrate and frame rate, adds a VP8 backup and one 540p simulcast layer', async () => {
  stubCodecs('video/H264');
  const profile = getScreenProfile('high-30');
  const options = await getScreenPublishVideoOptions(profile);
  expect(options).toMatchObject({
    videoCodec: 'h264',
    degradationPreference: 'maintain-framerate',
    screenShareEncoding: { maxBitrate: 7_000_000, maxFramerate: 30 },
    backupCodec: { codec: 'vp8' },
    simulcast: true
  });
  expect(options.screenShareSimulcastLayers?.map((layer) => [layer.width, layer.height, layer.encoding.maxBitrate])).toEqual([[960, 540, 1_500_000]]);
});

test('a source-quality profile scales its bitrate with the captured pixels, within a cap', () => {
  const base = getScreenProfile('source-5');
  const track = { getSettings: () => ({ width: 3840, height: 2160 }) } as MediaStreamTrack;
  const scaled = createSourceScreenProfile(base, track);
  expect(scaled).toMatchObject({ width: 3840, height: 2160, label: '3840×2160 5 FPS' });
  expect(scaled.videoBitrate).toBeGreaterThan(base.videoBitrate);

  expect(createSourceScreenProfile(getScreenProfile('high-30'), track)).toEqual(getScreenProfile('high-30'));
});
