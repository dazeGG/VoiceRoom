import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(webRoot, relative), 'utf8');

test('a mention link previews the room with its chat open and never joins voice', () => {
  const inbox = read('src/lib/shared/notifications/inbox.svelte.ts');
  const lobby = read('src/lib/features/home/LobbyPage.svelte');

  // /r/:roomId means "put me back inside this room" and joins on load, so the
  // link must not go there; the panel and push share one builder.
  assert.match(inbox, /notificationRoute as sharedNotificationRoute/);
  assert.doesNotMatch(inbox, /`\/r\//);

  // Opened in-app, not by reloading onto a join route.
  const open = lobby.slice(lobby.indexOf('function openNotification'));
  assert.doesNotMatch(open.slice(0, open.indexOf('\n  }')), /window\.location\.assign/);
  assert.match(open, /openRoomMessage\(item\.roomId, item\.sourceMessageId\)/);

  const route = lobby.slice(lobby.indexOf('function openRoomMessage'));
  const body = route.slice(0, route.indexOf('\n  }'));
  assert.match(body, /selectRoomPreview\(roomId\)/);
  assert.doesNotMatch(body, /selectRoomForVoiceEntry/);
  // Already in that room: show its own chat rather than a second preview.
  assert.match(body, /getActiveVoiceRoomId\(\) === roomId/);
  assert.match(body, /openChat\(\)/);

  // Links from outside the app (push) land on the same handler.
  assert.match(lobby, /initialParams\.get\('room'\)/);
  assert.match(lobby, /initialParams\.get\('message'\)/);
  assert.match(lobby, /openRoomMessage\(linkedRoomId, linkedMessageId\)/);
});

test('the preview opens on the chat and scrolls it to the linked message', () => {
  const lobby = read('src/lib/features/home/LobbyPage.svelte');
  const preview = read('src/lib/features/home/components/lobby/RoomPreviewView.svelte');
  const previewChat = read('src/lib/features/home/components/lobby/RoomPreviewChat.svelte');
  const chat = read('src/lib/features/room/components/RoomChatPanel.svelte');

  assert.match(lobby, /initialPanel=\{anchor \? 'chat' : null\}/);
  assert.match(lobby, /aroundMessageId=\{anchor\?\.messageId\}/);
  // A second mention in a room already on screen still reopens it.
  assert.match(lobby, /\{#key anchor\?\.messageId \?\? ''\}/);

  assert.match(preview, /activePanel = untrack\(\(\) => initialPanel\)/);
  assert.match(preview, /<RoomPreviewChat[\s\S]*\{aroundMessageId\}/);
  assert.match(previewChat, /\{aroundMessageId\}/);
  assert.match(chat, /aroundMessageId\?: string;/);
  assert.match(chat, /const anchorMessageId = aroundMessageId \|\| new URL\(window\.location\.href\)\.searchParams\.get\('around'\)/);
  assert.match(chat, /history\.open\(roomId, anchorMessageId\)/);
});
