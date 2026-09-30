import { onTestFinished, test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { listReactionEmojis } from '@voice-room/shared/emoji';
import { assetName, buildEmojiAssets, planEmojiAssets } from '../scripts/build-emoji-assets.ts';
import { emojiAssetName, emojiAssetUrl } from '../src/lib/shared/chat/emoji-asset.ts';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => readFileSync(join(webRoot, relative), 'utf8');
type Catalogue = { source: string; emojis: string[] };
const readJson = <T>(file: string) => JSON.parse(readFileSync(file, 'utf8')) as T;

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
  for (const emoji of [RU_FLAG, WAVE_DARK, FAMILY, KEYCAP_ONE, '😀']) {
    assert.equal(emojiAssetName(emoji), assetName(emoji));
    assert.equal(emojiAssetUrl(emoji), `/emoji/${assetName(emoji)}.svg`);
  }
});

test('the offered catalogue is exactly what the artwork can draw', async () => {
  // Twemoji does not reach the newest corpus additions. Rather than let those
  // fall back to the platform font — which on Windows draws flags as letters —
  // the offered set is locked to the artwork, so what is offered is always
  // drawable and what cannot be drawn is never offered.
  const { copies, missing } = await planEmojiAssets();
  const corpus = listReactionEmojis();
  const catalogue = readJson<Catalogue>(join(webRoot, 'src/lib/shared/chat/emoji-coverage.json'));
  const offered = new Set(catalogue.emojis);

  assert.deepEqual(
    catalogue.emojis,
    copies.map((copy) => copy.emoji)
  );
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

test("the artwork ships the upstream licence, not the repackager's", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'emoji-assets-'));
  onTestFinished(() => rmSync(outputDir, { recursive: true, force: true }));
  const catalogueFile = join(outputDir, 'emoji-coverage.json');

  const { copies, version } = await buildEmojiAssets({ outputDir, catalogueFile });

  // The npm package carrying the files ships only the MIT notice for Twemoji's
  // code. That does not cover the artwork, which is CC BY 4.0, so the upstream
  // text travels with the files from this repo and the credit names Twemoji
  // and Discord's fork the files come from.
  assert.equal(version, '16.0.1');
  assert.equal(
    readJson<{ devDependencies: Record<string, string> }>(join(webRoot, 'package.json')).devDependencies[
      '@discordapp/twemoji'
    ],
    version
  );
  assert.equal(readFileSync(join(outputDir, 'LICENSE.txt'), 'utf8'), read('scripts/emoji-artwork-LICENSE.txt'));
  assert.match(read('scripts/emoji-artwork-LICENSE.txt'), /Attribution 4\.0 International/);
  const attribution = readFileSync(join(outputDir, 'ATTRIBUTION.txt'), 'utf8');
  assert.match(attribution, /CC BY 4\.0/);
  assert.match(attribution, /github\.com\/jdecked\/twemoji/);
  assert.match(attribution, /github\.com\/discord\/twemoji/);
  assert.match(attribution, /@discordapp\/twemoji 16\.0\.1/);
  const [first] = copies;
  assert.ok(first);
  assert.ok(existsSync(join(outputDir, `${first.name}.svg`)));

  const catalogue = readJson<Catalogue>(catalogueFile);
  assert.equal(catalogue.source, '@discordapp/twemoji@16.0.1');
  // The committed catalogue is what a build writes.
  assert.equal(readFileSync(catalogueFile, 'utf8'), read('src/lib/shared/chat/emoji-coverage.json'));
});
