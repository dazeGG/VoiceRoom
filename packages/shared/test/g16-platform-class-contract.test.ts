import assert from 'node:assert/strict';
import test from 'node:test';

import * as platform from '../src/platform-class.ts';

const CORPUS = Object.freeze([
  { name: 'iOS Safari', input: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' }, expected: 'mobile' },
  { name: 'Android Chrome', input: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36' }, expected: 'mobile' },
  { name: 'iPadOS desktop UA', input: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', platform: 'MacIntel', maxTouchPoints: 5 }, expected: 'mobile' },
  { name: 'narrow Windows desktop', input: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', viewportWidth: 320 }, expected: 'desktop' },
  { name: 'UA-CH desktop', input: { userAgentDataMobile: false, userAgent: 'malformed mobile token' }, expected: 'desktop' },
  { name: 'UA-CH mobile', input: { userAgentDataMobile: true, userAgent: 'Windows NT 10.0' }, expected: 'mobile' },
  { name: 'VoiceRoomDesktop bridge', input: { desktopBridge: true, userAgentDataMobile: true, userAgent: 'iPhone' }, expected: 'desktop' },
  { name: 'unknown', input: {}, expected: 'unknown' },
  { name: 'malformed', input: { userAgent: { raw: 'iPhone' }, platform: 42, maxTouchPoints: 'five' }, expected: 'unknown' }
]);

test('G16-A01 classifies the canonical platform corpus deterministically', async () => {
  for (const fixture of CORPUS) {
    // The corpus includes deliberately malformed signals.
    assert.equal(platform.classifyPlatform(fixture.input as platform.PlatformSignals), fixture.expected, fixture.name);
  }
});

test('G16-A02 policy is fail-open only for unknown and never returns raw signals', () => {
  for (const fixture of CORPUS) {
    const policy = platform.classifyPlatformPolicy(fixture.input as platform.PlatformSignals);
    assert.deepEqual(Object.keys(policy).sort(), ['contractVersion', 'desktopAllowed', 'platformClass', 'roomClientAllowed']);
    assert.equal(policy.contractVersion, 'voice-room.platform-class/v1');
    assert.equal(policy.desktopAllowed, fixture.expected !== 'mobile', fixture.name);
    assert.equal(policy.roomClientAllowed, true, `${fixture.name}: rooms open on every platform`);
    assert.equal(JSON.stringify(policy).includes('userAgent'), false, fixture.name);
  }

  assert.deepEqual(platform.platformPolicy('not-a-class'), {
    contractVersion: 'voice-room.platform-class/v1',
    platformClass: 'unknown',
    desktopAllowed: true,
    roomClientAllowed: true
  });
});

test('G16-A02 declaration and runtime contracts expose the same normalized DTO', () => {
  // The DTO is checked by the compiler: exactly these fields, no raw signals.
  const policy: platform.PlatformPolicy = platform.platformPolicy('mobile');
  const exact: Record<keyof platform.PlatformPolicy, true> = { contractVersion: true, platformClass: true, desktopAllowed: true, roomClientAllowed: true };
  assert.deepEqual(Object.keys(policy).sort(), Object.keys(exact).sort());
  const version: 'voice-room.platform-class/v1' = policy.contractVersion;
  const classes: platform.PlatformClass[] = ['desktop', 'mobile', 'unknown'];
  assert.equal(version, platform.PLATFORM_CLASS_CONTRACT);
  assert.deepEqual(Object.keys(platform.PLATFORM_CLASSES).sort(), [...classes].sort());
});
