// Branch-by-branch proofs for direct messages (domains/messaging/direct-*):
// the service on fake stores and the routes on a bare Fastify app. The dm
// HTTP and realtime suites cover the database.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fastify, { type FastifyInstance } from 'fastify';

import {
  cleanDmText,
  createDirectMessagesService,
  type DirectMessage,
  type DirectMessageStore,
  type DirectMessagesDeps,
  type DirectMessagesService,
  type SendInput
} from '../src/domains/messaging/direct-messages.service.ts';
import { registerDirectMessageRoutes } from '../src/domains/messaging/direct-messages.routes.ts';
import type { ApiContext } from '../src/app/context.ts';
import { createMessageReadService, type MessageReadRepository } from '../src/domains/messaging/message-read.service.ts';
import { createCursorCodec } from '../src/platform/cursor-codec.ts';
import { registerHttpKit } from '../src/platform/http/http-kit.ts';
import type pg from 'pg';
import { fake, storedUser, directMessage, publicUser, storedDirectMessage } from './fakes/index.ts';
import { defined } from './helpers/assert-defined.ts';
import { recordingService, type Answers } from './helpers/recording-service.ts';

const ME = storedUser({ id: 'user-1', login: 'alice', displayName: 'Alice' });
const PEER = '22222222-2222-4222-8222-222222222222';
const UUID_A = '11111111-1111-4111-8111-111111111111';

test('DM text keeps lines, collapses runs and caps at 2000 characters', () => {
  assert.equal(cleanDmText('  a \t b \n\n\n c '), 'a b\n\nc');
  assert.equal(cleanDmText('x'.repeat(2100)).length, 2000);
  assert.equal(cleanDmText(null), '');
});

type HarnessOptions = {
  messages?: Record<string, DirectMessage>;
  readCount?: number;
  inviteAnswered?: boolean;
  deleteResult?: unknown;
  editResult?: null;
  delivery?: false;
  replay?: boolean;
  /** The message the replayed ledger entry holds; a stored message by default. */
  replayed?: unknown;
  readError?: Error;
  readService?: ReturnType<DirectMessagesDeps['readService']>;
  friends?: boolean;
  blocked?: boolean;
  noPeer?: boolean;
  deleted?: boolean;
  roomExists?: boolean;
  rate?: { allowed: boolean; retryAfterSeconds: number };
  media?: null;
  directEmit?: boolean;
  replyTargetGone?: boolean;
};

// The stores hand the unit-of-work callbacks a transaction marker, not a client.
const transactions = new Map<unknown, string>();
function transactionMarker(name: string) {
  const client = fake<Pick<pg.PoolClient, 'query'>>({});
  transactions.set(client, name);
  return client;
}

