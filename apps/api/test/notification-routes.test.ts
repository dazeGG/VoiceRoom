// The mention/reply inbox over HTTP on a bare Fastify app, with the real
// notification service over an in-memory inbox: what reaches the wire, the
// feature flag and the session guard.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fastify from 'fastify';
import type pg from 'pg';

import type { Failure } from '@voice-room/shared/contracts/http';
import type { InboxItemRead, InboxPage } from '@voice-room/shared/contracts/notifications';
import type { ApiContext } from '../src/app/context.ts';
import type { InboxNotification, InboxRepository } from '../src/domains/notifications/inbox.repository.ts';
import { createNotificationService } from '../src/domains/notifications/notification.service.ts';
import { registerNotificationRoutes } from '../src/domains/notifications/notifications.routes.ts';
import { AJV_OPTIONS, registerHttpKit } from '../src/platform/http/http-kit.ts';
import { fake, storedUser } from './fakes/index.ts';

const CREATED = new Date('2026-09-01T10:00:00.000Z');
const READ = new Date('2026-09-01T11:00:00.000Z');

function row(overrides: Partial<InboxNotification> = {}): InboxNotification {
  return {
    id: 'n-1',
    recipientUserId: 'user-1',
    actorUserId: 'actor-1',
    roomId: 'room-1',
    sourceMessageId: 'm-1',
    reasons: ['mention'],
    body: 'hello @alice',
    revision: 3,
    readAt: null,
    retractedAt: null,
    createdAt: CREATED,
    updatedAt: CREATED,
    cursorTuple: { createdAtMicros: '1', id: 'n-1' },
    ...overrides
  };
}

function inboxApp(t: TestContext, { enabled = true, signedIn = true }: { enabled?: boolean; signedIn?: boolean } = {}) {
  const app = fastify({ ajv: AJV_OPTIONS });
  t.after(() => app.close());
  registerHttpKit(app, { securityHeaders: () => ({}), recordRequest() {}, logRequest() {}, logHandlerFailure() {} });
  const levels = new Map<string, 'all' | 'mentions' | 'none'>();
  const notifications = createNotificationService({
    pool: fake<pg.Pool>({ query: (async () => ({ rows: [] })) as unknown as pg.Pool['query'] }),
    inbox: fake<InboxRepository>({
      async list() {
        return [row(), row({ id: 'n-2', retractedAt: READ, body: 'gone' })];
      },
      async unreadCount() {
        return { count: 2, revision: 3 };
      },
      async findFirstUnread() {
        return row();
      },
      async markRead({ notificationId }) {
        return notificationId === 'n-1' ? row({ readAt: READ, revision: 4 }) : null;
      },
      async markAllRead() {
        return { updated: 2, revision: 5 };
      }
    }),
    notificationStore: {
      async getRoomLevel({ roomId }) {
        return levels.get(roomId) ?? 'mentions';
      },
      async setRoomLevel({ roomId, level }) {
        levels.set(roomId, level);
        return { ok: true, level };
      }
    }
  });
  registerNotificationRoutes(
    app,
    fake<ApiContext>({ resolveSession: async () => (signedIn ? { user: storedUser({ id: 'user-1' }) } : null) }),
    { notifications, enabled: () => enabled }
  );
  return app;
}

test('the inbox sends every time as epoch milliseconds and never caches', async (t) => {
  const app = inboxApp(t);
  const response = await app.inject({ method: 'GET', url: '/api/notifications/inbox?limit=10' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  const page = response.json<InboxPage>();
  assert.deepEqual(
    page.notifications.map((item) => [item.id, item.createdAt, item.retractedAt, item.body]),
    [
      ['n-1', CREATED.getTime(), null, 'hello @alice'],
      ['n-2', CREATED.getTime(), READ.getTime(), '']
    ]
  );
  assert.equal(page.firstUnread?.createdAt, CREATED.getTime());
  assert.deepEqual([page.unreadCount, page.revision, page.pageInfo.hasMore], [2, 3, false]);
});

test('marking one read answers the public item, not the stored row', async (t) => {
  const app = inboxApp(t);
  const read = await app.inject({ method: 'POST', url: '/api/notifications/inbox/n-1/read' });
  assert.equal(read.statusCode, 200);
  const { notification, unreadCount, revision } = read.json<InboxItemRead>();
  assert.deepEqual([notification.readAt, notification.revision, unreadCount, revision], [READ.getTime(), 4, 2, 3]);
  assert.equal('recipientUserId' in notification || 'cursorTuple' in notification, false);

  const missing = await app.inject({ method: 'POST', url: '/api/notifications/inbox/n-9/read' });
  assert.deepEqual([missing.statusCode, missing.json<Failure>().code], [404, 'not_found']);

  const all = await app.inject({ method: 'POST', url: '/api/notifications/inbox/read-all', payload: {} });
  assert.deepEqual(all.json(), { ok: true, updated: 2, unreadCount: 2, revision: 5 });
});

test('room levels round-trip and an unknown level is refused with its code', async (t) => {
  const app = inboxApp(t);
  const url = '/api/notifications/room/room-1/level';
  assert.deepEqual((await app.inject({ method: 'GET', url })).json(), { ok: true, level: 'mentions' });
  const set = await app.inject({ method: 'PUT', url, payload: { level: 'all' } });
  assert.deepEqual(set.json(), { ok: true, level: 'all' });
  assert.deepEqual((await app.inject({ method: 'GET', url })).json(), { ok: true, level: 'all' });
  const bad = await app.inject({ method: 'PUT', url, payload: { level: 'loud' } });
  assert.deepEqual([bad.statusCode, bad.json<Failure>().code], [400, 'invalid_level']);
});

test('the inbox needs its feature and a session', async (t) => {
  const off = await inboxApp(t, { enabled: false }).inject({ method: 'GET', url: '/api/notifications/inbox' });
  assert.equal(off.statusCode, 404);
  const anonymous = inboxApp(t, { signedIn: false });
  for (const [method, url] of [
    ['GET', '/api/notifications/inbox'],
    ['GET', '/api/notifications/inbox/unread-count'],
    ['POST', '/api/notifications/inbox/n-1/read'],
    ['GET', '/api/notifications/inbox/resync'],
    ['GET', '/api/notifications/room/room-1/level']
  ] as const) {
    assert.equal((await anonymous.inject({ method, url })).statusCode, 401, url);
  }
});
