import assert from 'node:assert/strict';
import test from 'node:test';

import { clientKind, describeUserAgent, isDesktopAppUserAgent } from '../src/account-security.ts';
import {
  ANDROID_APP_PRODUCT,
  isAndroidAppUserAgent,
  isClientOutdated,
  isVersionBelow,
  parseAndroidAppVersion
} from '../src/client-version.ts';

const ANDROID_APP = 'VoiceRoom-Android/1.0.0';
const DESKTOP_APP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) VoiceRoom/1.3.3 Chrome/138.0.0.0 Electron/37.2.0 Safari/537.36';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 12; M2007J20CG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36';
const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';
const OKHTTP = 'okhttp/4.12.0';

const USER_AGENTS = Object.freeze([
  ANDROID_APP,
  'VoiceRoom-Android/2.10.5 (Linux; Android 12)',
  'voiceroom-android/1.2.3',
  'VoiceRoom-Android/1.2',
  'VoiceRoom-Android/1.2.3-beta',
  'VoiceRoom-Android/',
  DESKTOP_APP,
  CHROME_ANDROID,
  CHROME_WINDOWS,
  OKHTTP,
  ''
]);

test('the Android app is its own client kind, not the desktop app', () => {
  assert.equal(clientKind(ANDROID_APP), 'mobile_app');
  assert.deepEqual(describeUserAgent(ANDROID_APP), { client: 'VoiceRoom Android', os: 'Android' });
  assert.equal(isDesktopAppUserAgent(ANDROID_APP), false);

  assert.equal(clientKind(DESKTOP_APP), 'desktop_app');
  assert.equal(isDesktopAppUserAgent(DESKTOP_APP), true);
  assert.equal(clientKind(CHROME_ANDROID), 'mobile');
  assert.equal(clientKind(CHROME_WINDOWS), 'browser');
});

test('both modules agree on which user agents are the Android app', () => {
  for (const userAgent of USER_AGENTS) {
    assert.equal(isAndroidAppUserAgent(userAgent), clientKind(userAgent) === 'mobile_app', userAgent);
  }
  assert.equal(isAndroidAppUserAgent(`${ANDROID_APP_PRODUCT}/1.0.0`), true);
});

test('parseAndroidAppVersion reads x.y.z and nothing looser', () => {
  assert.equal(parseAndroidAppVersion('VoiceRoom-Android/1.2.3'), '1.2.3');
  assert.equal(parseAndroidAppVersion('VoiceRoom-Android/1.2.3 (Linux; Android 12)'), '1.2.3');
  assert.equal(parseAndroidAppVersion('VoiceRoom-Android/1.2'), '');
  assert.equal(parseAndroidAppVersion('VoiceRoom-Android/1.2.3-beta'), '');
  assert.equal(parseAndroidAppVersion('VoiceRoom-Android/'), '');
  assert.equal(parseAndroidAppVersion(CHROME_ANDROID), null);
  assert.equal(parseAndroidAppVersion(DESKTOP_APP), null);
  assert.equal(parseAndroidAppVersion(''), null);
  assert.equal(parseAndroidAppVersion(null), null);
  assert.equal(parseAndroidAppVersion(undefined), null);
});

test('isClientOutdated refuses only an Android app below the minimum or without a version', () => {
  assert.equal(isClientOutdated('VoiceRoom-Android/1.1.9', '1.2.0'), true);
  assert.equal(isClientOutdated('VoiceRoom-Android/1.2', '1.2.0'), true);
  assert.equal(isClientOutdated('VoiceRoom-Android/1.2.3-beta', '1.2.0'), true);
  assert.equal(isClientOutdated('VoiceRoom-Android/1.2.0', '1.2.0'), false);
  assert.equal(isClientOutdated('VoiceRoom-Android/1.10.0', '1.9.0'), false);

  assert.equal(isClientOutdated('VoiceRoom-Android/0.0.1', ''), false);
  assert.equal(isClientOutdated('VoiceRoom-Android/1.2', ''), false);
  assert.equal(isClientOutdated(CHROME_ANDROID, '1.2.0'), false);
  assert.equal(isClientOutdated(DESKTOP_APP, '1.2.0'), false);
  assert.equal(isClientOutdated(undefined, '1.2.0'), false);
});

test('isVersionBelow counts an unknown version as below a set minimum', () => {
  assert.equal(isVersionBelow('1.1.9', '1.2.0'), true);
  assert.equal(isVersionBelow('1.2.0', '1.2.0'), false);
  assert.equal(isVersionBelow('2.0.0', '1.2.0'), false);
  assert.equal(isVersionBelow(null, '1.2.0'), true);
  assert.equal(isVersionBelow('', '1.2.0'), true);
  assert.equal(isVersionBelow(null, ''), false);
  assert.equal(isVersionBelow('1.0.0', '1.2'), false);
});