function harness(options: HarnessOptions = {}) {
  const calls = {
    lockedIn: '',
    events: new Array<unknown[]>(),
    recipients: new Array<string>(),
    previews: new Array<boolean>(),
    bound: new Array<unknown>(),
    outbox: new Array<unknown>(),
    completed: new Array<string>(),
    expired: new Array<unknown[]>(),
    sent: new Array<Parameters<DirectMessageStore['sendMessage']>[0]>()
  };
  const messages = options.messages || {};
  const stored = (messageId: string) => {
    const message = messages[messageId];
    assert.ok(message);
    return message;
  };
  const direct: DirectMessageStore = {
    async listThread() {
      return [
        directMessage({ id: 'm1', senderId: 'user-1', recipientId: PEER }),
        directMessage({ id: 'm2', senderId: PEER, recipientId: 'user-1', replyTo: { messageId: 'm1' } })
      ];
    },
    async markRead() {
      return { count: options.readCount ?? 1 };
    },
    async sendMessage(input) {
      calls.sent.push(input);
      if (input.beforeUnitOfWork) {
        const before = await input.beforeUnitOfWork(transactionMarker('before'));
        if (before?.replay) return { ...before.message, idempotencyReplay: true };
      }
      const inserted = directMessage({
        id: 'dm-new',
        senderId: input.senderId,
        recipientId: input.recipientId,
        body: input.body
      });
      if (input.unitOfWork) await input.unitOfWork(transactionMarker('insert'), inserted);
      return inserted;
    },
    async getMessage(_userId, _peerId, messageId) {
      return messages[messageId] || null;
    },
    async respondInvite({ messageId, status }) {
      if (options.inviteAnswered) return null;
      const message = stored(messageId);
      return {
        ...message,
        invite: { roomId: '', roomName: '', expiresAt: null, ...message.invite, status }
      };
    },
    async softDeleteMessage() {
      return options.deleteResult ?? true;
    },
    async editMessage({ messageId, body }) {
      return options.editResult === null ? null : { ...stored(messageId), body };
    }
  };
  const delivery: ReturnType<DirectMessagesDeps['delivery']> =
    options.delivery === false
      ? null
      : {
          idempotency: {
            async reserve() {
              return options.replay
                ? {
                    kind: 'replay',
                    ledgerKey: 'ledger-1',
                    response: {
                      messageId: 'old',
                      statusCode: 201,
                      body: {
                        message:
                          options.replayed ??
                          storedDirectMessage('old', {
                            senderId: 'user-1',
                            recipientId: PEER,
                            replyTo: { messageId: 'm1' }
                          })
                      }
                    }
                  }
                : { kind: 'reserved', ledgerKey: 'ledger-1' };
            },
            async complete(_client, key) {
              calls.completed.push(key);
            }
          },
          outbox: {
            async enqueue(_client, event) {
              calls.outbox.push(event.type);
            }
          }
        };
  const service = createDirectMessagesService({
    messages: () => ({ direct }),
    readService: () =>
      options.readService ?? {
        async advanceDm(input) {
          if (options.readError) throw options.readError;
          return { cursor: input.cursor, readThrough: 3 };
        }
      },
    friends: () => ({
      areFriends: async () => options.friends ?? true,
      isBlockedBetween: async () => options.blocked ?? false
    }),
    findUser: async (userId) =>
      options.noPeer
        ? null
        : storedUser({
            id: userId,
            login: 'bob',
            deletedAt: options.deleted ? 1 : null,
            passwordHash: 'x',
            desktopAppSeenAt: 10
          }),
    isDmMuted: async () => true,
    roomExists: async () => options.roomExists ?? true,
    expireRoomInvitations: async (senderId, roomId) => {
      calls.expired.push([senderId, roomId]);
    },
    limiter: { check: () => options.rate || { allowed: true, retryAfterSeconds: 0 } },
    media: () =>
      options.media === null
        ? null
        : {
            attachments: {
              async bindReady(input) {
                calls.bound.push(input.attachmentIds);
              },
              // Deleting runs on the real store; the DB suite covers it.
              async listForMessage() {
                return [];
              },
              async markDeleted() {
                return null;
              }
            },
            jobs: {
              async enqueue() {
                return null;
              }
            }
          },
    replies: () => ({
      async lockDirectTarget(input) {
        calls.lockedIn = transactions.get(input.client) ?? '';
        if (options.replyTargetGone) return null;
        return {
          id: 'm1',
          senderId: 'user-2',
          recipientId: 'user-1',
          name: 'Bob',
          body: 'target',
          createdAt: Date.now(),
          deletedAt: null,
          metadata: null,
          invite: null,
          replyTo: undefined
        };
      }
    }),
    delivery: () => delivery,
    projectMedia: async (context, message) => ({ ...message, attachments: [] }),
    projectReply: async (context, message) => (message.replyTo ? { ...message, replyPreview: QUOTE } : message),
    directEmit: options.directEmit ?? true,
    notifyUser: (userId, event) => calls.events.push([userId, event.type]),
    notifyRecipient: async (recipientId) => {
      calls.recipients.push(recipientId);
    },
    scheduleLinkPreview: (input) => calls.previews.push(Boolean(input.edited))
  });
  return { calls, service };
}

