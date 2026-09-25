// Branch-by-branch proofs for friends, requests, blocks and ringing
// (domains/social): the service on a fake friend store and the routes on a
// bare Fastify app. The ws and friends HTTP suites cover the database.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fastify, { type FastifyInstance } from 'fastify';

import { createFriendsService, type FriendStore, type FriendsService } from '../src/domains/social/friends.service.ts';
import { registerFriendsRoutes } from '../src/domains/social/friends.routes.ts';
import { isActiveAccount, notificationActor } from '../src/domains/social/social-views.ts';
import type { ApiContext } from '../src/app/context.ts';
import { registerHttpKit } from '../src/platform/http/http-kit.ts';
import { fake, publicUser, storedUser, storedDirectMessage } from './fakes/index.ts';

const ME = storedUser({ id: 'user-1', login: 'alice', displayName: 'Alice' });
const FRIEND_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

test('social views: the notification actor and active accounts', () => {
  assert.equal(notificationActor(null), null);
  const actor = notificationActor(
    storedUser({ id: 'u', login: 'bob', displayName: 'Bob', passwordHash: 'secret', desktopAppSeenAt: 10 })
  );
  assert.ok(actor);
  assert.equal(actor.id, 'u');
  assert.equal('passwordHash' in actor, false);
  assert.equal('hasUsedDesktopApp' in actor, false, 'self-only fields stay private');
  assert.equal(isActiveAccount(null), false);
  assert.equal(isActiveAccount(storedUser({ id: 'u' })), true);
  assert.equal(isActiveAccount(storedUser({ id: 'u', deletionRequestedAt: 1 })), false);
  assert.equal(isActiveAccount(storedUser({ id: 'u', deletedAt: 1 })), false);
});

type HarnessOptions = {
  deletedTarget?: boolean;
  noRoom?: boolean;
  roomName?: string;
  rate?: { allowed: boolean; retryAfterSeconds?: number };
};

function harness(store: Partial<FriendStore> = {}, options: HarnessOptions = {}) {
  const calls = {
    events: [] as unknown[][],
    pushes: [] as unknown[][],
    dms: [] as Array<{ body: string; metadata: Record<string, unknown> }>
  };
  const friends: FriendStore = {
    async listFriends() {
      return [
        { user: publicUser('f1'), friendsSince: null, unreadCount: 2, lastMessage: null },
        {
          user: publicUser('f2'),
          friendsSince: 5,
          unreadCount: 0,
          lastMessage: { id: 'm', body: 'hi', createdAt: 4, fromMe: false }
        }
      ];
    },
    async countIncomingRequests() {
      return 3;
    },
    async searchUsers() {
      return ['f1', 'out', 'in', 'none'].map((id) => publicUser(id));
    },
    async getFriendIds() {
      return ['f1'];
    },
    async listRequests() {
      return {
        incoming: [{ id: 'r-in', createdAt: 1, mutualFriends: 0, user: publicUser('in') }],
        outgoing: [{ id: 'r-out', createdAt: 1, user: publicUser('out') }]
      };
    },
    async sendRequest() {
      return { status: 'sent', user: publicUser('u2'), requestId: 'r1' };
    },
    async respondRequest({ action }) {
      return action === 'accept'
        ? { status: 'accepted', requesterId: 'u2', user: publicUser('u2') }
        : { status: 'declined', requesterId: 'u2' };
    },
    async cancelRequest() {
      return { status: 'cancelled', addresseeId: 'u2' };
    },
    async removeFriend() {
      return { status: 'removed' };
    },
    async listBlockedUserIds() {
      return ['b1'];
    },
    async listBlockedUsers() {
      return [publicUser('b1')];
    },
    async blockUser() {
      return { status: 'blocked', unfriended: true };
    },
    async unblockUser() {
      return { status: 'unblocked' };
    },
    async areFriends() {
      return true;
    },
    async isBlockedBetween() {
      return false;
    },
    ...store
  };
  const service = createFriendsService({
    friends: () => friends,
    findUser: async (userId) => storedUser({ id: userId, deletedAt: options.deletedTarget ? 1 : null }),
    findRoom: async (roomId) => (options.noRoom ? null : { id: roomId, name: options.roomName ?? 'Team' }),
    sendDirectMessage: async (input) => {
      calls.dms.push(input);
      return storedDirectMessage('dm-1');
    },
    isOnline: (userId) => userId === 'f1',
    notifyUser: (userId, event) => calls.events.push([userId, event.type]),
    queuePush: async (userId, payload, context) => {
      calls.pushes.push([userId, payload.type, payload.title, context]);
    },
    ringLimiter: { check: () => options.rate || { allowed: true } },
    ringTtlMs: 1000,
    now: () => 50
  });
  return { calls, service };
}

