import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { listReactionEmojis } from '@voice-room/shared/emoji';
import { assetName, planEmojiAssets } from '../scripts/build-emoji-assets.mjs';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(webRoot, relative), 'utf8');

const RU_FLAG = '\u{1F1F7}\u{1F1FA}';
const WAVE_DARK = '\u{1F44B}\u{1F3FF}';
const FAMILY = '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F466}';
const KEYCAP_ONE = '1\u{FE0F}\u{20E3}';
const REGIONAL_INDICATOR_PAIR = /[\u{1F1E6}-\u{1F1FF}]{2}/u;

test('an asset name spells out every code point of the sequence', () => {
  assert.equal(assetName(RU_FLAG), '1F1F7-1F1FA');
  assert.equal(assetName(WAVE_DARK), '1F44B-1F3FF');
  assert.equal(assetName(FAMILY), '1F468-200D-1F469-200D-1F466');
  // The presentation selector is part of the name, so the runtime never guesses
  // which spelling a file was stored under.
  assert.equal(assetName(KEYCAP_ONE), '0031-FE0F-20E3');
});

test('the runtime and the generator agree on how a file is named', () => {
  const runtime = read('src/lib/shared/chat/emoji-asset.ts');

  assert.match(runtime, /toString\(16\)\.toUpperCase\(\)\.padStart\(4, '0'\)/);
  assert.match(runtime, /join\('-'\)/);
  assert.match(runtime, /`\/emoji\/\$\{emojiAssetName\(emoji\)\}\.svg`/);
});

test('the offered catalogue is exactly what the artwork can draw', async () => {
  // Twemoji does not reach the newest corpus additions. Rather than let those
  // fall back to the platform font — which on Windows draws flags as letters —
  // the offered set is locked to the artwork, so what is offered is always
  // drawable and what cannot be drawn is never offered.
  const { copies, missing } = await planEmojiAssets();
  const corpus = listReactionEmojis();
  const catalogue = JSON.parse(read('src/lib/shared/chat/emoji-coverage.json'));
  const offered = new Set(catalogue.emojis);

  assert.deepEqual(catalogue.emojis, copies.map((copy) => copy.emoji));
  assert.equal(offered.size, copies.length);
  assert.equal(copies.length + missing.length, corpus.length);
  assert.ok(copies.some((copy) => copy.name === assetName(RU_FLAG)));
  for (const emoji of missing) assert.equal(offered.has(emoji), false);

  // Flags were the whole reason for shipping artwork, so a set that lost them
  // would defeat the point while passing everything else.
  const flags = corpus.filter((emoji) => REGIONAL_INDICATOR_PAIR.test(emoji));
  const uncovered = flags.filter((emoji) => !offered.has(emoji));
  assert.ok(flags.length > 250);
  assert.ok(uncovered.length <= 1, `too many flags missing: ${uncovered.join(' ')}`);
});

test('reaction surfaces draw the artwork instead of leaving it to the platform font', () => {
  const emoji = read('src/lib/shared/chat/Emoji.svelte');
  const picker = read('src/lib/shared/chat/ReactionPicker.svelte');
  const summary = read('src/lib/shared/chat/ReactionSummary.svelte');
  const menu = read('src/lib/shared/chat/MessageContextMenu.svelte');

  // The character stays the alt text, so copying a reaction still yields an
  // emoji, and the font remains the fallback when a file fails to load.
  assert.match(emoji, /alt=\{decorative \? '' : emoji\}/);
  assert.match(emoji, /onerror=\{\(\) => \(failed = true\)\}/);
  assert.match(emoji, /\{#if failed\}/);
  assert.match(emoji, /loading="lazy"/);

  for (const source of [picker, summary, menu]) {
    assert.match(source, /import Emoji from '\.\/Emoji\.svelte'/);
    assert.match(source, /<Emoji/);
  }
});

test('the artwork ships the upstream licence, not the repackager\'s', () => {
  const script = read('scripts/build-emoji-assets.mjs');
  const licence = read('scripts/emoji-artwork-LICENSE.txt');

  // The npm package carrying the files is a community repackaging that ships
  // only an MIT notice covering the packaging. That does not relicense
  // Twemoji's artwork, which is CC BY 4.0, so the upstream text travels with
  // the files from this repo and the credit names Twemoji, not the repackager.
  assert.match(licence, /Attribution 4\.0 International/);
  assert.match(script, /graphicsLicenceFile/);
  assert.match(script, /LICENSE\.txt/);
  assert.match(script, /ATTRIBUTION\.txt/);
  assert.match(script, /CC BY 4\.0/);
  assert.match(script, /jdecked\/twemoji/);
});
