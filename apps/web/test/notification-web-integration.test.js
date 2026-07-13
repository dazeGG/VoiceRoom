import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('notification API client uses required endpoints and credentialed helpers', () => {
  const api = read('src/lib/api/notifications.ts');

  assert.match(api, /import \{ getJsonAuth, postJsonAuth, putJson \} from '\.\/http'/);
  assert.match(api, /getJsonAuth<NotificationPreferencesResponse>\('\/api\/notifications\/preferences'\)/);
  assert.match(api, /putJson<NotificationMuteResponse>\(`\/api\/notifications\/dm\/\$\{encodeURIComponent\(userId\)\}\/mute`, \{ muted \}\)/);
  assert.doesNotMatch(api, /notifications\/rooms/);
  assert.match(api, /putJson<NotificationPreferencesResponse>\('\/api\/notifications\/privacy', \{ privateNotifications \}\)/);
  assert.match(api, /mutedPeerIds: string\[\]/);
  assert.doesNotMatch(api, /mutedRoomIds/);
  assert.match(api, /privateNotifications: boolean/);
  assert.match(api, /doNotDisturb: boolean/);
  assert.match(api, /presenceStatus: PresenceStatus/);
  assert.match(api, /postJsonAuth<NotificationPreferencesResponse>\('\/api\/notifications\/settings', \{ dnd \}\)/);
  assert.match(api, /postJsonAuth<NotificationPreferencesResponse>\('\/api\/presence\/status', \{ status \}\)/);
});