test('lists, search relationships and requests', async () => {
  const { service } = harness();
  assert.deepEqual(await service.list('user-1'), {
    friends: [
      { user: publicUser('f1'), friendsSince: null, online: true, unreadCount: 2, lastMessage: null },
      {
        user: publicUser('f2'),
        friendsSince: 5,
        online: false,
        unreadCount: 0,
        lastMessage: { id: 'm', body: 'hi', createdAt: 4, fromMe: false }
      }
    ],
    incomingRequestCount: 3
  });
  assert.deepEqual(
    (await service.search('user-1', 'q')).map((row) => row.relationship),
    ['friend', 'outgoing', 'incoming', 'none']
  );
  assert.equal((await service.requests('user-1')).incoming.length, 1);
  assert.deepEqual(await service.blocked('user-1'), { blocked: ['b1'], users: [publicUser('b1')] });
});

test('sending a request notifies the addressee; a crossing request accepts', async () => {
  const sent = harness();
  assert.deepEqual(await sent.service.sendRequest(ME, { userId: '', login: 'bob' }), {
    status: 'sent',
    user: publicUser('u2')
  });
  assert.deepEqual(sent.calls.events, [
    ['u2', 'friend-request'],
    ['u2', 'notification.friend.request']
  ]);
  assert.deepEqual(
    sent.calls.pushes.map((p) => p.slice(0, 3)),
    [['u2', 'friend.request', 'Новая заявка в друзья']]
  );

  const crossing = harness({
    async sendRequest() {
      return { status: 'accepted', user: publicUser('u2') };
    }
  });
  assert.equal((await crossing.service.sendRequest(ME, { userId: 'x', login: '' })).status, 'accepted');
  assert.deepEqual(crossing.calls.events, [
    ['u2', 'friend-accepted'],
    ['u2', 'notification.friend.accepted']
  ]);
  assert.equal(crossing.calls.pushes[0]?.[2], 'Заявка принята');

  for (const status of ['not_found', 'self', 'blocked'] as const) {
    assert.deepEqual(
      await harness({
        async sendRequest() {
          return { status };
        }
      }).service.sendRequest(ME, { userId: 'x', login: '' }),
      { status }
    );
  }
  for (const status of ['already_friends', 'already_sent'] as const) {
    const quiet = harness({
      async sendRequest() {
        return { status, user: publicUser('u2') };
      }
    });
    assert.deepEqual(await quiet.service.sendRequest(ME, { userId: 'x', login: '' }), {
      status,
      user: publicUser('u2')
    });
    assert.deepEqual(quiet.calls.events, []);
  }
});

test('responding, cancelling, removing, blocking and unblocking', async () => {
  const { calls, service } = harness();
  assert.equal((await service.respond(ME, 'r1', 'accept')).status, 'accepted');
  assert.deepEqual(calls.events.at(-1), ['u2', 'notification.friend.accepted']);
  assert.equal((await service.respond(ME, 'r1', 'decline')).status, 'declined');
  assert.equal(
    (
      await harness({
        async respondRequest() {
          return { status: 'not_found' };
        }
      }).service.respond(ME, 'r', 'accept')
    ).status,
    'not_found'
  );
  assert.equal(
    (
      await harness({
        async respondRequest() {
          return { status: 'blocked', requesterId: 'u2' };
        }
      }).service.respond(ME, 'r', 'accept')
    ).status,
    'blocked'
  );

  assert.equal((await service.cancel('user-1', 'r1')).status, 'cancelled');
  assert.deepEqual(calls.events.at(-1), ['u2', 'friend-request']);
  assert.equal(
    (
      await harness({
        async cancelRequest() {
          return { status: 'not_found' };
        }
      }).service.cancel('u', 'r')
    ).status,
    'not_found'
  );

  assert.equal((await service.remove('user-1', 'f1')).status, 'removed');
  assert.deepEqual(calls.events.at(-1), ['f1', 'friend-removed']);
  assert.equal(
    (
      await harness({
        async removeFriend() {
          return { status: 'not_found' };
        }
      }).service.remove('u', 'f')
    ).status,
    'not_found'
  );

  assert.deepEqual(await service.block('user-1', 'f1'), { status: 'applied', result: 'blocked' });
  assert.deepEqual(calls.events.at(-1), ['f1', 'friend-removed']);
  const stranger = harness({
    async blockUser() {
      return { status: 'blocked', unfriended: false };
    }
  });
  await stranger.service.block('user-1', 's');
  assert.deepEqual(stranger.calls.events, []);
  assert.equal(
    (
      await harness({
        async blockUser() {
          return { status: 'not_found' };
        }
      }).service.block('u', 't')
    ).status,
    'not_found'
  );
  assert.equal(
    (
      await harness({
        async blockUser() {
          return { status: 'invalid' };
        }
      }).service.block('u', 't')
    ).status,
    'invalid'
  );

  assert.equal((await service.unblock('user-1', 'b1')).status, 'unblocked');
  assert.equal(
    (
      await harness({
        async unblockUser() {
          return { status: 'not_found' };
        }
      }).service.unblock('u', 'b')
    ).status,
    'not_found'
  );
});