test('the thread needs a friendship and a live account, and marks the thread read', async () => {
  assert.equal((await harness({ friends: false }).service.thread(ME, PEER)).status, 'not_friends');
  assert.equal((await harness({ noPeer: true }).service.thread(ME, PEER)).status, 'user_not_found');
  const { calls, service } = harness();
  const listed = await service.thread(ME, PEER);
  assert.equal(listed.status, 'listed');
  assert.equal(Object.keys(listed.peer ?? {}).includes('passwordHash'), false);
  assert.equal(Object.keys(listed.peer ?? {}).includes('hasUsedDesktopApp'), false);
  assert.equal(listed.muted, true);
  assert.deepEqual(
    listed.messages.map((m) => Boolean(m.replyPreview)),
    [false, true]
  );
  assert.deepEqual(calls.events, [[PEER, 'dm-read']]);
  const quiet = harness({ readCount: 0 });
  await quiet.service.thread(ME, PEER);
  assert.deepEqual(quiet.calls.events, []);
});

const sendBase: SendInput = {
  text: 'hi https://example.com',
  attachmentIds: undefined,
  replyTo: undefined,
  replyToMessageId: '',
  idempotencyKey: ''
};

test('send refuses in the legacy order', async () => {
  const cases: Array<[HarnessOptions, Partial<SendInput>, string]> = [
    [{ rate: { allowed: false, retryAfterSeconds: 3 } }, {}, 'rate_limited'],
    [{ friends: false }, {}, 'not_friends'],
    [{ blocked: true }, {}, 'blocked'],
    [{ deleted: true }, {}, 'account_deleted'],
    [{}, { attachmentIds: 'x' }, 'invalid_attachments'],
    [{}, { replyTo: {} }, 'reply_unavailable'],
    [{}, { text: '  ' }, 'empty'],
    [{ media: null }, { attachmentIds: [UUID_A] }, 'media_unavailable']
  ];
  for (const [options, input, status] of cases) {
    assert.equal(
      (await harness(options).service.send(ME, PEER, { ...sendBase, ...input })).status,
      status,
      JSON.stringify(input)
    );
  }
  const limited = await harness({ rate: { allowed: false, retryAfterSeconds: 0 } }).service.send(ME, PEER, sendBase);
  assert.ok('retryAfterSeconds' in limited);
  assert.equal(limited.retryAfterSeconds, 0);
});

test('a send binds attachments, locks the reply and records delivery in one unit of work', async () => {
  const { calls, service } = harness();
  const sent = await service.send(ME, PEER, {
    ...sendBase,
    attachmentIds: [UUID_A],
    replyTo: { messageId: UUID_A },
    replyToMessageId: UUID_A,
    idempotencyKey: 'idem-key-1'
  });
  assert.equal(sent.status, 'sent');
  assert.equal(calls.lockedIn, 'insert', 'the reply target is locked in the transaction that inserts the message');
  assert.ok(sent.message.replyPreview);
  assert.deepEqual(calls.bound, [[UUID_A]]);
  assert.deepEqual(calls.outbox, ['message.created']);
  assert.deepEqual(calls.completed, ['ledger-1']);
  assert.deepEqual(calls.events, [
    [PEER, 'dm-message'],
    ['user-1', 'dm-message']
  ]);
  assert.deepEqual(calls.recipients, [PEER]);
  assert.deepEqual(calls.previews, [false]);

  const plain = harness({ delivery: false });
  await plain.service.send(ME, PEER, sendBase);
  assert.equal(plain.calls.sent[0]?.unitOfWork, null);
  assert.equal(plain.calls.sent[0].beforeUnitOfWork, null);

  const relayed = harness({ directEmit: false });
  await relayed.service.send(ME, PEER, sendBase);
  assert.deepEqual([relayed.calls.events, relayed.calls.recipients, relayed.calls.previews], [[], [], [false]]);
});

test('a reply target that vanishes during the send is refused as reply_unavailable', async () => {
  const { service } = harness({ replyTargetGone: true });
  await assert.rejects(
    service.send(ME, PEER, { ...sendBase, replyTo: { messageId: UUID_A }, replyToMessageId: UUID_A }),
    { code: 'reply_unavailable', statusCode: 409 }
  );
});

test('an idempotent replay answers the stored message without delivering again', async () => {
  const { calls, service } = harness({ replay: true });
  const replay = await service.send(ME, PEER, { ...sendBase, idempotencyKey: 'idem-key-1' });
  assert.ok('message' in replay);
  assert.equal(replay.message.id, 'old');
  assert.deepEqual(replay.message.replyPreview, QUOTE);
  assert.deepEqual([calls.events, calls.previews], [[], []]);
});

