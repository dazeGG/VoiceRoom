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

test('browser ESM and CommonJS contracts stay behaviorally aligned', async () => {
  const moduleNames = [
    'capabilities',
    'emoji',
    'membership',
    'mentions',
    'moderation',
    'notifications',
    'platform-class',
    'reactions',
    'room-message-content',
    'runtime-config'
  ];
  const argumentCorpus = [
    [],
    [undefined],
    [null],
    [''],
    ['x'],
    [0],
    [1],
    [true],
    [[]],
    [['x', 'y']],
    [{}],
    [{ id: 'x', userId: 'u1', roomId: 'r1', text: 'hello', limit: 10 }],
    ['1h', 1_700_000_000_000],
    [{}, {}]
  ];

  function snapshot(value) {
    if (value === undefined) return { type: 'undefined' };
    if (typeof value === 'number' && !Number.isFinite(value)) return { type: 'number', value: String(value) };
    if (value instanceof Set) return { type: 'set', value: [...value].map(snapshot) };
    if (value instanceof Map) return { type: 'map', value: [...value].map(([key, entry]) => [snapshot(key), snapshot(entry)]) };
    if (Array.isArray(value)) return value.map(snapshot);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, snapshot(entry)]));
    }
    return value;
  }

  function invoke(fn, args) {
    try {
      return { returned: snapshot(fn(...structuredClone(args))) };
    } catch (error) {
      return { threw: { name: error?.name, message: error?.message } };
    }
  }

  for (const moduleName of moduleNames) {
    const cjs = require(`../src/${moduleName}.js`);
    const esm = await import(pathToFileURL(path.join(__dirname, `../src/${moduleName}.mjs`)).href);
    assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort(), `${moduleName} export names drifted`);

    for (const exportName of Object.keys(cjs)) {
      assert.equal(typeof esm[exportName], typeof cjs[exportName], `${moduleName}.${exportName} type drifted`);
      if (typeof cjs[exportName] !== 'function') {
        assert.deepEqual(snapshot(esm[exportName]), snapshot(cjs[exportName]), `${moduleName}.${exportName} value drifted`);
        continue;
      }
      assert.equal(esm[exportName].length, cjs[exportName].length, `${moduleName}.${exportName} arity drifted`);
      for (const args of argumentCorpus) {
        assert.deepEqual(
          invoke(esm[exportName], args),
          invoke(cjs[exportName], args),
          `${moduleName}.${exportName} behavior drifted for ${JSON.stringify(args)}`
        );
      }
    }
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
