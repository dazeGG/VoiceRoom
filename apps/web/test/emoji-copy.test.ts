import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const webRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(webRoot, path), 'utf8');

test('emoji in text can be selected and carry their character for copying', () => {
  const emoji = read('src/lib/shared/chat/Emoji.svelte');
  assert.match(emoji, /data-emoji=\{emoji\}/);
  // Inline emoji follow the text's selection; reaction and picker buttons do not.
  assert.match(emoji, /\.emoji-inline \{[^}]*user-select: auto;/);
  assert.match(emoji, /\.emoji \{[^}]*user-select: none;/);
});

test('a copied selection with emoji artwork gets the characters back', () => {
  const copy = read('src/lib/shared/chat/emoji-copy.ts');
  assert.match(copy, /const EMOJI_SELECTOR = 'img\[data-emoji\]'/);
  assert.match(copy, /image\.replaceWith\(document\.createTextNode\(image\.dataset\.emoji \?\? image\.alt\)\)/);
  assert.match(copy, /return \{ text: holder\.innerText, html: holder\.innerHTML \}/);
  assert.match(copy, /holder\.remove\(\)/);
  // Left alone: copies without emoji, and copies the message field handled itself.
  assert.match(copy, /if \(event\.defaultPrevented \|\| !event\.clipboardData\) return;/);
  assert.match(copy, /if \(!changed\) return;/);
  assert.match(copy, /setData\('text\/plain', text\)/);
});

test('the app listens for copies once, for the whole document', () => {
  const layout = read('src/routes/+layout.svelte');
  assert.match(layout, /import \{ installEmojiCopy \} from '\$lib\/shared\/chat\/emoji-copy'/);
  assert.match(layout, /installEmojiCopy\(\)/);
});