test('a replayed ledger entry that is not a whole stored message is refused, not answered', async () => {
  const { calls, service } = harness({
    replay: true,
    replayed: { id: 'old', senderId: 'user-1', recipientId: PEER, replyTo: { messageId: 'm1' } }
  });
  await assert.rejects(
    service.send(ME, PEER, { ...sendBase, idempotencyKey: 'idem-key-1' }),
    /The idempotent replay holds no direct message/
  );
  assert.deepEqual([calls.events, calls.previews], [[], []]);
});

const invite = directMessage({
  id: 'inv',
  senderId: PEER,
  recipientId: 'user-1',
  invite: { roomId: 'room-1', roomName: 'Room', status: 'pending', expiresAt: null }
});
const QUOTE = { messageId: 'm1', deleted: false, text: 'hi' };
const mine = directMessage({ id: 'mine', senderId: 'user-1', recipientId: PEER });
const theirs = directMessage({ id: 'theirs', senderId: PEER, recipientId: 'user-1' });
const myInvite = directMessage({
  id: 'my-inv',
  senderId: 'user-1',
  recipientId: PEER,
  invite: { roomId: 'room-1', roomName: 'Room', status: 'pending', expiresAt: null }
});
const messages: Record<string, DirectMessage> = {
  inv: invite,
  mine,
  theirs,
  'my-inv': myInvite,
  plain: directMessage({ id: 'plain', senderId: PEER, recipientId: 'user-1' })
};

test('answering a room invitation', async () => {
  assert.equal(
    (await harness({ messages }).service.respondInvite(ME, PEER, 'missing', 'accepted')).status,
    'not_found'
  );
  assert.equal((await harness({ messages }).service.respondInvite(ME, PEER, 'plain', 'accepted')).status, 'not_found');
  assert.equal(
    (await harness({ messages }).service.respondInvite(ME, PEER, 'my-inv', 'accepted')).status,
    'not_invited'
  );
  const gone = harness({ messages, roomExists: false });
  assert.equal((await gone.service.respondInvite(ME, PEER, 'inv', 'accepted')).status, 'room_gone');
  assert.deepEqual(gone.calls.expired, [[PEER, 'room-1']]);
  assert.equal(
    (await harness({ messages, roomExists: false }).service.respondInvite(ME, PEER, 'inv', 'declined')).status,
    'answered'
  );
  assert.equal(
    (await harness({ messages, inviteAnswered: true }).service.respondInvite(ME, PEER, 'inv', 'accepted')).status,
    'already_answered'
  );
  const { calls, service } = harness({ messages });
  const answered = await service.respondInvite(ME, PEER, 'inv', 'accepted');
  assert.ok('message' in answered);
  assert.equal(answered.message.invite?.status, 'accepted');
  assert.deepEqual(calls.events, [
    [PEER, 'dm.message.edited'],
    ['user-1', 'dm.message.edited']
  ]);
});

test('marking read by cursor or up to now', async () => {
  const cursor = harness();
  assert.deepEqual(await cursor.service.markRead('user-1', PEER, 'c1'), {
    status: 'read',
    result: { cursor: 'c1', readThrough: 3 }
  });
  assert.deepEqual(cursor.calls.events, [[PEER, 'dm-read']]);
  assert.deepEqual(await harness().service.markRead('user-1', PEER, ''), { status: 'read', result: { count: 1 } });
  const nothing = harness({ readCount: 0 });
  await nothing.service.markRead('user-1', PEER, undefined);
  assert.deepEqual(nothing.calls.events, []);
  // A failed cursor read is not turned into an outcome: the error reaches the
  // central handler, which knows a refused cursor from a server failure.
  const stale = Object.assign(new Error('Stale'), { statusCode: 409, code: 'invalid_cursor' });
  const refused = harness({ readError: stale });
  await assert.rejects(refused.service.markRead('u', PEER, 'c'), stale);
  assert.deepEqual(refused.calls.events, []);
});