test('ringing refuses strangers, blocks, deleted accounts, cooldowns and missing rooms', async () => {
  assert.equal(
    (
      await harness({
        async areFriends() {
          return false;
        }
      }).service.ring(ME, 'room-1', 'f1')
    ).status,
    'not_friends'
  );
  assert.equal(
    (
      await harness({
        async isBlockedBetween() {
          return true;
        }
      }).service.ring(ME, 'room-1', 'f1')
    ).status,
    'blocked'
  );
  assert.equal((await harness({}, { deletedTarget: true }).service.ring(ME, 'room-1', 'f1')).status, 'account_deleted');
  assert.deepEqual(
    await harness({}, { rate: { allowed: false, retryAfterSeconds: 9 } }).service.ring(ME, 'room-1', 'f1'),
    { status: 'rate_limited', retryAfterSeconds: 9 }
  );
  assert.deepEqual(await harness({}, { rate: { allowed: false } }).service.ring(ME, 'room-1', 'f1'), {
    status: 'rate_limited',
    retryAfterSeconds: 0
  });
  assert.equal((await harness({}, { noRoom: true }).service.ring(ME, 'room-1', 'f1')).status, 'room_not_found');
});

test('a ring notifies, files a room invitation DM for both sides and pushes until it expires', async () => {
  const { calls, service } = harness();
  assert.equal((await service.ring(ME, 'room-1', 'f1')).status, 'rung');
  assert.deepEqual(calls.events, [
    ['f1', 'ring.incoming'],
    ['f1', 'dm-message'],
    ['user-1', 'dm-message']
  ]);
  assert.equal(calls.dms[0]?.body, 'Приглашение в комнату «Team»');
  assert.equal(calls.dms[0].metadata.kind, 'room-invite');
  assert.deepEqual(calls.pushes[0]?.slice(0, 3), ['f1', 'ring', 'Alice зовёт вас']);
  assert.deepEqual(calls.pushes[0][3], { expiresAt: 1050 });

  const unnamed = harness({}, { roomName: '' });
  await unnamed.service.ring(storedUser({ login: '' }), 'room-1', 'f1');
  assert.equal(unnamed.calls.dms[0]?.body, 'Приглашение в комнату');
  assert.equal(unnamed.calls.pushes[0]?.[2], 'Друг зовёт вас');
});

// --- routes ---------------------------------------------------------------------

