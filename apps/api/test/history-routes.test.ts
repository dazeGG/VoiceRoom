// Room and DM history over HTTP on a bare Fastify app, with the real history
// services on fake repositories so the pages that go out match the contract.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fastify from 'fastify';

import type { ApiContext } from '../src/app/context.ts';
import {
  createDmHistoryService,
  DmHistoryError,
  type DmHistoryRepository
} from '../src/domains/messaging/dm-history.service.ts';
import { registerHistoryRoutes, type HistoryRoutesDeps } from '../src/domains/messaging/history.routes.ts';
import { createRoomHistoryService, type RoomHistoryRepository } from '../src/domains/messaging/room-history.service.ts';
import { createCursorCodec } from '../src/platform/cursor-codec.ts';
import { registerHttpKit } from '../src/platform/http/http-kit.ts';
import { fake, storedUser } from './fakes/index.ts';

const codec = createCursorCodec({ keys: ['h'.repeat(32)] });
const PREVIEW = { url: 'https://example.com/', title: 'Example', description: '', siteName: '', image: null };

const rooms = createRoomHistoryService({
  cursorCodec: codec,
  repository: fake<RoomHistoryRepository>({
    roomExists: async (roomId) => roomId === 'room-1',
    listLatest: async () => ({
      messages: [
        {
          id: 'm1',
          roomId: 'room-1',
          peerId: 'p1',
          authorUserId: 'user-1',
          name: 'Anna',
          text: 'hello',
          createdAt: '2026-01-01T00:00:00.000Z',
          createdAtMicros: '1',
          editedAt: null,
          expiresAt: null,
          avatarColorKey: 'blurple',
          avatarKey: null,
          avatarAccent: null,
          linkPreview: PREVIEW
        }
      ],
      hasMoreBefore: false,
      hasMoreAfter: false
    })
  })
});

const directs = createDmHistoryService({
  cursorCodec: codec,
  repository: fake<DmHistoryRepository>({
    canReadThread: async ({ peerId }) => peerId === 'friend',
    listLatest: async () => ({
      messages: [
        {
          id: 'd1',
          senderId: 'friend',
          recipientId: 'user-1',
          body: 'hi',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          createdAtMicros: '2',
          metadata: { kind: 'room-invite', roomId: 'room-1', roomName: 'Room', status: 'pending', secret: 'x' }
        }
      ],
      hasMoreBefore: false,
      hasMoreAfter: false
    })
  })
});

function historyApp(t: TestContext, overrides: Partial<HistoryRoutesDeps> = {}, { signedIn = true } = {}) {
  const app = fastify({ logger: false });
  t.after(() => app.close());
  registerHttpKit(app, { securityHeaders: () => ({}), recordRequest() {}, logRequest() {}, logHandlerFailure() {} });
  registerHistoryRoutes(
    app,
    fake<ApiContext>({ resolveSession: async () => (signedIn ? { user: storedUser() } : null) }),
    { rooms, directs, canReadRoom: async (roomId) => roomId === 'room-1', ...overrides }
  );
  return async (url: string) => {
    const response = await app.inject({ method: 'GET', url });
    return { status: response.statusCode, body: response.json<Record<string, unknown>>() };
  };
}

test('a room history page goes out whole, link previews and epoch times included', async (t) => {
  const answer = await historyApp(t)('/api/rooms/room-1/chat/history?mode=latest&limit=20');
  assert.equal(answer.status, 200);
  const [message] = answer.body.messages as Array<Record<string, unknown>>;
  assert.ok(message);
  assert.deepEqual(message.linkPreview, PREVIEW);
  assert.equal(message.createdAt, Date.parse('2026-01-01T00:00:00.000Z'));
  assert.deepEqual(message.author, {
    userId: 'user-1',
    peerId: 'p1',
    name: 'Anna',
    avatarColorKey: 'blurple',
    avatarUrl: null,
    avatarAccent: null
  });
  assert.equal(typeof message.readCursor, 'string');
});

test('a DM history page carries only the public metadata', async (t) => {
  const answer = await historyApp(t)('/api/dm/friend/history');
  assert.equal(answer.status, 200);
  const [message] = answer.body.messages as Array<Record<string, unknown>>;
  assert.ok(message);
  assert.deepEqual(message.metadata, { kind: 'room-invite', roomId: 'room-1', roomName: 'Room', status: 'pending' });
  assert.deepEqual(message.content, { type: 'text', text: 'hi' });
});

test('history refusals keep their status and code; a server failure stays private', async (t) => {
  assert.deepEqual(await historyApp(t, {}, { signedIn: false })('/api/rooms/room-1/chat/history'), {
    status: 401,
    body: { ok: false, error: 'Room is not available', code: 'room_forbidden' }
  });
  assert.equal((await historyApp(t)('/api/rooms/room-2/chat/history')).status, 403);
  assert.deepEqual(await historyApp(t)('/api/rooms/room-1/chat/history?mode=before'), {
    status: 400,
    body: { ok: false, error: 'Invalid history cursor', code: 'invalid_cursor' }
  });

  assert.deepEqual(await historyApp(t, {}, { signedIn: false })('/api/dm/friend/history'), {
    status: 401,
    body: {
      ok: false,
      error: 'Authentication required',
      code: 'authentication_required'
    }
  });
  assert.equal((await historyApp(t)('/api/dm/stranger/history')).status, 403);

  const broken = historyApp(t, {
    directs: {
      getPage: async () => {
        throw new Error('database down');
      }
    }
  });
  assert.deepEqual(await broken('/api/dm/friend/history'), {
    status: 500,
    body: { ok: false, error: 'Internal server error', code: 'history_error' }
  });
  const refused = historyApp(t, {
    directs: {
      getPage: async () => {
        throw new DmHistoryError('thread_not_found', 404, 'Thread not found');
      }
    }
  });
  assert.deepEqual(await refused('/api/dm/friend/history'), {
    status: 404,
    body: { ok: false, error: 'Thread not found', code: 'thread_not_found' }
  });
});
