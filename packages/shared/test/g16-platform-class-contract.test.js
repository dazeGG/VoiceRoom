'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const cjs = require('../src/platform-class.js');

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
  const esm = await import(pathToFileURL(path.join(__dirname, '../src/platform-class.mjs')).href);
  for (const fixture of CORPUS) {
    assert.equal(cjs.classifyPlatform(fixture.input), fixture.expected, fixture.name);
    assert.equal(esm.classifyPlatform(fixture.input), fixture.expected, `${fixture.name} (ESM)`);
    assert.deepEqual(esm.classifyPlatformPolicy(fixture.input), cjs.classifyPlatformPolicy(fixture.input));
  }
});

test('G16-A02 policy is fail-open only for unknown and never returns raw signals', () => {
  for (const fixture of CORPUS) {
    const policy = cjs.classifyPlatformPolicy(fixture.input);
    assert.deepEqual(Object.keys(policy).sort(), ['contractVersion', 'desktopAllowed', 'platformClass']);
    assert.equal(policy.contractVersion, 'voice-room.platform-class/v1');
    assert.equal(policy.desktopAllowed, fixture.expected !== 'mobile', fixture.name);
    assert.equal(JSON.stringify(policy).includes('userAgent'), false, fixture.name);
  }

  assert.deepEqual(cjs.platformPolicy('not-a-class'), {
    contractVersion: 'voice-room.platform-class/v1',
    platformClass: 'unknown',
    desktopAllowed: true
  });
});

test('G16-A02 declaration and runtime contracts expose the same normalized DTO', () => {
  const declaration = fs.readFileSync(path.join(__dirname, '../src/platform-class.d.ts'), 'utf8');
  assert.match(declaration, /type PlatformClass = 'desktop' \| 'mobile' \| 'unknown'/);
  assert.match(declaration, /contractVersion: 'voice-room\.platform-class\/v1'/);
  assert.match(declaration, /platformClass: PlatformClass/);
  assert.match(declaration, /desktopAllowed: boolean/);
  assert.doesNotMatch(
    declaration.match(/export interface PlatformPolicy \{[\s\S]*?\}/)?.[0] || '',
    /userAgent|\bplatform\??:|maxTouchPoints|desktopBridge/
  );
});
