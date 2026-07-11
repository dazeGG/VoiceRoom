import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('notification API client uses required endpoints and credentialed helpers', () => {
  const api = read('src/lib/api/notifications.ts');

  assert.match(api, /import \{ getJsonAuth, putJson \} from '\.\/http'/);
  assert.match(api, /getJsonAuth<NotificationPreferencesResponse>\('\/api\/notifications\/preferences'\)/);
  assert.match(api, /putJson<NotificationMuteResponse>\(`\/api\/notifications\/dm\/\$\{encodeURIComponent\(userId\)\}\/mute`, \{ muted \}\)/);
  assert.match(api, /putJson<NotificationMuteResponse>\(`\/api\/notifications\/rooms\/\$\{encodeURIComponent\(roomId\)\}\/mute`, \{ muted \}\)/);
  assert.match(api, /putJson<NotificationPreferencesResponse>\('\/api\/notifications\/privacy', \{ privateNotifications \}\)/);
  assert.match(api, /mutedPeerIds: string\[\]/);
  assert.match(api, /mutedRoomIds: string\[\]/);
  assert.match(api, /privateNotifications: boolean/);
});

test('lobby startup loads notification preferences and realtime notification events route through browser helper', () => {
  const friends = read('src/lib/features/home/model/friends.svelte.ts');

  assert.match(friends, /loadNotificationPreferences/);
  assert.match(friends, /areNotificationPreferencesLoadedFor/);
  assert.match(friends, /resetNotificationPreferences/);
  assert.match(friends, /Promise\.all\(\[refreshFriends\(\), refreshRequests\(\)\]\)/);
  assert.match(friends, /scheduleNotificationPreferencesLoad\(currentUserId\)/);
  assert.match(friends, /function scheduleNotificationPreferencesLoad\(userId = selfId\)/);
  assert.match(friends, /loadNotificationPreferences\(userId\)/);
  assert.match(friends, /\.then\(flushPendingNotificationEvents\)/);
  assert.match(friends, /notificationPreferencesRetryTimer = setTimeout/);
  assert.match(friends, /event\.type\.startsWith\('notification\.'\)/);
  assert.match(friends, /MAX_PENDING_NOTIFICATION_EVENTS = 100/);
  assert.match(friends, /PENDING_NOTIFICATION_TTL_MS = 60_000/);
  assert.match(friends, /pendingNotificationEvents\.push\(\{ event, receivedAt: now \}\)/);
  assert.match(friends, /slice\(-\(MAX_PENDING_NOTIFICATION_EVENTS - 1\)\)/);
  assert.match(friends, /!areNotificationPreferencesLoadedFor\(selfId\)/);
  assert.match(friends, /function flushPendingNotificationEvents\(\)/);
  assert.match(friends, /routeNotificationEvent\(event, \{/);
  assert.match(friends, /userId: selfId/);
  assert.match(friends, /activeTarget: getActiveNotificationTarget\(\)/);
  assert.match(friends, /mutedPeerIds: notificationPreferences\.mutedPeerIds/);
  assert.match(friends, /mutedRoomIds: notificationPreferences\.mutedRoomIds/);
  assert.match(friends, /privateNotifications: notificationPreferences\.privateNotifications/);
  assert.match(friends, /permission: getNotificationDeliveryPermission\(\)/);
  assert.match(friends, /showBrowserNotification\(routed\.payload\)/);
  assert.match(friends, /return \{ kind: 'dm', peerId: friendsState\.selectedFriendId \}/);
  assert.match(friends, /return \{ kind: 'room-preview', roomId: roomNavigation\.viewedRoomId \}/);

  assert.match(friends, /case 'dm\.message': \{/);
  assert.match(friends, /markThreadRead\(peerId\)/);
  assert.match(friends, /playDirectMessageCue\(\)/);
  assert.match(friends, /friend\.unreadCount \+= 1/);
});

test('notification permission request is isolated to explicit settings UI action', () => {
  const prefs = read('src/lib/features/home/model/notification-preferences.svelte.ts');
  const settings = read('src/lib/features/home/components/SettingsModal.svelte');
  const friends = read('src/lib/features/home/model/friends.svelte.ts');

  assert.match(prefs, /requestNotificationPermissionFromUserAction/);
  assert.match(prefs, /browserPermission: NotificationPermissionState/);
  assert.match(prefs, /loadedForUserId: string \| null/);
  assert.match(prefs, /loadingForUserId: string \| null/);
  assert.match(prefs, /export function resetNotificationPreferences/);
  assert.match(prefs, /export function areNotificationPreferencesLoadedFor\(userId: string\)/);
  assert.match(prefs, /export async function loadNotificationPreferences\(userId: string\)/);
  assert.match(prefs, /notificationPreferences\.loadingForUserId === userId/);
  assert.match(prefs, /const preferences = await fetchNotificationPreferences\(\)/);
  assert.match(prefs, /applyPreferences\(preferences, userId\)/);
  assert.match(prefs, /deliveryPermission: NotificationPermissionState/);
  assert.match(prefs, /getNotificationDeliveryPermission\(\)/);
  assert.match(prefs, /export async function requestNotificationsFromUiAction/);
  assert.match(settings, /onclick=\{\(\) => void requestBrowserNotifications\(\)\}/);
  assert.match(settings, /notificationPreferences\.deliveryPermission === 'granted'/);
  assert.match(settings, /notificationPreferences\.browserPermission === 'denied'/);
  assert.match(settings, /Запрос выполняется только по вашему действию/);
  assert.doesNotMatch(friends, /requestNotificationPermissionFromUserAction|requestNotificationsFromUiAction/);
});

test('mute toggles call state helpers that call the correct API clients', () => {
  const prefs = read('src/lib/features/home/model/notification-preferences.svelte.ts');
  const dm = read('src/lib/features/home/components/lobby/DmView.svelte');
  const roomHeader = read('src/lib/features/home/components/lobby/RoomViewHeader.svelte');
  const settings = read('src/lib/features/home/components/SettingsModal.svelte');

  assert.match(prefs, /setDmNotificationsMuted\(userId, muted\)/);
  assert.match(prefs, /setRoomNotificationsMuted\(roomId, muted\)/);
  assert.match(prefs, /setPrivateNotifications\(privateNotifications\)/);
  assert.match(dm, /updatePeerNotificationsMuted\(peer\.id, !peerMuted\)/);
  assert.match(dm, /data-notification-mute="dm"/);
  assert.match(roomHeader, /updateRoomNotificationsMuted\(room\.roomId, !roomMuted\)/);
  assert.match(roomHeader, /roomMuted \? 'Включить уведомления' : 'Выключить уведомления'/);
  assert.match(settings, /updatePrivateNotifications\(!notificationPreferences\.privateNotifications\)/);
});
