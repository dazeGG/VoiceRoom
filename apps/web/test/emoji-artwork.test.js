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

test('the pinned artwork covers every reaction the corpus accepts', async () => {
  // Coverage is the release gate from the 2.6 plan: the renderer has to cover
  // the whole accepted dataset. A gap would drop those reactions back onto the
  // platform font, which on Windows draws flags as letters.
  const { copies, missing } = await planEmojiAssets();
  const corpus = listReactionEmojis();

  assert.deepEqual(missing, []);
  assert.equal(copies.length, corpus.length);
  assert.equal(new Set(copies.map((copy) => copy.name)).size, corpus.length);
  assert.ok(copies.some((copy) => copy.name === assetName(RU_FLAG)));
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

test('the generated artwork carries its attribution', () => {
  const script = read('scripts/build-emoji-assets.mjs');

  // OpenMoji is CC BY-SA 4.0, so the licence and credit ship with the files.
  assert.match(script, /LICENSE\.txt/);
  assert.match(script, /ATTRIBUTION\.txt/);
  assert.match(script, /CC BY-SA 4\.0/);
  assert.match(script, /openmoji\.org/);
});
