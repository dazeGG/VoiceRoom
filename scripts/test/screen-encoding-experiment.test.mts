import assert from 'node:assert/strict';
import test from 'node:test';
import { VideoPreset, type TrackPublishOptions } from 'livekit-client';
import {
  evaluateSustained,
  screenEncodingOptions,
  screenEncodingVariant
} from '../voice-bench/screen-encoding-experiment.mts';

test('encoding experiments are explicit and invalid settings fail rather than selecting an experiment', () => {
  assert.equal(screenEncodingVariant(undefined), 'default');
  for (const variant of ['default', 'single-layer', 'motion-framerate'])
    assert.equal(screenEncodingVariant(variant), variant);
  for (const invalid of ['', 'single', 'false', 'hardware', 'motion-framerate '])
    assert.throws(() => screenEncodingVariant(invalid));
});

test('default preserves app options and each experiment changes only its assigned variable', () => {
  const options: TrackPublishOptions = Object.freeze({
    videoCodec: 'h264',
    simulcast: true,
    degradationPreference: 'maintain-resolution',
    screenShareEncoding: Object.freeze({ maxBitrate: 5_000_000, maxFramerate: 30 }),
    screenShareSimulcastLayers: [new VideoPreset(960, 540, 1_500_000, 30)],
    backupCodec: false
  });
  const before = { ...options };
  const beforeJson = JSON.stringify(options);
  assert.deepEqual(screenEncodingOptions(options, 'default'), before);
  assert.deepEqual(screenEncodingOptions(options, 'single-layer'), {
    ...before,
    simulcast: false,
    screenShareSimulcastLayers: []
  });
  assert.deepEqual(screenEncodingOptions(options, 'motion-framerate'), {
    ...before,
    degradationPreference: 'maintain-framerate'
  });
  assert.deepEqual(options, before);
  assert.equal(JSON.stringify(options), beforeJson);
  assert.deepEqual(screenEncodingOptions(options, 'default'), before);
});

const samples = () =>
  Array.from({ length: 40 }, (_, index) => ({
    elapsedMs: (index + 1) * 1000,
    streamId: 'screen',
    fps: 30,
    width: 1280,
    height: 720
  }));

test('sustained result cannot pass on a short startup sequence or hide a later collapse', () => {
  assert.equal(evaluateSustained(samples()).status, 'pass');
  assert.equal(evaluateSustained(samples().slice(0, 15)).status, 'inconclusive');
  const collapse = samples();
  assert.ok(collapse[27]);
  collapse[27].fps = 7;
  assert.equal(evaluateSustained(collapse).status, 'degraded');
  const lowResolution = samples();
  assert.ok(lowResolution[27]);
  lowResolution[27].height = 540;
  assert.equal(evaluateSustained(lowResolution).status, 'degraded');
  assert.equal(evaluateSustained([]).status, 'inconclusive');
});

test('missing stats, changed streams and broken cadence make sustained evidence inconclusive', () => {
  const original = samples();
  const changed = original[27];
  assert.ok(changed);
  for (const replacement of [
    { ...changed, fps: null },
    { ...changed, fps: Number.NaN },
    { ...changed, streamId: 'replacement' },
    { ...changed, elapsedMs: 50_000 }
  ]) {
    assert.equal(
      evaluateSustained(original.map((sample, index) => (index === 27 ? replacement : sample))).status,
      'inconclusive'
    );
  }
  assert.equal(evaluateSustained(original.filter((_, index) => index !== 27)).status, 'inconclusive');
  assert.equal(evaluateSustained(original.filter((_, index) => index < 3 || index >= 8)).status, 'inconclusive');
});
