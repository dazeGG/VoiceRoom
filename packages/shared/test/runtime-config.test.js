'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  inheritLiveKitGateCredential,
  resolveLiveKitConnectUrls
} = require('../src/runtime-config');

test('copies the one-time LiveKit gate credential to a configured endpoint', () => {
  const result = inheritLiveKitGateCredential(
    'wss://livekit.dev.voiceroom.ru/rtc',
    'wss://livekit.dev.voiceroom.ru/rtc?vr_gate_credential=signed-value'
  );

  assert.equal(
    result,
    'wss://livekit.dev.voiceroom.ru/rtc?vr_gate_credential=signed-value'
  );
});

test('preserves configured query parameters while replacing a stale credential', () => {
  const result = inheritLiveKitGateCredential(
    'wss://fallback.example/rtc?region=eu&vr_gate_credential=stale',
    'wss://livekit.example/rtc?vr_gate_credential=fresh'
  );

  assert.equal(
    result,
    'wss://fallback.example/rtc?region=eu&vr_gate_credential=fresh'
  );
});

test('leaves configured endpoints unchanged when the API issued no gate credential', () => {
  assert.equal(
    inheritLiveKitGateCredential('wss://livekit.example/rtc', 'wss://livekit.example/rtc'),
    'wss://livekit.example/rtc'
  );
});

test('never places an uncredentialed runtime endpoint before the API admission URL', () => {
  const urls = resolveLiveKitConnectUrls({
    livekit: {
      wsUrl: 'wss://livekit.dev.voiceroom.ru/rtc',
      connectFallbacks: ['wss://livekit-fallback.dev.voiceroom.ru/rtc']
    }
  }, 'wss://livekit.dev.voiceroom.ru/rtc?vr_gate_credential=signed-value');

  assert.deepEqual(urls, [
    'wss://livekit.dev.voiceroom.ru/rtc?vr_gate_credential=signed-value',
    'wss://livekit-fallback.dev.voiceroom.ru/rtc?vr_gate_credential=signed-value'
  ]);
  assert.equal(urls.some((url) => !new URL(url).searchParams.has('vr_gate_credential')), false);
});
