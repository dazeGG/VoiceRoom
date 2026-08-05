'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const packageJson = require('../package.json');
const commonJs = require('../src/platform-class.js');

test('platform-class exposes equivalent CommonJS and ESM contracts', async () => {
  const esmPath = path.join(__dirname, '../src/platform-class.mjs');
  const esm = await import(pathToFileURL(esmPath).href);
  const samples = [
    {},
    { desktopBridge: true },
    { userAgentDataMobile: true },
    { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    { platform: 'MacIntel', maxTouchPoints: 5 }
  ];

  assert.equal(packageJson.exports['./platform-class'].import, './src/platform-class.mjs');
  assert.equal(packageJson.exports['./platform-class'].require, './src/platform-class.js');
  assert.equal(typeof esm.classifyPlatformPolicy, 'function');

  for (const sample of samples) {
    assert.deepEqual(esm.classifyPlatformPolicy(sample), commonJs.classifyPlatformPolicy(sample));
  }
});

test('browser-facing shared modules expose named ESM exports', async () => {
  const expectedExports = {
    capabilities: ['PUBLIC_CAPABILITY_KEYS'],
    emoji: ['cleanReactionEmoji', 'listReactionEmojis'],
    membership: ['normalizeMembershipEnvelope'],
    mentions: ['MAX_MENTION_CANDIDATES', 'MAX_MENTIONS_PER_MESSAGE'],
    moderation: ['MODERATION_DEFAULT_LIMIT', 'MODERATION_MAX_LIMIT', 'normalizeActiveBan', 'normalizeBanMutation'],
    notifications: ['normalizeNotificationEnvelope'],
    'platform-class': ['classifyPlatformPolicy'],
    reactions: ['normalizeReactionSummary', 'normalizeReactorPage'],
    'room-message-content': ['contentFromLegacyText', 'projectRoomMessageContent'],
    'runtime-config': ['DEFAULT_RUNTIME_CONFIG', 'parseRuntimeConfig', 'resolveLiveKitConnectUrls']
  };

  for (const [subpath, names] of Object.entries(expectedExports)) {
    assert.match(packageJson.exports[`./${subpath}`].import, /\.mjs$/);
    const esm = await import(`@voice-room/shared/${subpath}`);
    for (const name of names) assert.ok(name in esm, `${subpath} must export ${name}`);
  }
});

test('browser ESM modules never import CommonJS source files', () => {
  const sourceDirectory = path.join(__dirname, '../src');
  const violations = fs.readdirSync(sourceDirectory)
    .filter((name) => name.endsWith('.mjs'))
    .flatMap((name) => {
      const source = fs.readFileSync(path.join(sourceDirectory, name), 'utf8');
      return source.match(/(?:from\s+|import\s*\()['"]\.\/[^'"]+\.js['"]/g)?.map((match) => `${name}: ${match}`) ?? [];
    });

  assert.deepEqual(violations, []);
});