test('delete and edit belong to the sender', async () => {
  assert.equal((await harness({ messages }).service.remove('user-1', PEER, 'missing')).status, 'not_found');
  assert.equal((await harness({ messages }).service.remove('user-1', PEER, 'theirs')).status, 'not_sender');
  assert.equal(
    (await harness({ messages, deleteResult: false }).service.remove('user-1', PEER, 'mine')).status,
    'not_found'
  );
  const removed = harness({ messages });
  assert.equal((await removed.service.remove('user-1', PEER, 'mine')).status, 'deleted');
  assert.deepEqual(removed.calls.events, [
    [PEER, 'dm.message.deleted'],
    ['user-1', 'dm.message.deleted']
  ]);

  assert.equal((await harness({ messages }).service.edit('user-1', PEER, 'mine', ' ')).status, 'empty');
  assert.equal((await harness({ messages }).service.edit('user-1', PEER, 'missing', 'x')).status, 'not_found');
  assert.equal((await harness({ messages }).service.edit('user-1', PEER, 'theirs', 'x')).status, 'not_sender');
  assert.equal((await harness({ messages }).service.edit('user-1', PEER, 'my-inv', 'x')).status, 'invitation');
  assert.equal(
    (
      await harness({ messages, rate: { allowed: false, retryAfterSeconds: 2 } }).service.edit(
        'user-1',
        PEER,
        'mine',
        'x'
      )
    ).status,
    'rate_limited'
  );
  assert.equal(
    (await harness({ messages, editResult: null }).service.edit('user-1', PEER, 'mine', 'x')).status,
    'not_found'
  );
  const edited = harness({ messages });
  const edit = await edited.service.edit('user-1', PEER, 'mine', 'new');
  assert.ok('message' in edit);
  assert.equal(edit.message.body, 'new');
  assert.deepEqual(edited.calls.previews, [true]);
  assert.deepEqual(edited.calls.events, [
    [PEER, 'dm.message.edited'],
    ['user-1', 'dm.message.edited']
  ]);
});

// --- routes ------------------------------------------------------------------------

function routeApp(
  t: TestContext,
  outcomes: Answers<DirectMessagesService> = {},
  { signedIn = true }: { signedIn?: boolean } = {}
) {
  const app = fastify();
  registerHttpKit(app, { securityHeaders: () => ({}), recordRequest() {}, logRequest() {}, logHandlerFailure() {} });
  const { service, seen } = recordingService<DirectMessagesService>({
    thread: { status: 'listed', peer: publicUser(PEER), messages: [], muted: false },
    send: {
      status: 'sent',
      message: directMessage({ id: 'm', senderId: 'user-1', recipientId: PEER })
    },
    respondInvite: { status: 'answered', message: invite },
    markRead: { status: 'read', result: { count: 2 } },
    remove: { status: 'deleted' },
    edit: {
      status: 'edited',
      message: directMessage({ id: 'm', senderId: 'user-1', recipientId: PEER, body: 'e' })
    },
    ...outcomes
  });
  registerDirectMessageRoutes(
    app,
    {
      logger: fake<ApiContext['logger']>(),
      clientIp: () => 'ip',
      resolveSession: async () => (signedIn ? { user: ME } : null),
      hashIp: (ip: string) => ip
    },
    service
  );
  t.after(() => app.close());
  return { app, seen };
}

type Body = { ok?: boolean; error?: string } & Record<string, unknown>;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function call(
  app: FastifyInstance,
  method: Method,
  url: string,
  payload?: object,
  headers: Record<string, string> = {}
) {
  const response = await app.inject({
    method,
    url,
    headers,
    ...(payload === undefined ? {} : { payload })
  });
  return { status: response.statusCode, body: response.json<Body>(), retryAfter: response.headers['retry-after'] };
}

type Route = [Method, string, object?];

const ROUTES: Route[] = [
  ['GET', `/api/dm/${PEER}`],
  ['POST', `/api/dm/${PEER}`, { text: 'hi' }],
  ['POST', `/api/dm/${PEER}/invites/${UUID_A}/respond`, { action: 'accept' }],
  ['POST', `/api/dm/${PEER}/read`, {}],
  ['PATCH', `/api/dm/${PEER}/messages/${UUID_A}`, { text: 'e' }],
  ['DELETE', `/api/dm/${PEER}/messages/${UUID_A}`]
];

