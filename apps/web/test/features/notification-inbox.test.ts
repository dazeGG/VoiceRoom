// The notifications inbox: paging, read state, and links that open the
// message without joining the room's voice.

import type { InboxItem, InboxPage } from '@voice-room/shared/contracts/notifications';
import { expect, test, vi } from 'vitest';
import { ApiError } from '../../src/lib/api/client.ts';
import { notificationRoute } from '@voice-room/shared/notifications';
import { createNotificationInbox } from '../../src/lib/shared/notifications/inbox.svelte.ts';

const item = (id: string, readAt: number | null = null): InboxItem => ({
  id,
  roomId: 'room-a',
  sourceMessageId: `m-${id}`,
  actorUserId: 'u-anna',
  reasons: ['mention'],
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
  readAt,
  retractedAt: null,
  body: 'текст'
});
const envelope = (notifications: InboxItem[], extra: Partial<InboxPage> = {}): InboxPage => ({
  contractVersion: 1,
  notifications,
  pageInfo: { hasMore: false },
  unreadCount: notifications.length,
  revision: 1,
  firstUnread: null,
  ...extra
});

test('a notification links to the room preview at the message, never to the joining /r/ route', () => {
  expect(notificationRoute({ roomId: 'room a', sourceMessageId: 'm/1' })).toBe('/?room=room%20a&message=m%2F1');
});

test('the inbox loads pages without duplicates and reports a broken answer', async () => {
  const list = vi
    .fn()
    .mockResolvedValueOnce(envelope([item('1'), item('2')], { pageInfo: { hasMore: true, nextCursor: 'c2' } }))
    .mockResolvedValueOnce(envelope([item('2'), item('3')]))
    .mockRejectedValueOnce(new ApiError('Сервер прислал непонятный ответ, обновите страницу', 200));
  const inbox = createNotificationInbox({ list, read: vi.fn(), readAll: vi.fn() });

  await inbox.load();
  expect(inbox.hasMore).toBe(true);
  await inbox.load(true);
  expect(list).toHaveBeenLastCalledWith('c2');
  expect(inbox.items.map((entry) => entry.id)).toEqual(['1', '2', '3']);

  await inbox.load();
  expect(inbox.error).toBe('Сервер прислал непонятный ответ, обновите страницу');
  expect(inbox.loading).toBe(false);
});

test('reading one or all updates the unread count from the server answer', async () => {
  const inbox = createNotificationInbox({
    list: vi.fn(async () => envelope([item('1'), item('2')])),
    read: vi.fn(async (id: string) => ({ ok: true as const, notification: item(id, 5), unreadCount: 1, revision: 2 })),
    readAll: vi.fn(async () => ({ ok: true as const, updated: 2, unreadCount: 0, revision: 3 }))
  });
  await inbox.load();
  expect(inbox.unreadCount).toBe(2);

  await inbox.markRead('1');
  expect(inbox.unreadCount).toBe(1);
  expect(inbox.items[0]?.readAt).not.toBeNull();

  await inbox.markAllRead();
  expect(inbox.unreadCount).toBe(0);
  expect(inbox.items.every((entry) => entry.readAt)).toBe(true);
});

test('a newer revision from realtime reloads the inbox; an old one does not', async () => {
  const list = vi.fn(async () => envelope([item('1')], { revision: 5 }));
  const inbox = createNotificationInbox({ list, read: vi.fn(), readAll: vi.fn() });
  await inbox.load();
  inbox.reconcile(4);
  expect(list).toHaveBeenCalledTimes(1);
  inbox.reconcile(6);
  expect(list).toHaveBeenCalledTimes(2);
});
