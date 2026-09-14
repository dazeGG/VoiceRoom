import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const webRoot = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(webRoot, path), 'utf8');

test('the message field holds text and emoji artwork, and hands out plain text', () => {
  const composer = read('src/lib/shared/chat/EmojiComposer.svelte');

  assert.match(composer, /role="textbox"/);
  assert.match(composer, /contenteditable=\{disabled \? 'false' : 'true'\}/);
  assert.match(composer, /aria-multiline="true"/);
  assert.match(composer, /value = \$bindable\(''\)/);
  // Built node by node from the emoji splitter, never from markup.
  assert.doesNotMatch(composer, /\{@html|innerHTML/);
  assert.match(composer, /for \(const part of splitEmoji\(text\)\)/);
  assert.match(composer, /image\.src = emojiAssetUrl\(part\.emoji\)/);
  assert.match(composer, /image\.dataset\.text = part\.text/);
  // The trailing break that lets an empty last line show is not part of the text.
  assert.match(composer, /trailing\.dataset\.trailing = ''/);
  assert.match(composer, /isTrailingBreak\(child\) \? '' : '\\n'/);
});

test('the field behaves like a plain-text box: pasting, dropping and copying carry text only', () => {
  const composer = read('src/lib/shared/chat/EmojiComposer.svelte');

  assert.match(composer, /function onPaste\(event: ClipboardEvent\): void \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?getData\('text\/plain'\)/);
  assert.match(composer, /function onDrop\(event: DragEvent\): void \{\s*if \(event\.dataTransfer\?\.files\.length\) return;/);
  assert.match(composer, /setData\('text\/plain', serialize\(range\.cloneContents\(\)\)\)/);
  assert.match(composer, /event\.inputType\.startsWith\('format'\)/);
  assert.match(composer, /event\.inputType === 'insertParagraph' \|\| event\.inputType === 'insertLineBreak'/);
  // IME input is left alone until the composition ends.
  assert.match(composer, /if \(!root \|\| composing\) return;/);
  // The length limit holds for typing, pasting and emoji.
  assert.match(composer, /insertIntoDraft\(current, text, getSelection\(\), maxlength\)/);
  assert.match(composer, /text\.length > maxlength/);
});

test('the caret survives the emoji picker taking focus, and outside changes are drawn', () => {
  const composer = read('src/lib/shared/chat/EmojiComposer.svelte');

  assert.match(composer, /document\.addEventListener\('selectionchange', remember\)/);
  assert.match(composer, /return lastSelection \?\? \{ start: value\.length, end: value\.length \}/);
  assert.match(composer, /if \(!root \|\| next === rendered\) return;/);
  for (const name of ['focus', 'getSelection', 'setSelection', 'insertText']) {
    assert.match(composer, new RegExp(`export function ${name}\\(`));
  }
});

test('both chats write messages and edits in the field instead of a textarea', () => {
  const roomChat = read('src/lib/features/room/components/RoomChatPanel.svelte');
  const dmView = read('src/lib/features/home/components/lobby/DmView.svelte');

  for (const source of [roomChat, dmView]) {
    assert.doesNotMatch(source, /<textarea|autoResize|style\.height|setSelectionRange/);
    assert.equal((source.match(/<EmojiComposer\b/g) || []).length, 2, 'the message field and the edit field');
    assert.match(source, /editEl\?\.setSelection\(editDraft\.length\)/);
  }
  assert.match(roomChat, /mentionComposer\.choose\(draft, composeEl\.getSelection\(\)\.start, member\)/);
  assert.match(roomChat, /composeEl\?\.setSelection\(selected\.caret\)/);
  assert.match(roomChat, /maxlength=\{500\}/);

  const attachmentCss = read('src/lib/shared/chat/attachment.css');
  assert.match(attachmentCss, /\.attachment-compose-field \[role='textbox'\] \{/);
});
