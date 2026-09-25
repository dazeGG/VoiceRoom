// @ts-nocheck -- not type-checked yet; remove once the file passes tsconfig.test.json.
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const webRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(webRoot, path), 'utf8');

async function loadEmojiText() {
  vi.resetModules();
  return import('../src/lib/shared/chat/emoji-text.ts');
}

const emojiParts = (parts) => parts.filter((part) => part.kind === 'emoji').map((part) => part.emoji);

test('text splits into its words and the emoji the artwork draws, and joins back unchanged', async () => {
  const { splitEmoji } = await loadEmojiText();
  const input = 'привет 😀 мир 🇷🇺👩‍💻👍🏽 1️⃣!';
  const parts = splitEmoji(input);

  assert.equal(parts.map((part) => part.text).join(''), input);
  assert.deepEqual(emojiParts(parts), ['😀', '🇷🇺', '👩‍💻', '👍🏽', '1️⃣']);
  assert.deepEqual(parts[0], { kind: 'text', text: 'привет ' });
  assert.deepEqual(splitEmoji(''), []);
  assert.deepEqual(splitEmoji('просто текст'), [{ kind: 'text', text: 'просто текст' }]);
});

test('adjacent emoji stay separate and the longest sequence wins', async () => {
  const { splitEmoji } = await loadEmojiText();
  assert.deepEqual(emojiParts(splitEmoji('😀😀')), ['😀', '😀']);
  // A family is one emoji, not three people and two joiners.
  assert.deepEqual(emojiParts(splitEmoji('👨‍👩‍👦')), ['👨‍👩‍👦']);
  // An odd regional indicator after a flag is left as text.
  const flags = splitEmoji('🇷🇺🇷');
  assert.deepEqual(emojiParts(flags), ['🇷🇺']);
  assert.equal(flags.at(-1).kind, 'text');
});

test('a missing presentation selector still reads as the emoji, but a lone text character stays text', async () => {
  const { splitEmoji } = await loadEmojiText();
  assert.deepEqual(emojiParts(splitEmoji('❤️')), ['❤️']);
  assert.deepEqual(emojiParts(splitEmoji('❤')), [], '❤ without the selector is typed as text');
  assert.deepEqual(emojiParts(splitEmoji('©')), []);
  assert.deepEqual(emojiParts(splitEmoji('1')), []);
  // Sequences written without selectors map to the catalogue spelling.
  assert.deepEqual(emojiParts(splitEmoji('❤‍🔥')), ['❤️‍🔥']);

  // A stray selector right after an emoji belongs to it.
  const trailing = splitEmoji('a😀️ b');
  assert.deepEqual(
    trailing.map((part) => part.text),
    ['a', '😀️', ' b']
  );
});

test('what the artwork does not draw is left as text, never offered as an image', async () => {
  const { splitEmoji, hasEmoji } = await loadEmojiText();
  const catalogue = JSON.parse(read('src/lib/shared/chat/emoji-coverage.json')) as { emojis: string[] };
  const offered = new Set(catalogue.emojis);

  // A standalone skin tone swatch is a component, not an emoji of its own.
  assert.equal(hasEmoji('🏽'), false);
  for (const part of splitEmoji('🙂 🫪 🇺🇳 🦖 🧑‍🧑‍🧒')) {
    if (part.kind === 'emoji') assert.ok(offered.has(part.emoji), `${part.emoji} has artwork`);
  }
  for (const emoji of catalogue.emojis) {
    const parts = splitEmoji(emoji);
    assert.equal(parts.length, 1, `${emoji} is one part`);
    assert.equal(parts[0].emoji, emoji);
  }
});
