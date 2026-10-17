import test from 'node:test';
import assert from 'node:assert/strict';
import { screenProfileBitrate, screenProfileFallbacks } from '../src/media-budget.ts';

test('a screen profile costs its top-layer bitrate, and an unknown one counts as 720p 30 FPS', () => {
  assert.equal(screenProfileBitrate('high-60'), 10_000_000);
  assert.equal(screenProfileBitrate('balanced-30'), 5_000_000);
  assert.equal(screenProfileBitrate('source-5'), 3_200_000, 'a source capture counts at least as a 1440p screen');
  assert.equal(screenProfileBitrate('source-60'), 10_000_000);
  assert.equal(screenProfileBitrate('high'), 7_000_000, 'an id without a frame rate means 30 FPS');
  assert.equal(screenProfileBitrate('low-15'), 3_000_000, "'low' is the old name of 720p");
  assert.equal(screenProfileBitrate(''), 5_000_000);
  assert.equal(screenProfileBitrate('ultra-120'), 5_000_000);
});

test('a busy server offers 720p at the same frame rate first, then lower frame rates', () => {
  assert.deepEqual(screenProfileFallbacks('high-60'), [
    'high-60',
    'balanced-60',
    'balanced-30',
    'balanced-15',
    'balanced-5'
  ]);
  assert.deepEqual(screenProfileFallbacks('balanced-30'), ['balanced-30', 'balanced-15', 'balanced-5']);
  assert.deepEqual(screenProfileFallbacks('source-5'), ['source-5', 'balanced-5']);
  assert.deepEqual(screenProfileFallbacks('high'), ['high-30', 'balanced-30', 'balanced-15', 'balanced-5']);
});

test('every fallback costs no more than the profile before it', () => {
  for (const profileId of ['high-60', 'source-30', 'balanced-60', 'high-5']) {
    const costs = screenProfileFallbacks(profileId).map(screenProfileBitrate);
    assert.deepEqual(
      costs,
      [...costs].sort((a, b) => b - a),
      profileId
    );
  }
});
