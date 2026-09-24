import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const webRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(webRoot, path), 'utf8');

test('the preview card opens the link safely and shows only the image the server stored', () => {
  const card = read('src/lib/shared/chat/LinkPreviewCard.svelte');
  assert.match(card, /href=\{preview\.url\} target="_blank" rel="noopener noreferrer nofollow"/);
  assert.match(card, /linkPreviewImageUrl\(preview\.image\.key\)/);
  assert.doesNotMatch(card, /\{@html/);
  assert.match(card, /width=\{preview\.image\.width\}/, 'the image reserves its space before it loads');
  assert.doesNotMatch(card, /color-mix\([^)]*white/);
});

test('the preview card is compact: a thumbnail on the left, one line of title and two of description', () => {
  const card = read('src/lib/shared/chat/LinkPreviewCard.svelte');
  assert.match(card, /class:link-preview--with-image=\{Boolean\(imageUrl\)\}/);
  assert.match(card, /\.link-preview--with-image \{\s*grid-template-columns: 96px minmax\(0, 1fr\);/);
  // The text sets the card's height; the picture only fills it, so a square
  // logo cannot stretch a short card.
  assert.match(card, /\.link-preview__thumb \{[^}]*position: relative;[^}]*width: 96px;/);
  assert.match(card, /\.link-preview__image \{[^}]*position: absolute;[^}]*inset: 0;[^}]*object-fit: cover;/);
  assert.match(card, /\.link-preview__site,\s*\.link-preview__title \{[^}]*white-space: nowrap;/);
  assert.match(card, /\.link-preview__description \{[^}]*-webkit-line-clamp: 2;[^}]*line-clamp: 2;/);
  // The text sits after the picture in the markup, so it reads left to right.
  assert.ok(card.indexOf('class="link-preview__thumb"') < card.indexOf('class="link-preview__text"'));
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
