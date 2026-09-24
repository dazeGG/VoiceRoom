import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const webRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(webRoot, path), 'utf8');

// One Vite server for the whole file, without a file watcher (see
// desktop-os-integration.test.ts).
let serverPromise: ReturnType<typeof createServer> | null = null;

function getServer() {
  serverPromise ??= createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: webRoot,
    server: { hmr: false, middlewareMode: true, watch: null }
  });
  return serverPromise;
}

after(async () => {
  if (serverPromise) await (await serverPromise).close();
});

async function loadInsert() {
  const server = await getServer();
  return server.ssrLoadModule('/src/lib/shared/chat/composer-insert.ts');
}

test('an emoji lands at the caret, replaces a selection, and leaves the caret after itself', async () => {
  const { insertIntoDraft } = await loadInsert();
  assert.deepEqual(insertIntoDraft('привет мир', '👋', { start: 6, end: 6 }), { text: 'привет👋 мир', caret: 8 });
  assert.deepEqual(insertIntoDraft('привет мир', '🌍', { start: 7, end: 10 }), { text: 'привет 🌍', caret: 9 });
  assert.deepEqual(insertIntoDraft('', '😂', { start: 0, end: 0 }), { text: '😂', caret: 2 });
});

test('a field that never had a caret gets the emoji at the end, and out-of-range carets are clamped', async () => {
  const { insertIntoDraft } = await loadInsert();
  assert.deepEqual(insertIntoDraft('ок', '👍', { start: null, end: undefined }), { text: 'ок👍', caret: 4 });
  assert.deepEqual(insertIntoDraft('ок', '👍', { start: 99, end: 99 }), { text: 'ок👍', caret: 4 });
  assert.deepEqual(insertIntoDraft('ок', '👍', { start: 2, end: 0 }), { text: 'ок👍', caret: 4 }, 'an end before the start is an empty selection');
});

test('an emoji that would overflow the field is not inserted', async () => {
  const { insertIntoDraft } = await loadInsert();
  assert.equal(insertIntoDraft('a'.repeat(499), '👍', { start: 499, end: 499 }, 500), null);
  assert.deepEqual(insertIntoDraft('a'.repeat(498), '👍', { start: 498, end: 498 }, 500)?.caret, 500);
});

test('both composers carry an emoji button on the right that inserts and announces browsing', () => {
  const roomChat = read('src/lib/features/room/components/RoomChatPanel.svelte');
  const dmView = read('src/lib/features/home/components/lobby/DmView.svelte');

  for (const [source, field] of [[roomChat, 'composeEl'], [dmView, 'inputEl']]) {
    // After the field, inside the same control row as the attachment button.
    assert.match(source, /class="attachment-compose-controls">[\s\S]*<EmojiComposer[\s\S]*?\/>\s*<ComposerEmojiPicker/);
    assert.match(source, /onpick=\{insertEmoji\}/);
    assert.match(source, /onbrowse=\{\(\) => typingNotifier\.notify\('emoji'\)\}/);
    // The field puts the emoji at its remembered caret and reports the input.
    assert.match(source, new RegExp(`function insertEmoji\\(emoji: string\\): void \\{\\s*${field}\\?\\.insertText\\(emoji\\);\\s*\\}`));
  }
});

test('reactions and the composer browse emoji through one panel', () => {
  const panel = read('src/lib/shared/chat/EmojiPickerPanel.svelte');
  const reactions = read('src/lib/shared/chat/ReactionPicker.svelte');
  const composer = read('src/lib/shared/chat/ComposerEmojiPicker.svelte');

  assert.match(reactions, /<EmojiPickerPanel \{frequentEmoji\} onpick=/);
  assert.match(composer, /<EmojiPickerPanel[\s\S]*searchLabel="Поиск эмодзи"[\s\S]*onpick=/);
  assert.doesNotMatch(panel, /store\.|toggle\(/, 'the panel knows nothing about reactions');

  assert.match(composer, /placement="top-end"/);
  assert.match(composer, /aria-label="Добавить эмодзи"/);
  assert.match(composer, /<Smile /);
  // Browsing is repeated faster than the notifier's throttle, so the state
  // never lapses while the panel is open, and it stops with the panel.
  assert.match(composer, /setInterval\(browse, TYPING_NOTICE_INTERVAL_MS \/ 2\)/);
  assert.match(composer, /return \(\) => clearInterval\(timer\)/);
  assert.match(composer, /close\(false\);\s*onpick\(emoji\);/);
  assert.match(read('src/lib/features/room/styles/chat-rail.css'), /\.chat-rail-compose \.composer-emoji-root \{\s*margin-top: 5px;/);
});