test('lobby startup loads notification preferences and realtime notification events route through browser helper', () => {
  const friends = read('src/lib/features/home/model/friends.svelte.ts');

  assert.match(friends, /loadNotificationPreferences/);
  assert.match(friends, /areNotificationPreferencesLoadedFor/);
  assert.match(friends, /resetNotificationPreferences/);
  assert.match(friends, /Promise\.all\(\[refreshFriends\(\), refreshRequests\(\)\]\)/);
  assert.match(friends, /scheduleNotificationPreferencesLoad\(currentUserId\)/);
  assert.match(friends, /prepareNotificationPreferences\(currentUserId, initialDoNotDisturb, initialPresenceStatus\)/);
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
  assert.match(friends, /doNotDisturb: notificationPreferences\.doNotDisturb/);
  assert.match(friends, /permission: getNotificationDeliveryPermission\(\)/);
  assert.match(friends, /showBrowserNotification\(routed\.payload\)/);
  assert.match(friends, /return \{ kind: 'dm', peerId: friendsState\.selectedFriendId \}/);
  assert.match(friends, /return \{ kind: 'room-preview', roomId: roomNavigation\.viewedRoomId \}/);

  assert.match(friends, /case 'dm\.message': \{/);
  assert.match(friends, /markThreadRead\(peerId\)/);
  assert.match(friends, /playDirectMessageCue\(\)/);
  assert.match(friends, /!isPeerNotificationsMuted\(peerId\)/);
  assert.match(friends, /friend\.unreadCount \+= 1/);
  assert.match(friends, /areNotificationPreferencesLoadedFor\(selfId\) && !isPeerNotificationsMuted\(peerId\)/);
  assert.match(friends, /if \(areNotificationPreferencesLoadedFor\(selfId\)\) playFriendRequestCue\(\)/);
});

test('notification permission request is isolated to explicit settings UI action', () => {
  const prefs = read('src/lib/shared/notifications/preferences.svelte.ts');
  const push = read('src/lib/features/home/model/push-notifications.svelte.ts');
  const settings = read('src/lib/features/home/components/SettingsModal.svelte');
  const friends = read('src/lib/features/home/model/friends.svelte.ts');

  assert.match(prefs, /requestNotificationPermissionFromUserAction/);
  assert.match(prefs, /browserPermission: NotificationPermissionState/);
  assert.match(prefs, /loadedForUserId: string \| null/);
  assert.match(prefs, /loadingForUserId: string \| null/);
  assert.match(prefs, /export function resetNotificationPreferences/);
  assert.match(prefs, /preferenceGeneration \+= 1/);
  assert.match(prefs, /activeUserId !== userId \|\| preferenceGeneration !== generation/);
  assert.match(prefs, /export function areNotificationPreferencesLoadedFor\(userId: string\)/);
  assert.match(prefs, /export async function loadNotificationPreferences\(userId: string\)/);
  assert.match(prefs, /notificationPreferences\.loadingForUserId === userId/);
  assert.match(prefs, /const preferences = await fetchNotificationPreferences\(\)/);
  assert.match(prefs, /const generation = preferenceGeneration/);
  assert.match(prefs, /activeUserId === userId &&\s+preferenceGeneration === generation &&\s+notificationPreferences\.loadingForUserId === userId/);
  assert.match(prefs, /applyPreferences\(preferences, userId\)/);
  assert.match(prefs, /deliveryPermission: NotificationPermissionState/);
  assert.match(prefs, /getNotificationDeliveryPermission\(\)/);
  assert.match(prefs, /export async function requestNotificationsFromUiAction/);
  assert.match(settings, /onclick=\{\(\) => void toggleBrowserNotifications\(\)\}/);
  assert.match(settings, /setPushNotificationsEnabled\(!pushNotifications\.active\)/);
  assert.match(push, /Notification\.requestPermission\(\)/);
  assert.match(push, /pushManager\.subscribe\(\{/);
  assert.match(settings, /notificationPreferences\.deliveryPermission === 'granted'/);
  assert.match(settings, /notificationPreferences\.browserPermission === 'denied'/);
  assert.match(settings, /Запрос выполняется только по вашему действию/);
  assert.doesNotMatch(friends, /requestNotificationPermissionFromUserAction|requestNotificationsFromUiAction/);
});

test('Web Push uses credentialed subscription endpoints and suppresses focused-window notifications', () => {
  const api = read('src/lib/api/push.ts');
  const worker = read('src/service-worker.ts');
  const push = read('src/lib/features/home/model/push-notifications.svelte.ts');
  const signOut = read('src/lib/features/home/model/sign-out.ts');
  const home = read('src/lib/features/home/HomePage.svelte');
  const roomRoute = read('src/routes/r/[roomId]/+page.svelte');

  assert.match(api, /fetchJson<PushConfig>\('\/api\/push\/config'\)/);
  assert.match(api, /postJsonAuth\('\/api\/push\/subscriptions', \{ subscription \}\)/);
  assert.match(api, /del\('\/api\/push\/subscriptions', \{ endpoint \}\)/);
  assert.match(push, /serviceWorker\.register\('\/service-worker\.js'/);
  assert.match(push, /savePushSubscription\(subscription\.toJSON\(\)\)/);
  assert.match(push, /detachPushSubscription/);
  assert.match(push, /syncGeneration/);
  assert.match(signOut, /detachPushSubscription\(\)\.catch/);
  assert.match(signOut, /await logout\(\)/);
  assert.match(home, /await signOut\(\)/);
  assert.match(roomRoute, /await signOut\(\)/);
  assert.match(worker, /client\.visibilityState === 'visible' && client\.focused/);
  assert.match(worker, /showNotification/);
  assert.match(worker, /notificationclick/);
  assert.match(worker, /openWindow\(target\.href\)/);
  assert.match(worker, /target\.origin !== self\.location\.origin/);
  const lobby = read('src/lib/features/home/LobbyPage.svelte');
  assert.match(lobby, /new URLSearchParams\(window\.location\.search\)\.get\('dm'\)/);
  assert.match(lobby, /openDm\(initialDmId\)/);
});

test('DM mute is server-backed while room mute is current-device localStorage', () => {
  const prefs = read('src/lib/shared/notifications/preferences.svelte.ts');
  const dm = read('src/lib/features/home/components/lobby/DmView.svelte');
  const roomMenu = read('src/lib/shared/components/room-menu/RoomMenuContent.svelte');
  const settings = read('src/lib/features/home/components/SettingsModal.svelte');

  assert.match(prefs, /setDmNotificationsMuted\(userId, muted\)/);
  assert.match(prefs, /MUTED_ROOM_NOTIFICATIONS_STORAGE_KEY = 'voice-room:muted-room-notifications'/);
  assert.match(prefs, /persistMutedRoomIds\(notificationPreferences\.mutedRoomIds\)/);
  assert.match(prefs, /storage\.setItem\(MUTED_ROOM_NOTIFICATIONS_STORAGE_KEY, JSON\.stringify\(roomIds\)\)/);
  assert.doesNotMatch(prefs, /setRoomNotificationsMuted/);
  assert.match(prefs, /setPrivateNotifications\(privateNotifications\)/);
  assert.match(dm, /updatePeerNotificationsMuted\(peer\.id, !peerMuted\)/);
  assert.match(dm, /data-notification-mute="dm"/);
  assert.match(roomMenu, /const nextMuted = !roomMuted/);
  assert.match(roomMenu, /updateRoomNotificationsMuted\(targetRoomId, nextMuted\)/);
  assert.match(roomMenu, /nextMuted \? 'Уведомления комнаты выключены' : 'Уведомления комнаты включены'/);
  assert.match(roomMenu, /roomMuted \? 'Включить уведомления' : 'Выключить уведомления'/);
  assert.match(settings, /updatePrivateNotifications\(!notificationPreferences\.privateNotifications\)/);
});

test('presence status is server-backed while DND suppresses notifications and cue playback', () => {
  const prefs = read('src/lib/shared/notifications/preferences.svelte.ts');
  const sidebar = read('src/lib/features/home/components/lobby/Sidebar.svelte');
  const settings = read('src/lib/features/home/components/SettingsModal.svelte');
  const cues = read('src/lib/features/room/client/media/cues.ts');
  const avatar = read('src/lib/shared/ui/Avatar/Avatar.svelte');
  const lobby = read('src/lib/features/home/LobbyPage.svelte');
  const friends = read('src/lib/features/home/model/friends.svelte.ts');

  assert.match(prefs, /presenceStatus: PresenceStatus/);
  assert.match(prefs, /setPresenceStatus\(status\)/);
  assert.match(sidebar, /updatePresenceStatus\(status\)/);
  assert.match(sidebar, /role="listbox"/);
  assert.match(sidebar, /role="option"/);
  assert.match(sidebar, /aria-selected=\{selected\}/);
  assert.match(sidebar, /bind:open=\{statusPopoverOpen\}/);
  assert.match(sidebar, /use:registerStatusOption=\{index\}/);
  assert.match(sidebar, /tabindex=\{index === activeStatusIndex \? 0 : -1\}/);
  assert.match(sidebar, /onkeydown=\{handleStatusTriggerKeydown\}/);
  assert.match(sidebar, /handleStatusOptionKeydown\(event, option\.value, close\)/);
  assert.match(sidebar, /event\.key === 'ArrowDown'/);
  assert.match(sidebar, /event\.key === 'ArrowUp'/);
  assert.match(sidebar, /event\.key === 'Home'/);
  assert.match(sidebar, /event\.key === 'End'/);
  assert.match(sidebar, /statusOptionRefs\[nextIndex\]\?\.focus\(\)/);
  assert.match(sidebar, /statusTypeaheadTimer = setTimeout\([\s\S]*700\)/);
  assert.match(sidebar, /option\.label\.toLocaleLowerCase\(\)\.startsWith\(statusTypeahead\)/);
  assert.match(sidebar, /event\.key\.length === 1[\s\S]*matchStatusTypeahead\(event\.key\)/);
  assert.match(sidebar, /В сети/);
  assert.match(sidebar, /Отошёл/);
  assert.match(sidebar, /Не беспокоить/);
  assert.match(sidebar, /Не в сети/);
  assert.match(sidebar, /Уведомления и звуковые сигналы будут отключены/);
  assert.doesNotMatch(sidebar, /Включить «Не беспокоить»|Выключить «Не беспокоить»/);
  assert.match(settings, /tab === 'notifications'/);
  assert.match(settings, /При статусе «Не беспокоить» push-уведомления и звуковые сигналы не воспроизводятся/);
  assert.doesNotMatch(settings, /Режим «Не беспокоить» включён|Режим «Не беспокоить» выключен/);
  assert.match(settings, /Настроить громкость сигналов/);
  assert.match(cues, /isDoNotDisturbPlaybackSuppressed\(\) \|\| isAppPlaybackMuted\(\)/);
  assert.match(avatar, /data-status=\{presence\}/);
  assert.match(avatar, /dnd: 'var\(--coral\)'/);
  assert.doesNotMatch(avatar, /ui-avatar-dot--dnd::after/);
  assert.match(lobby, /initLobby\(user\.id, user\.doNotDisturb, user\.presenceStatus\)/);
  assert.match(friends, /notification\.settings\.updated/);
  assert.match(friends, /applyRealtimeNotificationPreferences\(selfId, event\.payload\.preferences\)/);
  assert.match(prefs, /applyRealtimeNotificationPreferences[\s\S]*preferenceGeneration \+= 1;[\s\S]*notificationPreferences\.loadingForUserId = null/);
});
