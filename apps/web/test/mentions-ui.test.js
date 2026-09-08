import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(webRoot, relative), 'utf8');

test('the mention list identifies people by face, name and login', () => {
  const menu = read('src/lib/shared/chat/MentionAutocomplete.svelte');

  // Two people can carry the same display name, so the row shows the avatar and
  // the login that actually goes into the message, not just the label.
  assert.match(menu, /import \{ Avatar \} from '\$lib\/shared\/ui'/);
  assert.match(menu, /<Avatar[\s\S]*src=\{member\.avatarUrl\}/);
  assert.match(menu, /<Avatar[\s\S]*colorKey=\{member\.avatarColorKey\}/);
  assert.match(menu, /\{label\(member\)\}/);
  assert.match(menu, /@\{member\.login\}/);
});

test('a rendered mention opens that person, and stays inert without a handler', () => {
  const content = read('src/lib/shared/chat/StructuredMessageContent.svelte');
  const panel = read('src/lib/features/room/components/RoomChatPanel.svelte');
  const adapter = read('src/lib/features/room/profile-card-adapter.ts');

  assert.match(content, /onmention\?: \(userId: string, label: string, event: MouseEvent\) => void/);
  assert.match(content, /\{#if onmention && segment\.userId\}<button class="structured-message__mention"/);
  // A preview or a quoted reply passes no handler, so it must not offer an
  // action that leads nowhere.
  assert.match(content, /\{:else\}<span class="structured-message__mention"/);

  assert.match(panel, /onmention=\{openMentionProfile\}/);
  assert.match(panel, /function openMentionProfile\(userId: string, label: string, event: MouseEvent\)/);
  // The same card the author's avatar opens, so "who is this" has one answer.
  assert.match(panel, /openProfileCardFor\(person, anchor\)/);
  assert.match(adapter, /export function mentionProfilePerson\(/);
  // Filled in from the membership first, then a live participant, then the
  // label — a stranger who has left still resolves to something showable.
  assert.match(adapter, /members\.find\(\(entry\) => entry\.userId === userId\)/);
  assert.match(adapter, /participants\.find\(\(entry\) => entry\.accountUserId === userId\)/);
});

test('a message that names you is marked for you and nobody else', () => {
  const panel = read('src/lib/features/room/components/RoomChatPanel.svelte');
  const css = read('src/lib/features/room/styles/chat-rail.css');

  assert.match(panel, /function mentionsMe\(message: ChatMessage\): boolean/);
  assert.match(panel, /segment\.type === 'mention' && segment\.userId === selfUserId/);
  assert.match(panel, /class:mentions-me=\{mentionsMe\(message\)\}/);
  assert.match(css, /\.chat-msg-text\.mentions-me::before/);
  assert.match(css, /\.chat-msg-text\.mentions-me::after/);

  // Hover and the open context menu are defined after it, so pointing at a
  // mention behaves like pointing at any other message.
  assert.ok(css.indexOf('.chat-msg-text.mentions-me::before') < css.indexOf('.chat-msg-text.is-context::before'));
});
