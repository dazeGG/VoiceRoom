// The moderation centre over HTTP on a bare Fastify app: every outcome of
// the moderation services maps to its answer, and the feature flag and the
// session guard every route.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fastify from 'fastify';

import type { ApiContext } from '../src/app/context.ts';
import type { MessageModerationService } from '../src/domains/moderation/message-moderation.service.ts';
import type { ModerationService } from '../src/domains/moderation/moderation.service.ts';
import { registerModerationRoutes } from '../src/domains/moderation/moderation.routes.ts';
import { registerHttpKit } from '../src/platform/http/http-kit.ts';
import { fake, storedUser } from './fakes/index.ts';

const BAN = {
  id: 'ban-1',
  roomId: 'room-1',
  subject: { kind: 'guest' as const, userId: null },
  reason: 'spam',
  createdAt: 1,
  updatedAt: 2,
  expiresAt: null
};
const PAGE = { contractVersion: 1 as const, roomId: 'room-1', bans: [BAN], pageInfo: { hasMore: false } };

type Outcomes = {
  list?: Awaited<ReturnType<ModerationService['listActive']>> | 'bad-cursor';
  put?: Awaited<ReturnType<ModerationService['putBan']>>;
  unban?: Awaited<ReturnType<ModerationService['unban']>>;
  remove?: Awaited<ReturnType<MessageModerationService['deleteRoomMessage']>>;
};

function moderationApp(
  t: TestContext,
  outcomes: Outcomes = {},
  { enabled = true, signedIn = true }: { enabled?: boolean; signedIn?: boolean } = {}
) {
  const app = fastify();
  t.after(() => app.close());
  registerHttpKit(app, { securityHeaders: () => ({}), recordRequest() {}, logRequest() {}, logHandlerFailure() {} });
  const seen: Record<string, unknown> = {};
  registerModerationRoutes(
    app,
    fake<ApiContext>({ resolveSession: async () => (signedIn ? { user: storedUser({ id: 'owner-1' }) } : null) }),
    {
      moderation: {
        async listActive(input) {
          seen.list = input;
          if (outcomes.list === 'bad-cursor') throw Object.assign(new Error('bad'), { code: 'invalid_cursor' });
          return outcomes.list ?? { status: 'ok', envelope: PAGE };
        },
        async putBan(input) {
          seen.put = input;
          return outcomes.put ?? { status: 'created', ban: BAN };
        },
        async unban(input) {
          seen.unban = input;
          return outcomes.unban ?? { status: 'unbanned', ban: BAN };
        }
      },
      messages: {
        async deleteRoomMessage(input) {
          seen.remove = input;
          return (
            outcomes.remove ?? {
              status: 'deleted',
              deletion: { roomId: 'room-1', messageId: 'm-1', deletedAt: 9 }
            }
          );
        }
      },
      enabled: () => enabled
    }
  );
  const call = async (method: 'GET' | 'PUT' | 'DELETE', url: string, payload?: object, headers = {}) => {
    const response = await app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: response.json<Record<string, unknown>>() };
  };
  return { call, seen };
}

const BANS = '/api/rooms/room-1/moderation/bans';

test('the owner lists, saves and lifts bans', async (t) => {
  const { call, seen } = moderationApp(t);
  assert.deepEqual(await call('GET', `${BANS}?cursor=c&limit=10`), { status: 200, body: PAGE });
  const listed = seen.list as { roomId: string; actorUserId: string; query: object };
  assert.deepEqual(
    [listed.roomId, listed.actorUserId, { ...listed.query }],
    ['room-1', 'owner-1', { cursor: 'c', limit: '10' }]
  );

  const created = await call(
    'PUT',
    BANS,
    { guestIp: '203.0.113.9', duration: '1d', reason: 'spam' },
    {
      'idempotency-key': 'key-1'
    }
  );
  assert.deepEqual(created, { status: 201, body: { contractVersion: 1, status: 'created', ban: BAN } });
  assert.deepEqual(seen.put, {
    roomId: 'room-1',
    actorUserId: 'owner-1',
    input: { guestIp: '203.0.113.9', duration: '1d', reason: 'spam' },
    idempotencyKey: 'key-1'
  });
  const replayed = moderationApp(t, { put: { status: 'replayed', ban: BAN } });
  assert.equal((await replayed.call('PUT', BANS, {})).status, 200);

  assert.deepEqual(await call('DELETE', `${BANS}/ban-1`), {
    status: 200,
    body: { contractVersion: 1, status: 'unbanned', ban: BAN }
  });
  assert.deepEqual(seen.unban, { roomId: 'room-1', actorUserId: 'owner-1', banId: 'ban-1' });
});

