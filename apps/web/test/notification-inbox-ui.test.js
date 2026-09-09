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
  const router = read('src/lib/shared/notifications/router.ts');
  const friends = read('src/lib/features/home/model/friends.svelte.ts');
  const lobby = read('src/lib/features/home/LobbyPage.svelte');

  // The sound must not hang off the browser-notification permission: being
  // pinged while sitting in the app should be audible even if that was denied.
  const cueStart = router.indexOf('export function shouldPlayNotificationCue');
  const cueBody = router.slice(cueStart, router.indexOf('\n}', cueStart));
  assert.ok(cueStart > 0);
  assert.doesNotMatch(cueBody, /notificationsAvailable|options\.permission/);
  assert.match(cueBody, /options\.doNotDisturb/);
  assert.match(cueBody, /activeTargetSuppresses/);
  assert.match(friends, /shouldPlayNotificationCue\(event, \{/);
  assert.match(friends, /playRoomChatMessageCue\(\)/);

  // And the badge has to catch up without a reload.
  assert.match(lobby, /event\.type !== 'notification\.room\.message'/);
  assert.match(lobby, /void notificationInbox\.load\(\)/);
  assert.match(lobby, /teardownNotifications\(\)/);
});
