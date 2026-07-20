'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  EMOJI_REACTION_AUTHORITY,
  assertReactionEmoji,
  cleanReactionEmoji,
  isReactionEmoji,
  listReactionEmojis
} = require('@voice-room/shared/emoji');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const TYPES = fs.readFileSync(path.join(ROOT, 'src/emoji.d.ts'), 'utf8');
const EXPECTED_CORPUS_SHA256 = '4a53e0c0dc317e6830f4055191e9fe287ab2db8978b2f78bdbaa43a60483d791';
const EXPECTED_UNICODE_SHA256 = '1d8a944f88d7952f7ef7c5167fef3c67995bcae24543949710231b03a201acda';

function assertAccepted(value) {
  assert.equal(isReactionEmoji(value), true, `${value} should be accepted`);
  assert.equal(cleanReactionEmoji(value), value);
  assert.equal(assertReactionEmoji(value), value);
}

function assertRejected(value) {
  assert.equal(isReactionEmoji(value), false, `${String(value)} should be rejected`);
  assert.equal(cleanReactionEmoji(value), '');
  assert.throws(() => assertReactionEmoji(value), /Unsupported reaction emoji/);
}

test('authority metadata pins the exact Unicode Emoji 17.0 file and frozen corpus', () => {
  const corpus = listReactionEmojis();
  const corpusSha256 = crypto.createHash('sha256').update(corpus.join('\n')).digest('hex');

  assert.equal(EMOJI_REACTION_AUTHORITY.url, 'https://www.unicode.org/Public/17.0.0/emoji/emoji-test.txt');
  assert.equal(EMOJI_REACTION_AUTHORITY.unicodeVersion, '17.0');
  assert.equal(EMOJI_REACTION_AUTHORITY.fileDate, '2025-08-04, 20:55:31 GMT');
  assert.equal(EMOJI_REACTION_AUTHORITY.byteSize, 669326);
  assert.equal(EMOJI_REACTION_AUTHORITY.unicodeFileSha256, EXPECTED_UNICODE_SHA256);
  assert.equal(EMOJI_REACTION_AUTHORITY.acceptedCount, 3944);
  assert.deepEqual(EMOJI_REACTION_AUTHORITY.counts, {
    'fully-qualified': 3944,
    'minimally-qualified': 1029,
    unqualified: 243,
    component: 9,
    total: 5225
  });
  assert.equal(corpus.length, 3944);
  assert.equal(new Set(corpus).size, 3944);
  assert.equal(corpusSha256, EXPECTED_CORPUS_SHA256);
  assert.equal(EMOJI_REACTION_AUTHORITY.corpusSha256, EXPECTED_CORPUS_SHA256);
  assert.match(EMOJI_REACTION_AUTHORITY.attribution, /Unicode/);
});

test('accepts representative fully-qualified RGI reaction emoji exactly as authored', () => {
  assertAccepted('😀');
  assertAccepted('👍');
  assertAccepted('👍🏽');
  assertAccepted('🇺🇸');
  assertAccepted('1️⃣');
  assertAccepted('❤️');
  assertAccepted('👨‍👩‍👧‍👦');
});

test('rejects non-fully-qualified or ambiguous Unicode forms', () => {
  assertRejected('☺');
  assertRejected('❤');
  assertRejected('☹︎');
  assertRejected('1');
  assertRejected('1⃣');
});

test('rejects standalone components, malformed input, unknown sequences, and concatenation', () => {
  assertRejected('🏽');
  assertRejected('🏻');
  assertRejected('🦰');
  assertRejected('😀😀');
  assertRejected('👨‍👩');
  assertRejected('not emoji');
  assertRejected('');
  assertRejected(null);
  assertRejected('\uD83D');
});

test('listReactionEmojis returns a defensive copy', () => {
  const first = listReactionEmojis();
  const snapshot = listReactionEmojis();

  first.length = 0;

  assert.equal(first.length, 0);
  assert.equal(snapshot.length, 3944);
  assert.equal(listReactionEmojis().length, 3944);
});

test('CommonJS, ESM, package exports, and d.ts surfaces agree', async () => {
  const esm = await import('@voice-room/shared/emoji');
  const directEsm = await import(pathToFileURL(path.join(ROOT, 'src/emoji.mjs')).href);

  for (const module of [esm, directEsm]) {
    assert.deepEqual(module.EMOJI_REACTION_AUTHORITY, EMOJI_REACTION_AUTHORITY);
    assert.equal(module.isReactionEmoji('👍🏽'), true);
    assert.equal(module.cleanReactionEmoji('👍🏽'), '👍🏽');
    assert.equal(module.cleanReactionEmoji('👍🏽👍🏽'), '');
    assert.equal(module.assertReactionEmoji('❤️'), '❤️');
    assert.deepEqual(module.listReactionEmojis(), listReactionEmojis());
  }

  assert.deepEqual(PACKAGE_JSON.exports['./emoji'], {
    types: './src/emoji.d.ts',
    import: './src/emoji.mjs',
    require: './src/emoji.js'
  });
  assert.match(TYPES, /export const EMOJI_REACTION_AUTHORITY: EmojiReactionAuthority;/);
  assert.match(TYPES, /export function isReactionEmoji\(value: unknown\): value is string;/);
  assert.match(TYPES, /export function cleanReactionEmoji\(value: unknown\): string;/);
  assert.match(TYPES, /export function assertReactionEmoji\(value: unknown\): string;/);
  assert.match(TYPES, /export function listReactionEmojis\(\): string\[\];/);
});