function routeApp(
  t: TestContext,
  outcomes: Record<string, unknown> = {},
  { signedIn = true, limited = false }: { signedIn?: boolean; limited?: boolean } = {}
) {
  const app = fastify();
  registerHttpKit(app, { securityHeaders: () => ({}), recordRequest() {}, logRequest() {}, logHandlerFailure() {} });
  const seen: Record<string, unknown[]> = {};
  const record =
    (name: string, value: unknown) =>
    async (...args: unknown[]) => {
      seen[name] = args;
      return outcomes[name] ?? value;
    };
  registerFriendsRoutes(
    app,
    {
      logger: fake<ApiContext['logger']>(),
      clientIp: () => 'ip',
      resolveSession: async () => (signedIn ? { user: ME } : null),
      hashIp: (ip: string) => ip
    },
    {
      friends: fake<FriendsService>({
        list: record('list', { friends: [], incomingRequestCount: 0 }),
        search: record('search', []),
        requests: record('requests', { incoming: [], outgoing: [] }),
        sendRequest: record('sendRequest', { status: 'sent', user: publicUser('u2') }),
        respond: record('respond', { status: 'accepted', user: publicUser('u2') }),
        cancel: record('cancel', { status: 'cancelled' }),
        remove: record('remove', { status: 'removed' }),
        blocked: record('blocked', { blocked: [], users: [] }),
        block: record('block', { status: 'applied', result: 'blocked' }),
        unblock: record('unblock', { status: 'unblocked' }),
        ring: record('ring', { status: 'rung' })
      } as Partial<Record<keyof FriendsService, unknown>> as Partial<FriendsService>),
      requestLimiter: { check: () => (limited ? { allowed: false, retryAfterSeconds: 6 } : { allowed: true }) }
    }
  );
  t.after(() => app.close());
  return { app, seen };
}

type Body = { ok?: boolean; error?: string } & Record<string, unknown>;

async function call(app: FastifyInstance, method: string, url: string, payload?: object) {
  const response = await app.inject({
    method: method as 'GET' | 'PUT' | 'POST' | 'DELETE',
    url,
    ...(payload === undefined ? {} : { payload })
  });
  return { status: response.statusCode, body: response.json<Body>(), retryAfter: response.headers['retry-after'] };
}

const ROUTES: Array<[string, string, object?]> = [
  ['GET', '/api/friends'],
  ['GET', '/api/friends/search?q=bo'],
  ['GET', '/api/friends/requests'],
  ['POST', '/api/friends/requests', { login: 'Bob' }],
  ['POST', `/api/friends/requests/${REQUEST_ID}/accept`],
  ['POST', `/api/friends/requests/${REQUEST_ID}/decline`],
  ['DELETE', `/api/friends/requests/${REQUEST_ID}`],
  ['GET', '/api/blocks'],
  ['PUT', `/api/blocks/${FRIEND_ID}`],
  ['DELETE', `/api/blocks/${FRIEND_ID}`],
  ['DELETE', `/api/friends/${FRIEND_ID}`],
  ['POST', '/api/rooms/room-1/ring', { userId: FRIEND_ID }]
];

test('every social route needs a session and answers it', async (t) => {
  const anonymous = routeApp(t, {}, { signedIn: false }).app;
  const { app, seen } = routeApp(t);
  for (const [method, url, payload] of ROUTES) {
    assert.deepEqual((await call(anonymous, method, url, payload)).status, 401, url);
    const answered = await call(app, method, url, payload);
    assert.ok(answered.status === 200 || answered.status === 201, url);
    assert.equal(answered.body.ok, true, url);
  }
  assert.deepEqual(seen.search, ['user-1', 'bo']);
  assert.deepEqual(seen.sendRequest?.[1], { userId: '', login: 'bob' });
  assert.deepEqual(seen.ring?.slice(1), ['room-1', FRIEND_ID]);
  assert.equal((await call(app, 'GET', '/api/friends/search')).status, 200);
  assert.deepEqual(seen.search, ['user-1', '']);
  assert.deepEqual((await call(app, 'POST', `/api/friends/requests/${REQUEST_ID}/decline`, undefined)).body, {
    ok: true,
    status: 'accepted',
    user: publicUser('u2')
  });
});