test('every DM route needs a session, a valid peer and answers', async (t) => {
  const anonymous = routeApp(t, {}, { signedIn: false }).app;
  const { app, seen } = routeApp(t);
  for (const [method, url, payload] of ROUTES) {
    assert.equal((await call(anonymous, method, url, payload)).status, 401, url);
    assert.equal((await call(app, method, url.replace(PEER, 'bad'), payload)).status, 404, url);
    const answered = await call(app, method, url, payload);
    assert.ok([200, 201].includes(answered.status), url);
  }
  assert.equal((await call(app, 'GET', '/api/dm/user-1')).status, 404);
  assert.equal((await call(app, 'POST', '/api/dm/user-1', {})).status, 404);
  await call(
    app,
    'POST',
    `/api/dm/${PEER}`,
    { text: 'hi', replyTo: { messageId: UUID_A } },
    { 'idempotency-key': 'header-key-1' }
  );
  const [, , sent] = defined(seen.send, 'the send call');
  assert.deepEqual([sent.replyToMessageId, sent.idempotencyKey], [UUID_A, 'header-key-1']);
  await call(app, 'POST', `/api/dm/${PEER}/invites/${UUID_A}/respond`, { action: 'decline' });
  assert.equal(seen.respondInvite?.[3], 'declined');
  assert.deepEqual((await call(app, 'POST', `/api/dm/${PEER}/read`, { cursor: 'c' })).body, { ok: true, count: 2 });
  assert.deepEqual((await call(app, 'DELETE', `/api/dm/${PEER}/messages/${UUID_A}`)).body, { ok: true, deleted: true });
});

test('DM refusals keep their texts and codes', async (t) => {
  const post: Route = ['POST', `/api/dm/${PEER}`, { text: 'x' }];
  const cases: Array<[Answers<DirectMessagesService>, Route, number, string]> = [
    [{ thread: { status: 'not_friends' } }, ['GET', `/api/dm/${PEER}`], 403, 'Вы не друзья'],
    [{ thread: { status: 'user_not_found' } }, ['GET', `/api/dm/${PEER}`], 404, 'Пользователь не найден'],
    [{ send: { status: 'not_friends' } }, post, 403, 'Вы не друзья'],
    [{ send: { status: 'blocked' } }, post, 403, 'Сообщение недоступно'],
    [{ send: { status: 'account_deleted' } }, post, 403, 'Аккаунт удалён'],
    [{ send: { status: 'invalid_attachments' } }, post, 400, 'Invalid attachments'],
    [{ send: { status: 'reply_unavailable' } }, post, 409, 'Reply target is unavailable'],
    [{ send: { status: 'empty' } }, post, 400, 'Пустое сообщение'],
    [{ send: { status: 'media_unavailable' } }, post, 503, 'Media uploads are unavailable'],
    [
      { send: { status: 'rate_limited', retryAfterSeconds: 5 } },
      post,
      429,
      'Слишком много сообщений, попробуйте позже'
    ],
    [{}, ['POST', `/api/dm/${PEER}/invites/${UUID_A}/respond`, { action: 'maybe' }], 400, 'Неверное действие'],
    [
      { respondInvite: { status: 'not_found' } },
      ['POST', `/api/dm/${PEER}/invites/${UUID_A}/respond`, { action: 'accept' }],
      404,
      'Приглашение не найдено'
    ],
    [
      { respondInvite: { status: 'not_invited' } },
      ['POST', `/api/dm/${PEER}/invites/${UUID_A}/respond`, { action: 'accept' }],
      403,
      'Отвечать может только приглашённый'
    ],
    [
      { respondInvite: { status: 'room_gone' } },
      ['POST', `/api/dm/${PEER}/invites/${UUID_A}/respond`, { action: 'accept' }],
      410,
      'Комната больше не существует'
    ],
    [
      { respondInvite: { status: 'already_answered' } },
      ['POST', `/api/dm/${PEER}/invites/${UUID_A}/respond`, { action: 'accept' }],
      409,
      'Приглашение уже обработано'
    ],
    [{ edit: { status: 'empty' } }, ['PATCH', `/api/dm/${PEER}/messages/${UUID_A}`, {}], 400, 'Пустое сообщение'],
    [
      { edit: { status: 'not_found' } },
      ['PATCH', `/api/dm/${PEER}/messages/${UUID_A}`, {}],
      404,
      'Сообщение не найдено'
    ],
    [
      { edit: { status: 'not_sender' } },
      ['PATCH', `/api/dm/${PEER}/messages/${UUID_A}`, {}],
      403,
      'Можно редактировать только свои сообщения'
    ],
    [
      { edit: { status: 'invitation' } },
      ['PATCH', `/api/dm/${PEER}/messages/${UUID_A}`, {}],
      403,
      'Приглашение нельзя редактировать'
    ],
    [
      { edit: { status: 'rate_limited', retryAfterSeconds: 5 } },
      ['PATCH', `/api/dm/${PEER}/messages/${UUID_A}`, {}],
      429,
      'Слишком много сообщений, попробуйте позже'
    ],
    [
      { remove: { status: 'not_found' } },
      ['DELETE', `/api/dm/${PEER}/messages/${UUID_A}`],
      404,
      'Сообщение не найдено'
    ],
    [
      { remove: { status: 'not_sender' } },
      ['DELETE', `/api/dm/${PEER}/messages/${UUID_A}`],
      403,
      'Можно удалять только свои сообщения'
    ]
  ];
  for (const [outcome, [method, url, payload], status, error] of cases) {
    const response = await call(routeApp(t, outcome).app, method, url, payload);
    assert.deepEqual([response.status, response.body.error], [status, error], JSON.stringify(outcome));
  }
  const limited = await call(routeApp(t, { send: { status: 'rate_limited', retryAfterSeconds: 5 } }).app, ...post);
  assert.deepEqual([limited.retryAfter, limited.body.retryAfterSeconds], ['5', 5]);
  const blocked = await call(routeApp(t, { send: { status: 'blocked' } }).app, ...post);
  assert.equal(blocked.body.code, 'relationship_blocked');
});