test('the owner deletes any message in the room', async (t) => {
  const { call, seen } = moderationApp(t);
  assert.deepEqual(await call('DELETE', '/api/rooms/room-1/moderation/messages/m-1'), {
    status: 200,
    body: { contractVersion: 1, status: 'deleted', deletion: { roomId: 'room-1', messageId: 'm-1', deletedAt: 9 } }
  });
  assert.deepEqual(seen.remove, { roomId: 'room-1', messageId: 'm-1', actorUserId: 'owner-1' });
});

const CODES: Record<string, string> = {
  'Owner access required': 'owner_required',
  'Invalid cursor': 'invalid_cursor',
  'Invalid ban request': 'invalid_request',
  'Active ban limit reached': 'room_ban_limit',
  'Credential revocation unavailable': 'credential_revoke_unavailable',
  'Invalid unban request': 'invalid_request',
  'Ban not found': 'ban_not_found',
  'Invalid message deletion': 'invalid_request',
  'Message not found': 'message_not_found'
};

test('every refusal keeps its status, text and code', async (t) => {
  const cases: Array<[Outcomes, 'GET' | 'PUT' | 'DELETE', string, number, string]> = [
    [{ list: { status: 'forbidden', envelope: null } }, 'GET', BANS, 403, 'Owner access required'],
    [{ list: 'bad-cursor' }, 'GET', BANS, 400, 'Invalid cursor'],
    [{ put: { status: 'invalid', ban: null } }, 'PUT', BANS, 400, 'Invalid ban request'],
    [{ put: { status: 'forbidden', ban: null } }, 'PUT', BANS, 403, 'Owner access required'],
    [{ put: { status: 'cap_exceeded', ban: null } }, 'PUT', BANS, 409, 'Active ban limit reached'],
    [{ put: { status: 'revocation_unavailable', ban: null } }, 'PUT', BANS, 503, 'Credential revocation unavailable'],
    [{ unban: { status: 'invalid', ban: null } }, 'DELETE', `${BANS}/b`, 400, 'Invalid unban request'],
    [{ unban: { status: 'forbidden', ban: null } }, 'DELETE', `${BANS}/b`, 403, 'Owner access required'],
    [{ unban: { status: 'not_found', ban: null } }, 'DELETE', `${BANS}/b`, 404, 'Ban not found'],
    [
      { remove: { status: 'invalid', deletion: null } },
      'DELETE',
      '/api/rooms/room-1/moderation/messages/m',
      400,
      'Invalid message deletion'
    ],
    [
      { remove: { status: 'forbidden', deletion: null } },
      'DELETE',
      '/api/rooms/room-1/moderation/messages/m',
      403,
      'Owner access required'
    ],
    [
      { remove: { status: 'not_found', deletion: null } },
      'DELETE',
      '/api/rooms/room-1/moderation/messages/m',
      404,
      'Message not found'
    ]
  ];
  for (const [outcomes, method, url, status, error] of cases) {
    const answer = await moderationApp(t, outcomes).call(method, url, method === 'PUT' ? {} : undefined);
    assert.deepEqual(answer, { status, body: { ok: false, error, code: CODES[error] } }, `${method} ${url} ${status}`);
  }
});

test('a signed-out caller and a disabled moderation centre are refused on every route', async (t) => {
  for (const [method, url] of [
    ['GET', BANS],
    ['PUT', BANS],
    ['DELETE', `${BANS}/b`],
    ['DELETE', '/api/rooms/room-1/moderation/messages/m']
  ] as const) {
    const payload = method === 'PUT' ? {} : undefined;
    assert.equal((await moderationApp(t, {}, { signedIn: false }).call(method, url, payload)).status, 401, url);
    assert.equal((await moderationApp(t, {}, { enabled: false }).call(method, url, payload)).status, 404, url);
  }
});
