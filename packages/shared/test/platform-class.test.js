import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import packageJson from '../package.json' with { type: 'json' };
import * as direct from '../src/platform-class.ts';

test('platform-class classifies the same through its package export and its source', async () => {
  const esm = await import('@voice-room/shared/platform-class');
  const samples = [
    {},
    { desktopBridge: true },
    { userAgentDataMobile: true },
    { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    { platform: 'MacIntel', maxTouchPoints: 5 }
  ];

  assert.equal(packageJson.exports['./platform-class'], './src/platform-class.ts');
  assert.equal(typeof esm.classifyPlatformPolicy, 'function');

  for (const sample of samples) {
    assert.deepEqual(esm.classifyPlatformPolicy(sample), direct.classifyPlatformPolicy(sample));
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
    const target = packageJson.exports[`./${subpath}`];
    assert.match(target, /^\.\/src\/[a-z-]+\.ts$/);
    const esm = await import(`@voice-room/shared/${subpath}`);
    for (const name of names) assert.ok(name in esm, `${subpath} must export ${name}`);
  }
});

test('every export is one TypeScript source, with no JavaScript copy beside it', () => {
  const sourceDirectory = path.join(import.meta.dirname, '../src');
  const files = fs.readdirSync(sourceDirectory, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name);
  const exported = Object.values(packageJson.exports).map((target) => path.basename(target)).sort();

  assert.deepEqual(files.filter((name) => name.endsWith('.ts')).sort(), exported);
  assert.deepEqual(files.filter((name) => !name.endsWith('.ts')), ['visual-identity.json']);

  const untypedImports = files
    .filter((name) => name.endsWith('.ts'))
    .flatMap((name) => {
      const source = fs.readFileSync(path.join(sourceDirectory, name), 'utf8');
      return source.match(/(?:from\s+|import\s*\()['"]\.\/[^'"]+['"]/g)
        ?.filter((match) => !/\.(ts|json)['"]$/.test(match))
        .map((match) => `${name}: ${match}`) ?? [];
    });
  assert.deepEqual(untypedImports, []);
});