test('social refusals keep their texts and codes', async (t) => {
  const cases: Array<[string, string, object | undefined, Record<string, unknown>, number, string]> = [
    ['POST', '/api/friends/requests', {}, {}, 400, 'Неверный пользователь'],
    [
      'POST',
      '/api/friends/requests',
      { userId: FRIEND_ID },
      { sendRequest: { status: 'not_found' } },
      404,
      'Пользователь не найден'
    ],
    [
      'POST',
      '/api/friends/requests',
      { userId: FRIEND_ID },
      { sendRequest: { status: 'self' } },
      400,
      'Нельзя добавить себя'
    ],
    [
      'POST',
      '/api/friends/requests',
      { userId: FRIEND_ID },
      { sendRequest: { status: 'blocked' } },
      403,
      'Заявку отправить нельзя'
    ],
    ['POST', '/api/friends/requests/bad/accept', undefined, {}, 404, 'Заявка не найдена'],
    [
      'POST',
      `/api/friends/requests/${REQUEST_ID}/accept`,
      undefined,
      { respond: { status: 'not_found' } },
      404,
      'Заявка не найдена'
    ],
    [
      'POST',
      `/api/friends/requests/${REQUEST_ID}/accept`,
      undefined,
      { respond: { status: 'blocked' } },
      409,
      'Заявка больше недоступна'
    ],
    ['DELETE', '/api/friends/requests/bad', undefined, {}, 404, 'Заявка не найдена'],
    [
      'DELETE',
      `/api/friends/requests/${REQUEST_ID}`,
      undefined,
      { cancel: { status: 'not_found' } },
      404,
      'Заявка не найдена'
    ],
    ['PUT', '/api/blocks/bad', undefined, {}, 400, 'Нельзя заблокировать этого пользователя'],
    ['PUT', `/api/blocks/${FRIEND_ID}`, undefined, { block: { status: 'not_found' } }, 404, 'Пользователь не найден'],
    [
      'PUT',
      `/api/blocks/${FRIEND_ID}`,
      undefined,
      { block: { status: 'invalid' } },
      400,
      'Нельзя заблокировать этого пользователя'
    ],
    ['DELETE', '/api/blocks/bad', undefined, {}, 404, 'Пользователь не найден'],
    [
      'DELETE',
      `/api/blocks/${FRIEND_ID}`,
      undefined,
      { unblock: { status: 'not_found' } },
      404,
      'Пользователь не заблокирован'
    ],
    ['DELETE', '/api/friends/bad', undefined, {}, 404, 'Друг не найден'],
    ['DELETE', `/api/friends/${FRIEND_ID}`, undefined, { remove: { status: 'not_found' } }, 404, 'Друг не найден'],
    ['POST', '/api/rooms/room-1/ring', {}, {}, 400, 'Invalid ring target'],
    [
      'POST',
      '/api/rooms/room-1/ring',
      { userId: FRIEND_ID },
      { ring: { status: 'not_friends' } },
      403,
      'You are not friends'
    ],
    [
      'POST',
      '/api/rooms/room-1/ring',
      { userId: FRIEND_ID },
      { ring: { status: 'blocked' } },
      403,
      'Invite is unavailable'
    ],
    [
      'POST',
      '/api/rooms/room-1/ring',
      { userId: FRIEND_ID },
      { ring: { status: 'account_deleted' } },
      403,
      'Invite is unavailable'
    ],
    [
      'POST',
      '/api/rooms/room-1/ring',
      { userId: FRIEND_ID },
      { ring: { status: 'room_not_found' } },
      404,
      'Room not found'
    ]
  ];
  for (const [method, url, payload, outcomes, status, error] of cases) {
    const response = await call(routeApp(t, outcomes).app, method, url, payload);
    assert.deepEqual(
      [response.status, response.body.error],
      [status, error],
      `${method} ${url} ${JSON.stringify(outcomes)}`
    );
  }
  const selfBlock = await call(routeApp(t).app, 'PUT', '/api/blocks/user-1');
  assert.equal(selfBlock.status, 400);
  const quiet = await call(
    routeApp(t, { sendRequest: { status: 'already_sent', user: publicUser('u2') } }).app,
    'POST',
    '/api/friends/requests',
    { userId: FRIEND_ID }
  );
  assert.deepEqual([quiet.status, quiet.body], [200, { ok: true, status: 'already_sent', user: publicUser('u2') }]);
  const declined = await call(
    routeApp(t, { respond: { status: 'declined' } }).app,
    'POST',
    `/api/friends/requests/${REQUEST_ID}/decline`
  );
  assert.deepEqual(declined.body, { ok: true, status: 'declined' });
  const cooldown = await call(
    routeApp(t, { ring: { status: 'rate_limited', retryAfterSeconds: 4 } }).app,
    'POST',
    '/api/rooms/room-1/ring',
    { userId: FRIEND_ID }
  );
  assert.deepEqual(
    [cooldown.status, cooldown.retryAfter, cooldown.body],
    [429, '4', { ok: false, error: 'Invite cooldown', code: 'invite_cooldown', retryAfterSeconds: 4 }]
  );
  const tooMany = await call(routeApp(t, {}, { limited: true }).app, 'POST', '/api/friends/requests', {
    userId: FRIEND_ID
  });
  assert.deepEqual([tooMany.status, tooMany.retryAfter, tooMany.body.retryAfterSeconds], [429, '6', 6]);
});
