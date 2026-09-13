import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const webRoot = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(webRoot, path), 'utf8');

test('the preview card opens the link safely and shows only the image the server stored', () => {
  const card = read('src/lib/shared/chat/LinkPreviewCard.svelte');
  assert.match(card, /href=\{preview\.url\} target="_blank" rel="noopener noreferrer nofollow"/);
  assert.match(card, /linkPreviewImageUrl\(preview\.image\.key\)/);
  assert.doesNotMatch(card, /\{@html/);
  assert.match(card, /width=\{preview\.image\.width\}/, 'the image reserves its space before it loads');
  assert.doesNotMatch(card, /color-mix\([^)]*white/);
});

test('room and direct messages render their preview and keep it through history and late copies', () => {
  const roomChat = read('src/lib/features/room/components/RoomChatPanel.svelte');
  assert.match(roomChat, /\{#if message\.linkPreview\}<LinkPreviewCard preview=\{message\.linkPreview\} \/>\{\/if\}/);

  const dmView = read('src/lib/features/home/components/lobby/DmView.svelte');
  assert.match(dmView, /\{#if bubble\.linkPreview\}<LinkPreviewCard preview=\{bubble\.linkPreview\} \/>\{\/if\}/);

  assert.match(read('src/lib/api/rooms.ts'), /linkPreview: normalizeLinkPreview\(message\.linkPreview\)/);
  assert.match(read('src/lib/api/dm.ts'), /normalizeLinkPreview\(message\.linkPreview \?\? metadata\.linkPreview\)/);
  assert.match(read('src/lib/features/home/model/friends.svelte.ts'), /known\?\.linkPreview && !incoming\.linkPreview/);
});
