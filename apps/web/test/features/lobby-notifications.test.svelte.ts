// The lobby bell: a mention that raises the inbox's unread count is heard even
// in a muted room, but not while do-not-disturb is on; other room traffic is
// silent.

import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { stubFetch } from '../fixtures/fetch.ts';
import { FakeWebSocket, installFakeWebSocket } from '../fixtures/fake-websocket.ts';

const playRoomChatMessageCue = vi.fn();
vi.mock('../../src/lib/features/room/client/media/cues', () => ({ playRoomChatMessageCue }));

const { LobbyNotifications } = await import('../../src/lib/features/home/model/lobby-notifications.svelte.ts');
const realtime = await import('../../src/lib/api/realtime.ts');
const { notificationPreferences } = await import('../../src/lib/shared/notifications/preferences.svelte.ts');

let unread = 0;
const envelope = () => ({
  contractVersion: 1,
  notifications: [],
  pageInfo: { hasMore: false },
  unreadCount: unread,
  revision: unread,
  firstUnread: null
});

// The app keeps one realtime connection for its whole life, so the tests share it.
let socket: FakeWebSocket;
let inboxLoads = () => 0;

beforeAll(() => {
  installFakeWebSocket();
  realtime.connectRealtime(() => {});
  socket = FakeWebSocket.latest();
  socket.open();
});

beforeEach(() => {
  unread = 0;
  playRoomChatMessageCue.mockClear();
  const { calls } = stubFetch({
    'GET /api/notifications/inbox': () => ({ body: envelope() })
  });
  inboxLoads = () => calls.filter((call) => call.url === '/api/notifications/inbox').length;
});

afterEach(() => {
  notificationPreferences.doNotDisturb = false;
});

function roomMessage(id: string): void {
  socket.receive({
    type: 'notification.room.message',
    payload: { roomId: 'room', message: { id } }
  });
}

test('a new mention plays the cue once the inbox confirms it; plain traffic does not', async () => {
  const notifications = new LobbyNotifications();
  const teardown = notifications.start();

  await vi.waitFor(() => expect(inboxLoads()).toBe(1));
  roomMessage('m1');
  await vi.waitFor(() => expect(inboxLoads()).toBe(2));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(playRoomChatMessageCue).not.toHaveBeenCalled();

  unread = 1;
  roomMessage('m2');
  await vi.waitFor(() => expect(playRoomChatMessageCue).toHaveBeenCalledWith('m2'));
  expect(notifications.inbox.unreadCount).toBe(1);
  teardown();
});

test('do-not-disturb keeps a mention silent while the badge still counts it', async () => {
  notificationPreferences.doNotDisturb = true;
  const notifications = new LobbyNotifications();
  const teardown = notifications.start();
  await vi.waitFor(() => expect(inboxLoads()).toBe(1));

  unread = 1;
  roomMessage('m1');
  await vi.waitFor(() => expect(notifications.inbox.unreadCount).toBe(1));
  expect(playRoomChatMessageCue).not.toHaveBeenCalled();
  teardown();
});

test('the bell panel loads the inbox when it opens', async () => {
  const notifications = new LobbyNotifications();
  unread = 3;
  notifications.toggle();
  expect(notifications.open).toBe(true);
  await vi.waitFor(() => expect(notifications.inbox.unreadCount).toBe(3));
  notifications.toggle();
  expect(notifications.open).toBe(false);
});
