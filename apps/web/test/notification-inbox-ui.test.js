import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(webRoot, relative), 'utf8');

test('the notification panel offers one bulk action and cannot scroll sideways', () => {
  const inbox = read('src/lib/features/home/components/NotificationInbox.svelte');
  const lobby = read('src/lib/features/home/LobbyPage.svelte');

  // Two header buttons plus a floating close overflowed the header, which gave
  // the whole panel a horizontal scrollbar. Every unread row is already one
  // click away, so the jump-to-first button is gone.
  assert.doesNotMatch(inbox, /К первому непрочитанному/);
  assert.doesNotMatch(inbox, /firstUnread/);
  assert.match(inbox, /Прочитать все/);
  assert.match(inbox, /onclose\?: \(\) => void/);
  assert.doesNotMatch(lobby, /notification-inbox-close/);
  assert.match(lobby, /\.notification-inbox-panel \{[^}]*overflow: hidden/);
  assert.match(inbox, /\.notification-inbox-body \{[\s\S]*?overflow-x: hidden/);

  // Reasons arrive as protocol values; a row that says "mention" is the wire
  // format leaking into the page.
  assert.match(inbox, /mention: 'Упоминание'/);
  assert.match(inbox, /reply: 'Ответ'/);
  assert.match(inbox, /function timeAgo\(value: unknown\)/);
});

test('a mention is audible and counted while the lobby is open', () => {
  const friends = read('src/lib/features/home/model/friends.svelte.ts');
  const lobby = read('src/lib/features/home/LobbyPage.svelte');

  // The realtime event fires for every message in every room you belong to, so
  // it cannot say you were the one addressed. The inbox can, because that is
  // exactly what it holds — a rise in its unread count is the ping.
  assert.match(lobby, /event\.type !== 'notification\.room\.message'/);
  assert.match(lobby, /const before = notificationInbox\.unreadCount/);
  assert.match(lobby, /notificationInbox\.unreadCount > before/);
  // Keyed by message id so a room chat panel that already rang for it stays quiet.
  assert.match(lobby, /playRoomChatMessageCue\(messageId\)/);
  assert.match(lobby, /teardownNotifications\(\)/);

  // Muting a room asks not to hear the conversation, not to be unreachable, so
  // only Do Not Disturb silences a ping.
  assert.match(lobby, /!notificationPreferences\.doNotDisturb/);
  assert.doesNotMatch(lobby, /mutedRoomIds/);

  // The room-wide cue is gone with it: it fired for messages nobody addressed.
  assert.doesNotMatch(friends, /playRoomChatMessageCue/);
});