test('a failing DM read store answers 500 without its text; a bad cursor still answers 400', async (t) => {
  const codec = createCursorCodec({ keys: ['m'.repeat(32)] });
  const participants = [ME.id, PEER].sort().join(':');
  const cursor = codec.encode({
    purpose: 'dm-read',
    context: `dm:${participants}`,
    tuple: { createdAtMicros: '9', id: 'm9' }
  });
  // What pg throws when the read table is unreachable: no statusCode, and a
  // message that names the schema.
  const storeDown = Object.assign(new Error('relation "dm_read_states" does not exist'), { code: '42P01' });
  const failures: unknown[] = [];
  const app = fastify();
  registerHttpKit(app, {
    securityHeaders: () => ({}),
    recordRequest() {},
    logRequest() {},
    logHandlerFailure: (_request, _route, error) => failures.push(error)
  });
  const { service } = harness({
    readService: createMessageReadService({
      authorizeRoomRead: async () => false,
      cursorCodec: codec,
      repository: fake<MessageReadRepository>({
        async advanceDm() {
          throw storeDown;
        }
      })
    })
  });
  registerDirectMessageRoutes(
    app,
    {
      logger: fake<ApiContext['logger']>(),
      clientIp: () => 'ip',
      resolveSession: async () => ({ user: ME }),
      hashIp: (ip: string) => ip
    },
    service
  );
  t.after(() => app.close());

  const down = await call(app, 'POST', `/api/dm/${PEER}/read`, { cursor });
  assert.deepEqual(
    [down.status, down.body],
    [500, { ok: false, error: 'Internal server error', code: 'internal_error' }]
  );
  assert.deepEqual(failures, [storeDown], 'the central handler logs the store failure');

  const bad = await call(app, 'POST', `/api/dm/${PEER}/read`, { cursor: 'not-a-cursor' });
  assert.deepEqual(
    [bad.status, bad.body],
    [400, { ok: false, error: 'Invalid read cursor', code: 'invalid_read_cursor' }]
  );
});
