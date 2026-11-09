import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateStartup,
  loopbackLiveKitUrl,
  loopbackRtcConfig,
  rgbPixelError,
  screenBenchBrowserOptions,
  type StartupSample
} from '../voice-bench/screen-startup-metrics.mts';

const good = (elapsedMs: number, streamId = 'track-1'): StartupSample => ({
  elapsedMs,
  streamId,
  fps: 30,
  width: 1280,
  height: 720
});

test('loopback browser configuration does not use external ICE servers', () => {
  assert.deepEqual(loopbackRtcConfig.iceServers, []);
});

test('isolated loopback flags are explicit, validated and do not alter defaults', () => {
  const standard = { headless: true, args: ['--autoplay-policy=no-user-gesture-required'] };
  assert.deepEqual(screenBenchBrowserOptions(undefined), standard);
  assert.deepEqual(screenBenchBrowserOptions('0'), standard);
  assert.deepEqual(screenBenchBrowserOptions('1'), {
    headless: true,
    args: [...standard.args, '--allow-loopback-in-peer-connection', '--disable-features=WebRtcHideLocalIpsWithMdns']
  });
  for (const invalid of ['', 'true', '2', ' 1']) assert.throws(() => screenBenchBrowserOptions(invalid));
});

test('the benchmark only accepts credential-free loopback WebSocket endpoints', () => {
  for (const url of ['ws://127.0.0.1:17880', 'ws://localhost:7880', 'wss://[::1]:7880']) {
    assert.equal(loopbackLiveKitUrl(url).href, new URL(url).href);
  }
  for (const url of [
    'https://127.0.0.1:17880',
    'ws://voiceroom.ru',
    'ws://localhost.evil:7880',
    'ws://127.0.0.1.evil:7880',
    'ws://user:secret@localhost:7880',
    'ws://127.0.0.1:7880?token=secret',
    'ws://127.0.0.1:7880/#fragment'
  ])
    assert.throws(() => loopbackLiveKitUrl(url));
});

test('startup requires three consecutive full-resolution smooth samples and reports their first time', () => {
  assert.deepEqual(evaluateStartup([good(1000), good(2000), good(3000)]), {
    status: 'pass',
    stableAtMs: 1000,
    confirmedAtMs: 3000
  });
  assert.equal(evaluateStartup([good(1000), good(2000)]).status, 'inconclusive');
  assert.equal(evaluateStartup([]).status, 'inconclusive');
  assert.equal(evaluateStartup([good(6000), good(7000), good(8000)]).status, 'slow');
});

test('low FPS, small dimensions and missing observations break the stable sequence', () => {
  for (const bad of [
    { ...good(2000), fps: 5 },
    { ...good(2000), width: 960, height: 540 },
    { ...good(2000), fps: null },
    { ...good(2000), width: null },
    { ...good(2000), fps: Number.NaN }
  ]) {
    assert.equal(evaluateStartup([good(1000), bad, good(3000), good(4000)]).status, 'inconclusive');
  }
});

test('a replacement RTP stream or a missing sampling interval cannot complete an old sequence', () => {
  assert.equal(evaluateStartup([good(1000), good(2000), good(3000, 'replacement')]).status, 'inconclusive');
  assert.equal(evaluateStartup([good(1000), good(4000), good(5000)]).status, 'inconclusive');
  assert.equal(evaluateStartup([good(2000), good(1000), good(3000)]).status, 'inconclusive');
});

test('visual error uses RGB only, preserves exact matches and rejects mismatched captures', () => {
  assert.deepEqual(rgbPixelError([10, 20, 30, 255], [10, 20, 30, 0]), { mae: 0, psnr: null });
  const changed = rgbPixelError([0, 0, 0, 255], [10, 10, 10, 255]);
  assert.equal(changed.mae, 10);
  assert.ok(changed.psnr !== null && Math.abs(changed.psnr - 28.1308) < 0.001);
  assert.throws(() => rgbPixelError([], []));
  assert.throws(() => rgbPixelError([0, 0, 0, 255], [0, 0, 0]));
  assert.throws(() => rgbPixelError([Number.NaN, 0, 0, 255], [0, 0, 0, 255]));
});
