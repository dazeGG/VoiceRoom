// Branch-by-branch proofs for the room chat (domains/messaging/room-chat.*):
// the list the room link grants, sending with every refusal in its original
// order, editing, deleting, marking read, and the HTTP answer each outcome
// becomes. Everything runs on fakes; the integration suites cover the store.

import type { Attachment } from '@voice-room/shared/contracts/messages';
import { buildServerEnvelope } from '@voice-room/shared/realtime';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fastify, { type FastifyInstance } from 'fastify';

import type { ApiContext } from '../src/app/context.ts';
import type { LiveRoom, PresencePeer } from '../src/domains/rooms/room-views.ts';

import {
  cleanChatText,
  cleanUuid,
  messageFingerprint,
  normalizeAttachmentIds,
  requestIdempotencyKey
} from '../src/domains/messaging/message-input.ts';
import { publicChatMessage, type RoomChatMessage } from '../src/domains/messaging/room-chat-views.ts';
import { registerRoomChatRoutes } from '../src/domains/messaging/room-chat.routes.ts';
import {
  createRoomChatService,
  type PostInput,
  type RoomChatDeps,
  type RoomChatService,
  type RoomMessages
} from '../src/domains/messaging/room-chat.service.ts';
import { createMessageReadService, type MessageReadRepository } from '../src/domains/messaging/message-read.service.ts';
import { createCursorCodec } from '../src/platform/cursor-codec.ts';
import { registerHttpKit } from '../src/platform/http/http-kit.ts';
import { fake, fakeDb, recordingLogger, storedUser } from './fakes/index.ts';
import { defined } from './helpers/assert-defined.ts';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const TOKEN = 't'.repeat(32);
const PICTURE: Attachment = {
  id: 'a1',
  context: 'room',
  order: 0,
  mimeType: 'image/webp',
  bytes: 10,
  width: 2,
  height: 2,
  state: 'ready',
  url: '/api/media/attachments/a1/preview'
};
const PREVIEW = { url: 'https://example.com', title: 'Example', description: '', siteName: '', image: null };
const QUOTE = { messageId: 'quoted', deleted: false, text: 'hi' };

const ACCOUNT = {
  id: 'user-1',
  displayName: 'Alice',
  avatarColorKey: 'teal' as const,
  avatarKey: 'alice.webp',
  avatarAccent: 'gold'
};

function room(peers: PresencePeer[] = [], overrides: Partial<LiveRoom> = {}) {
  return fake<LiveRoom>({
    id: 'room-1',
    isStatic: true,
    ownerId: 'owner-1',
    peers: new Map(peers.map((peer) => [peer.id, peer])),
    ...overrides
  });
}

// The stores hand the unit-of-work callbacks a client standing for a named
// transaction; a test asks which transaction a client it was given belongs to.
const transactionNames = new Map<unknown, string>();
function transactionMarker(name: string) {
  const client = fakeDb();
  transactionNames.set(client, name);
  return client;
}

// --- input normalisation ---------------------------------------------------------

test('message input helpers normalise what clients send', () => {
  assert.equal(cleanUuid(` ${UUID_A} `), UUID_A);
  assert.equal(cleanUuid('nope'), '');
  assert.equal(cleanUuid(null), '');
  assert.deepEqual(normalizeAttachmentIds(undefined), []);
  assert.deepEqual(normalizeAttachmentIds([UUID_A, UUID_B]), [UUID_A, UUID_B]);
  assert.equal(normalizeAttachmentIds('x'), null);
  assert.equal(normalizeAttachmentIds([UUID_A, UUID_A]), null);
  assert.equal(normalizeAttachmentIds([UUID_A, 'bad']), null);
  assert.equal(normalizeAttachmentIds([UUID_A, UUID_B, UUID_A, UUID_B, UUID_A]), null);
  assert.equal(
    requestIdempotencyKey({ headers: { 'idempotency-key': ' key-12345 ' } }, { idempotencyKey: 'other-key' }),
    'key-12345'
  );
  assert.equal(requestIdempotencyKey({ headers: {} }, { idempotencyKey: 'body-key-1' }), 'body-key-1');
  assert.equal(requestIdempotencyKey(null, { idempotencyKey: 'short' }), '');
  assert.equal(requestIdempotencyKey(null, { idempotencyKey: 'x'.repeat(161) }), '');
  assert.equal(requestIdempotencyKey(null, null), '');
  assert.equal(messageFingerprint({ a: 1 }), messageFingerprint({ a: 1 }));
  assert.notEqual(messageFingerprint({ a: 1 }), messageFingerprint({ a: 2 }));
  assert.equal(cleanChatText('  a \t b \n\n\n\n c  '), 'a b\n\nc');
  assert.equal(cleanChatText(Array.from({ length: 25 }, (_, i) => `l${i}`).join('\n')).split('\n').length, 20);
  assert.equal(cleanChatText('x'.repeat(600)).length, 500);
  assert.equal(cleanChatText(undefined), '');
});

test('a public chat message fills avatar and defaults', () => {
  const bare = publicChatMessage({
    id: 'm',
    roomId: 'r',
    peerId: 'peer0001',
    name: 'A',
    text: 't',
    createdAt: 1,
    avatarKey: 'k.webp'
  });
  assert.equal(bare.avatarUrl, '/api/avatars/k.webp');
  assert.equal(bare.authorUserId, null);
  assert.equal(bare.editedAt, null);
  assert.deepEqual(bare.attachments, []);
  assert.ok(bare.avatarColorKey);
  assert.equal(bare.linkPreview, undefined);
  const full = publicChatMessage({
    id: 'm',
    roomId: 'r',
    peerId: 'p',
    name: 'A',
    text: 't',
    createdAt: 1,
    avatarUrl: '/x',
    avatarColorKey: 'blue',
    attachments: [PICTURE],
    linkPreview: PREVIEW
  });
  assert.equal(full.avatarUrl, '/x');
  assert.equal(full.avatarColorKey, 'blue');
  assert.deepEqual(full.attachments, [PICTURE]);
  assert.equal(
    publicChatMessage({ id: 'm', roomId: 'r', peerId: 'p', name: 'A', text: 't', createdAt: 1 }).avatarUrl,
    null
  );
});

// --- service ---------------------------------------------------------------------

type HarnessOptions = {
  room?: LiveRoom | null;
  peers?: PresencePeer[];
  stored?: RoomChatMessage[];
  appendResult?: RoomChatMessage | null;
  messages?: Record<string, RoomChatMessage>;
  softDeleteResult?: unknown;
  editResult?: null;
  lastReadAt?: number | null;
  notifications?: null;
  retireFails?: boolean;
  delivery?: false;
  replay?: boolean;
  readError?: Error;
  readService?: ReturnType<RoomChatDeps['readService']>;
  ban?: (userId: string | null | undefined, ip: string) => boolean;
  rate?: { allowed: boolean; retryAfterSeconds: number };
  findUserFails?: boolean;
  media?: null;
  directEmit?: boolean;
  replyTargetGone?: boolean;
  replyTargetGuest?: boolean;
};

function harness(options: HarnessOptions = {}) {
  const logger = recordingLogger();
  const logged = (level: string) =>
    logger.records.filter((record) => record.level === level).map((record) => record.evt);
  const calls: {
    lockedIn: string;
    appended: Parameters<RoomMessages['appendMessage']>[1][];
    edited: string[];
    deleted: string[];
    detail: Array<{ type?: string }>;
    pins: string[];
    previews: unknown[];
    emitted: string[];
    summaries: string[];
    retired: Array<{ through?: unknown }>;
    addressed: Array<Record<string, unknown>>;
    outbox: Array<{ type?: string; message?: RoomChatMessage }>;
    bound: Array<{ attachmentIds?: unknown }>;
    completed: unknown[];
    readonly warnings: unknown[];
    readonly errors: unknown[];
  } = {
    lockedIn: '',
    appended: [],
    edited: [],
    deleted: [],
    detail: [],
    pins: [],
    previews: [],
    emitted: [],
    summaries: [],
    retired: [],
    addressed: [],
    outbox: [],
    bound: [],
    completed: [],
    get warnings() {
      return logged('warn');
    },
    get errors() {
      return logged('error');
    }
  };
  const currentRoom = 'room' in options ? (options.room ?? null) : room(options.peers || []);
  const stored = options.stored || [];
  const messages: RoomMessages = {
    async listMessages() {
      return stored;
    },
    async appendMessage(roomId, input) {
      calls.appended.push(input);
      if (options.appendResult !== undefined) return options.appendResult;
      if (input.beforeUnitOfWork) {
        const before = await input.beforeUnitOfWork(transactionMarker('before'));
        if (before?.replay) return { ...before.message, idempotencyReplay: true };
      }
      const inserted: RoomChatMessage = {
        id: input.id,
        roomId,
        peerId: input.peerId,
        name: input.name,
        text: input.text,
        createdAt: input.createdAt,
        authorUserId: input.authorUserId,
        ...(input.replyToMessageId ? { replyTo: { messageId: input.replyToMessageId } } : {})
      };
      if (input.unitOfWork) await input.unitOfWork(transactionMarker('insert'), inserted);
      return inserted;
    },
    async getMessage(_roomId, messageId) {
      return (options.messages || {})[messageId] || null;
    },
    async softDeleteMessage(_roomId, messageId) {
      calls.deleted.push(messageId);
      return options.softDeleteResult ?? true;
    },
    async editMessage(_roomId, messageId, text) {
      calls.edited.push(text);
      return options.editResult === null
        ? null
        : { ...defined(options.messages?.[messageId], 'the edited message'), text, editedAt: 9 };
    },
    async markRoomChatRead() {
      return options.lastReadAt === undefined ? 5 : options.lastReadAt;
    }
  };
  const notifications: ReturnType<RoomChatDeps['notifications']> =
    options.notifications === null
      ? null
      : {
          service: {
            async createAddressedForMessage(input) {
              calls.addressed.push(input);
            },
            ...(options.retireFails
              ? {
                  async markRoomRead() {
                    throw new Error('inbox down');
                  }
                }
              : {
                  async markRoomRead(input) {
                    calls.retired.push(input);
                  }
                })
          }
        };
  const delivery: ReturnType<RoomChatDeps['delivery']> =
    options.delivery === false
      ? null
      : {
          idempotency: {
            async reserve() {
              return options.replay
                ? {
                    kind: 'replay' as const,
                    ledgerKey: 'ledger-1',
                    response: {
                      messageId: 'old',
                      statusCode: 201,
                      body: {
                        message: {
                          id: 'old',
                          roomId: 'room-1',
                          peerId: 'p',
                          name: 'A',
                          text: 'old',
                          createdAt: 1,
                          replyTo: { messageId: UUID_A }
                        }
                      }
                    }
                  }
                : { kind: 'reserved', ledgerKey: 'ledger-1' };
            },
            async complete(_client, key, result) {
              calls.completed.push({ key, status: result.statusCode });
            }
          },
          outbox: {
            async enqueue(_client, event) {
              calls.outbox.push(event);
            }
          }
        };
  const service = createRoomChatService({
    messages: () => ({ room: messages }),
    readService: () =>
      options.readService ?? {
        async advanceRoom(input) {
          if (options.readError) throw options.readError;
          return { readThrough: 77, cursor: input.cursor };
        }
      },
    getRoom: async () => currentRoom,
    findRoomBan: async (_roomId, userId, ip) => (options.ban ? options.ban(userId, ip) : false),
    prepareContent: ({ content, text }) => {
      if (content === 'broken') throw new Error('bad content');
      return { content, text: text || 'from content' };
    },
    mentionUserIds: (content) =>
      content === 'bad-mention'
        ? { ok: false, code: 'invalid_mention_target' }
        : { ok: true, userIds: content === 'mention' ? ['user-2'] : [] },
    limiter: { check: () => options.rate || { allowed: true, retryAfterSeconds: 0 } },
    findUser: async (userId) => {
      if (options.findUserFails) throw new Error('users down');
      return { id: userId, displayName: 'Stored', avatarKey: null };
    },
    media: () =>
      options.media === null
        ? null
        : {
            attachments: {
              async bindReady(input) {
                calls.bound.push(input);
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
      async lockRoomTarget(input) {
        calls.lockedIn = transactionNames.get(input.client) ?? '';
        if (options.replyTargetGone) return null;
        return {
          id: UUID_A,
          roomId: 'room-1',
          peerId: 'peer0003',
          authorUserId: options.replyTargetGuest ? null : 'user-3',
          name: 'Carol',
          text: 'target',
          createdAt: Date.now(),
          expiresAt: null,
          deletedAt: null,
          metadata: null,
          replyTo: undefined
        };
      }
    }),
    notifications: () => notifications,
    delivery: () => delivery,
    projectMedia: async (_context, message) => ({ ...message, attachments: [] }),
    projectReply: async (_context, message) => (message.replyTo ? { ...message, replyPreview: QUOTE } : message),
    identity: {
      chatPeerId: (user) => `auth-${user?.id}`,
      avatarColorKey: (user) => user?.avatarColorKey || '',
      displayName: (user) => (user ? user.displayName || '' : '')
    },
    directEmit: options.directEmit ?? true,
    broadcastChatMessage: (_roomId, message) => calls.emitted.push(message.id),
    broadcastRoomDetail: (_roomId, event) => calls.detail.push(event),
    roomDetailEvent: buildServerEnvelope,
    scheduleLinkPreview: (_roomId, messageId, _text, opts) =>
      calls.previews.push({ messageId, edited: Boolean(opts?.edited) }),
    refreshPins: async (_roomId, action) => {
      calls.pins.push(action);
    },
    sendRoomSummaryToUser: async (_roomId, userId) => {
      calls.summaries.push(userId);
    },
    logger: () => logger
  });
  return { calls, service };
}

const guest: PresencePeer = { id: 'peer0001', sessionToken: TOKEN, name: 'Guest', avatarColorKey: 'red' };
const postBase: PostInput = {
  roomId: 'room-1',
  user: null,
  clientIp: '203.0.113.1',
  peerId: '',
  sessionToken: '',
  name: 'Typed',
  text: 'hello',
  content: undefined,
  attachmentIds: undefined,
  replyTo: undefined,
  replyToMessageId: '',
  idempotencyKey: ''
};

test('the list refuses missing rooms and banned viewers and projects media and replies', async () => {
  assert.equal(
    (await harness({ room: null }).service.list('room-1', { user: null, clientIp: 'ip' })).status,
    'room_not_found'
  );
  assert.equal(
    (await harness({ ban: () => true }).service.list('room-1', { user: ACCOUNT, clientIp: 'ip' })).status,
    'room_banned'
  );
  const listed = await harness({
    stored: [
      { id: 'a', roomId: 'room-1', peerId: 'p', name: 'A', text: 'a', createdAt: 1 },
      { id: 'b', roomId: 'room-1', peerId: 'p', name: 'A', text: 'b', createdAt: 2, replyTo: { messageId: UUID_A } }
    ]
  }).service.list('room-1', { user: null, clientIp: 'ip' });
  assert.equal(listed.status, 'listed');
  assert.deepEqual(
    listed.messages.map((m) => [m.id, Boolean(m.replyPreview)]),
    [
      ['a', false],
      ['b', true]
    ]
  );
});

test('send refuses in the legacy order', async () => {
  const cases: Array<[HarnessOptions, Partial<PostInput>, string]> = [
    [{}, { content: 'broken' }, 'invalid_content'],
    [{}, { content: 'bad-mention' }, 'invalid_mention'],
    [{ room: null }, {}, 'room_not_found'],
    [{ ban: () => true }, {}, 'room_banned'],
    [{}, { attachmentIds: ['bad'] }, 'invalid_attachments'],
    [{}, { replyTo: {}, replyToMessageId: '' }, 'reply_unavailable'],
    [{}, { text: '   ' }, 'empty'],
    [{ rate: { allowed: false, retryAfterSeconds: 3 } }, {}, 'rate_limited'],
    [{}, {}, 'presence_required'],
    [{ peers: [guest] }, { peerId: guest.id, sessionToken: 'u'.repeat(32) }, 'invalid_session'],
    [
      { peers: [{ ...guest, ip: '10.0.0.1' }], ban: (userId, ip) => ip === '10.0.0.1' },
      { peerId: guest.id, sessionToken: TOKEN },
      'room_banned'
    ],
    [{ peers: [guest] }, { peerId: guest.id, sessionToken: TOKEN, attachmentIds: [UUID_A] }, 'media_unavailable'],
    [{ media: null }, { user: ACCOUNT, attachmentIds: [UUID_A] }, 'media_unavailable'],
    [{ appendResult: null }, { user: ACCOUNT }, 'empty']
  ];
  for (const [options, input, status] of cases) {
    const result = await harness(options).service.post({ ...postBase, ...input });
    assert.equal(result.status, status, JSON.stringify(input));
  }
  const mention = await harness().service.post({ ...postBase, content: 'bad-mention' });
  assert.equal(mention.status === 'invalid_mention' && mention.code, 'invalid_mention_target');
  const limited = await harness({ rate: { allowed: false, retryAfterSeconds: 3 } }).service.post(postBase);
  assert.equal(limited.status === 'rate_limited' && limited.retryAfterSeconds, 3);
  const unspecified = await harness({ rate: { allowed: false, retryAfterSeconds: 0 } }).service.post(postBase);
  assert.equal(unspecified.status === 'rate_limited' && unspecified.retryAfterSeconds, 0);
});

test('a guest peer sends under its live identity and a reserved peer id falls back to the account', async () => {
  const peer = { ...guest };
  const { calls, service } = harness({ peers: [peer], delivery: false });
  const sent = await service.post({ ...postBase, peerId: guest.id, sessionToken: TOKEN });
  assert.equal(sent.status, 'created');
  assert.equal(calls.appended[0]?.peerId, guest.id);
  assert.equal(calls.appended[0]?.name, 'Guest');
  assert.equal(calls.appended[0]?.avatarColorKey, 'red');
  assert.equal(calls.appended[0]?.authorUserId, null);
  assert.equal(calls.appended[0]?.unitOfWork, null);
  assert.deepEqual(calls.emitted, [sent.message.id]);
  // The scheduler itself skips texts without a link.
  assert.deepEqual(calls.previews, [{ messageId: sent.message.id, edited: false }]);

  const reserved = harness({ peers: [{ ...guest, id: 'auth-user-9' }] });
  const own = await reserved.service.post({
    ...postBase,
    user: ACCOUNT,
    peerId: 'auth-user-9',
    sessionToken: TOKEN,
    text: 'see https://example.com'
  });
  assert.equal(own.status, 'created');
  assert.equal(reserved.calls.appended[0]?.peerId, 'auth-user-1');
  assert.equal(own.message.avatarUrl, '/api/avatars/alice.webp');
  assert.deepEqual(reserved.calls.previews, [{ messageId: own.message.id, edited: false }]);
});

test('a signed-in account in the roster takes its profile colour onto the peer', async () => {
  const peer = { ...guest, accountUserId: 'user-1', avatarColorKey: 'red', avatarUrl: '/peer.webp' };
  const { calls, service } = harness({ peers: [peer] });
  await service.post({ ...postBase, user: { ...ACCOUNT, avatarKey: null }, peerId: guest.id, sessionToken: TOKEN });
  assert.equal(peer.avatarColorKey, 'teal');
  assert.equal(calls.appended[0]?.avatarColorKey, 'teal');
  assert.equal(calls.outbox[0]?.message?.avatarUrl, '/peer.webp');

  const plain = harness({ peers: [{ ...guest, avatarColorKey: undefined }] });
  await plain.service.post({ ...postBase, peerId: guest.id, sessionToken: TOKEN });
  assert.ok(plain.calls.appended[0]?.avatarColorKey);
});

test('a guest tab of a signed-out account is attributed to the stored account', async () => {
  const peer = { ...guest, accountUserId: 'user-7' };
  const found = harness({ peers: [peer] });
  await found.service.post({ ...postBase, peerId: guest.id, sessionToken: TOKEN });
  assert.equal(found.calls.appended[0]?.authorUserId, 'user-7');
  assert.equal(found.calls.appended[0]?.name, 'Stored');

  const failed = harness({ peers: [peer], findUserFails: true });
  await failed.service.post({ ...postBase, peerId: guest.id, sessionToken: TOKEN });
  assert.equal(failed.calls.appended[0]?.authorUserId, 'user-7');
  assert.equal(failed.calls.appended[0]?.name, 'Guest');
  assert.equal(failed.calls.warnings.length, 1);
});

test('an account send binds attachments, locks the reply, addresses mentions and records delivery in one unit of work', async () => {
  const { calls, service } = harness();
  const sent = await service.post({
    ...postBase,
    user: ACCOUNT,
    content: 'mention',
    text: '',
    attachmentIds: [UUID_A],
    replyTo: { messageId: UUID_B },
    replyToMessageId: UUID_B,
    idempotencyKey: 'idem-key-1'
  });
  assert.equal(sent.status, 'created');
  assert.equal(calls.lockedIn, 'insert', 'the reply target is locked in the transaction that inserts the message');
  assert.equal(calls.appended[0]?.text, 'from content');
  assert.equal(calls.appended[0]?.replyToMessageId, UUID_B);
  assert.deepEqual(calls.bound[0]?.attachmentIds, [UUID_A]);
  assert.deepEqual(calls.addressed[0]?.targetUserIds, ['user-2']);
  assert.equal(calls.addressed[0]?.replyTargetUserId, 'user-3');
  assert.equal(calls.outbox[0]?.type, 'message.created');
  assert.equal(calls.outbox[0]?.message?.avatarKey, 'alice.webp');
  assert.deepEqual(calls.completed, [{ key: 'ledger-1', status: 201 }]);
  assert.ok(sent.message.replyPreview);
});

test('mentions are not addressed without engagement or an inbox', async () => {
  const noInbox = harness({ notifications: null });
  assert.equal(
    (
      await noInbox.service.post({
        ...postBase,
        user: ACCOUNT,
        replyTo: { messageId: UUID_B },
        replyToMessageId: UUID_B
      })
    ).status,
    'created'
  );
  const guestAuthor = harness({ peers: [guest] });
  await guestAuthor.service.post({
    ...postBase,
    peerId: guest.id,
    sessionToken: TOKEN,
    replyTo: { messageId: UUID_B },
    replyToMessageId: UUID_B
  });
  assert.deepEqual(guestAuthor.calls.addressed, []);
  const plain = harness({ delivery: false });
  await plain.service.post({ ...postBase, user: ACCOUNT, idempotencyKey: 'idem-key-1' });
  assert.equal(plain.calls.appended[0]?.beforeUnitOfWork, null);
});

test('a reply to a guest-authored message without mentions is not addressed', async () => {
  const { calls, service } = harness({ replyTargetGuest: true });
  const sent = await service.post({
    ...postBase,
    user: ACCOUNT,
    replyTo: { messageId: UUID_B },
    replyToMessageId: UUID_B
  });
  assert.equal(sent.status, 'created');
  assert.deepEqual(calls.addressed, []);
});

test('an idempotent replay answers the stored message without broadcasting again', async () => {
  const { calls, service } = harness({ replay: true });
  const replay = await service.post({ ...postBase, user: ACCOUNT, idempotencyKey: 'idem-key-1' });
  assert.equal(replay.status, 'created');
  assert.equal(replay.message.id, 'old');
  assert.deepEqual(replay.message.replyPreview, QUOTE);
  assert.deepEqual(calls.emitted, []);
  assert.deepEqual(calls.previews, []);

  const relayed = harness({ directEmit: false });
  await relayed.service.post({ ...postBase, user: ACCOUNT, text: 'https://example.com' });
  assert.deepEqual(relayed.calls.emitted, []);
  assert.equal(relayed.calls.previews.length, 1);
});

const guestMessage = {
  id: 'm-guest',
  roomId: 'room-1',
  peerId: guest.id,
  name: 'Guest',
  text: 'hi',
  createdAt: 1,
  authorUserId: null
};
const accountMessage = {
  id: 'm-account',
  roomId: 'room-1',
  peerId: 'auth-user-1',
  name: 'Alice',
  text: 'hi',
  createdAt: 1,
  authorUserId: 'user-1'
};
const editBase = { roomId: 'room-1', user: null, clientIp: 'ip', peerId: '', sessionToken: '', text: 'changed' };

test('edit is for the author only, in the legacy order', async () => {
  const messages = { [guestMessage.id]: guestMessage, [accountMessage.id]: accountMessage };
  type EditInput = Parameters<RoomChatService['edit']>[0];
  const cases: Array<[HarnessOptions, Partial<EditInput> & Pick<EditInput, 'messageId'>, string]> = [
    [{ room: null }, { messageId: 'm-guest' }, 'room_not_found'],
    [{ ban: () => true }, { messageId: 'm-guest' }, 'room_banned'],
    [{}, { messageId: 'm-guest', text: ' ' }, 'empty'],
    [{ messages }, { messageId: 'missing' }, 'message_not_found'],
    [{ messages }, { messageId: 'm-account', peerId: 'auth-user-1', sessionToken: TOKEN }, 'not_author'],
    [{ messages }, { messageId: 'm-guest', peerId: 'someone' }, 'not_author'],
    [
      { messages, peers: [guest] },
      { messageId: 'm-guest', peerId: guest.id, sessionToken: 'u'.repeat(32) },
      'invalid_session'
    ],
    [
      { messages, peers: [{ ...guest, accountUserId: 'user-5' }], ban: (userId) => userId === 'user-5' },
      { messageId: 'm-guest', peerId: guest.id, sessionToken: TOKEN },
      'room_banned'
    ],
    [
      { messages, rate: { allowed: false, retryAfterSeconds: 2 } },
      { messageId: 'm-account', user: ACCOUNT },
      'rate_limited'
    ],
    [{ messages, editResult: null }, { messageId: 'm-account', user: ACCOUNT }, 'message_not_found']
  ];
  for (const [options, input, status] of cases) {
    assert.equal(
      (await harness(options).service.edit({ ...editBase, ...input })).status,
      status,
      JSON.stringify(input)
    );
  }
});

test('an edit is published, refreshes pins and reschedules the link preview', async () => {
  const { calls, service } = harness({ messages: { [guestMessage.id]: guestMessage }, peers: [guest] });
  const edited = await service.edit({ ...editBase, messageId: 'm-guest', peerId: guest.id, sessionToken: TOKEN });
  assert.equal(edited.status, 'edited');
  assert.equal(edited.message.text, 'changed');
  assert.equal(edited.message.editedAt, 9);
  assert.equal(calls.detail[0]?.type, 'room.chat.edited');
  assert.deepEqual(calls.pins, ['message-edited']);
  assert.deepEqual(calls.previews, [{ messageId: 'm-guest', edited: true }]);
});

test('delete: author, live guest session or the persistent room owner', async () => {
  const messages = { [guestMessage.id]: guestMessage, [accountMessage.id]: accountMessage };
  const base = { roomId: 'room-1', user: null, clientIp: 'ip', peerId: '', sessionToken: '' };
  assert.equal(
    (await harness({ room: null }).service.remove({ ...base, messageId: 'm-guest' })).status,
    'room_not_found'
  );
  assert.equal(
    (await harness({ messages }).service.remove({ ...base, messageId: 'missing' })).status,
    'message_not_found'
  );
  assert.equal(
    (
      await harness({ messages, peers: [guest] }).service.remove({
        ...base,
        messageId: 'm-guest',
        peerId: guest.id,
        sessionToken: 'bad'
      })
    ).status,
    'invalid_session'
  );
  assert.equal(
    (await harness({ messages }).service.remove({ ...base, messageId: 'm-account', peerId: 'auth-user-1' })).status,
    'not_allowed'
  );
  assert.equal(
    (
      await harness({ messages, room: room([], { isStatic: false, ownerId: 'user-9' }) }).service.remove({
        ...base,
        messageId: 'm-account',
        user: { id: 'user-9' }
      })
    ).status,
    'not_allowed'
  );

  const owner = harness({ messages });
  assert.equal(
    (await owner.service.remove({ ...base, messageId: 'm-account', user: { id: 'owner-1' } })).status,
    'deleted'
  );
  assert.equal(owner.calls.detail[0]?.type, 'room.chat.deleted');
  assert.deepEqual(owner.calls.pins, ['message-deleted']);
  assert.equal(
    (await harness({ messages }).service.remove({ ...base, messageId: 'm-account', user: ACCOUNT })).status,
    'deleted'
  );
  assert.equal(
    (
      await harness({ messages, peers: [guest] }).service.remove({
        ...base,
        messageId: 'm-guest',
        peerId: guest.id,
        sessionToken: TOKEN
      })
    ).status,
    'deleted'
  );
  const raced = harness({ messages, softDeleteResult: false });
  assert.equal(
    (await raced.service.remove({ ...base, messageId: 'm-account', user: ACCOUNT })).status,
    'message_not_found'
  );
  assert.deepEqual(raced.calls.detail, []);
});

test('marking read advances the cursor or the wall clock and retires notifications', async () => {
  const cursor = harness();
  assert.deepEqual(await cursor.service.markRead('room-1', 'user-1', 'cursor-1'), {
    status: 'read',
    result: { readThrough: 77, cursor: 'cursor-1' }
  });
  assert.deepEqual(cursor.calls.retired, [{ userId: 'user-1', roomId: 'room-1', through: 77 }]);
  assert.deepEqual(cursor.calls.summaries, ['user-1']);

  const legacy = harness();
  assert.deepEqual(await legacy.service.markRead('room-1', 'user-1', ''), {
    status: 'read',
    result: { lastReadAt: 5, unreadCount: 0 }
  });
  assert.equal(legacy.calls.retired[0]?.through, 5);
  assert.equal(
    (await harness({ lastReadAt: null }).service.markRead('room-1', 'user-1', undefined)).status,
    'room_not_found'
  );

  // A failed cursor read is not turned into an outcome: the error reaches the
  // central handler, which knows a refused cursor from a server failure.
  const stale = Object.assign(new Error('Stale cursor'), { statusCode: 409, code: 'invalid_cursor' });
  const refused = harness({ readError: stale });
  await assert.rejects(refused.service.markRead('room-1', 'user-1', 'c'), stale);
  assert.deepEqual(refused.calls.retired, []);
  assert.deepEqual(refused.calls.summaries, []);

  // Retiring is best effort and a missing inbox is a quiet no-op.
  const failing = harness({ retireFails: true });
  assert.equal((await failing.service.markRead('room-1', 'user-1', '')).status, 'read');
  assert.equal(failing.calls.errors.length, 1);
  assert.equal((await harness({ notifications: null }).service.markRead('room-1', 'user-1', '')).status, 'read');
});

// --- routes ------------------------------------------------------------------------

/** What each service method resolves to. */
type Outcomes = { [Method in keyof RoomChatService]: Awaited<ReturnType<RoomChatService[Method]>> };

function routeApp(
  t: TestContext,
  outcomes: Partial<Outcomes> = {},
  { user = null }: { user?: typeof ACCOUNT | null } = {}
) {
  const app = fastify();
  registerHttpKit(app, { securityHeaders: () => ({}), recordRequest() {}, logRequest() {}, logHandlerFailure() {} });
  const seen: {
    list?: { user?: { id: string } | null };
    post?: PostInput;
    edit?: { messageId: string };
    remove?: unknown;
    read?: unknown;
  } = {};
  const chat = fake<RoomChatService>({
    async list(roomId: string, caller: { user?: { id: string } | null }): Promise<Outcomes['list']> {
      seen.list = caller;
      return (
        outcomes.list || {
          status: 'listed',
          messages: [{ id: 'm', roomId, peerId: 'p', name: 'A', text: 't', createdAt: 1 }]
        }
      );
    },
    async post(input: PostInput): Promise<Outcomes['post']> {
      seen.post = input;
      return (
        outcomes.post || {
          status: 'created',
          message: { id: 'm', roomId: input.roomId, peerId: 'p', name: 'A', text: 't', createdAt: 1 }
        }
      );
    },
    async edit(input: { messageId: string }): Promise<Outcomes['edit']> {
      seen.edit = input;
      return (
        outcomes.edit || {
          status: 'edited',
          message: publicChatMessage({ id: 'm', roomId: 'room-1', peerId: 'p', name: 'A', text: 'e', createdAt: 1 })
        }
      );
    },
    async remove(input: unknown): Promise<Outcomes['remove']> {
      seen.remove = input;
      return outcomes.remove || { status: 'deleted' };
    },
    async markRead(roomId: string, userId: string, cursor: unknown): Promise<Outcomes['markRead']> {
      seen.read = { roomId, userId, cursor };
      return outcomes.markRead || { status: 'read', result: { lastReadAt: 5, unreadCount: 0 } };
    }
  });
  registerRoomChatRoutes(
    app,
    {
      logger: fake<ApiContext['logger']>(),
      clientIp: () => '203.0.113.1',
      resolveSession: async () => (user ? { user: storedUser(user) } : null),
      hashIp: (ip: string) => ip
    },
    chat
  );
  t.after(() => app.close());
  return { app, seen };
}

type Body = {
  ok?: boolean;
  error?: string;
  roomId?: string;
  messages?: Array<{ avatarUrl?: string | null }>;
} & Record<string, unknown>;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type Route = [Method, string, object?];

async function call(
  app: FastifyInstance,
  method: Method,
  url: string,
  payload?: object,
  headers: Record<string, string> = {}
) {
  const response = await app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) });
  return { status: response.statusCode, body: response.json<Body>(), headers: response.headers };
}

test('chat routes pass normalised input and answer each outcome', async (t) => {
  const { app, seen } = routeApp(t, {}, { user: ACCOUNT });
  const listed = await call(app, 'GET', '/api/rooms/room-1/chat');
  assert.equal(listed.body.roomId, 'room-1');
  assert.equal(listed.body.messages?.[0]?.avatarUrl, null);
  assert.equal(seen.list?.user?.id, 'user-1');

  const posted = await call(
    app,
    'POST',
    '/api/rooms/room-1/chat',
    { peerId: 'peer0001', sessionToken: TOKEN, name: ' Bob ', text: 'hi', replyTo: { messageId: UUID_A } },
    { 'idempotency-key': 'header-key-1' }
  );
  assert.equal(posted.status, 201);
  assert.equal(seen.post?.name, 'Bob');
  assert.equal(seen.post.replyToMessageId, UUID_A);
  assert.equal(seen.post.idempotencyKey, 'header-key-1');
  await call(app, 'POST', '/api/rooms/room-1/chat', { text: 'hi', replyTo: null });
  assert.equal(seen.post?.replyToMessageId, '');

  // As sent over the wire: the fields left undefined are not in the JSON.
  const editedOnTheWire: unknown = JSON.parse(
    JSON.stringify(publicChatMessage({ id: 'm', roomId: 'room-1', peerId: 'p', name: 'A', text: 'e', createdAt: 1 }))
  );
  assert.deepEqual((await call(app, 'PATCH', `/api/rooms/room-1/chat/${UUID_A}`, { text: 'e' })).body, {
    ok: true,
    message: editedOnTheWire
  });
  assert.equal(seen.edit?.messageId, UUID_A);
  assert.deepEqual((await call(app, 'DELETE', `/api/rooms/room-1/chat/${UUID_A}`)).body, { ok: true, deleted: true });
  assert.deepEqual((await call(app, 'POST', '/api/rooms/room-1/read', { cursor: 'c' })).body, {
    ok: true,
    lastReadAt: 5,
    unreadCount: 0
  });
  assert.deepEqual(seen.read, { roomId: 'room-1', userId: 'user-1', cursor: 'c' });
});

test('chat refusals keep their texts, codes and headers', async (t) => {
  const cases: Array<[string, Partial<Outcomes>, number, object | null]> = [
    [
      'post',
      { post: { status: 'room_not_found' } },
      404,
      { ok: false, error: 'Room not found', code: 'room_not_found', roomId: 'room-1' }
    ],
    [
      'post',
      { post: { status: 'room_banned' } },
      403,
      { ok: false, error: 'Вы заблокированы в этой комнате', code: 'room_banned', roomId: 'room-1' }
    ],
    [
      'post',
      { post: { status: 'invalid_session' } },
      403,
      { ok: false, error: 'Invalid peer session', code: 'invalid_session' }
    ],
    ['post', { post: { status: 'empty' } }, 400, { ok: false, error: 'Invalid chat message', code: 'invalid_message' }],
    [
      'post',
      { post: { status: 'invalid_mention', code: 'self_mention' } },
      422,
      { ok: false, error: 'Invalid mention target', code: 'self_mention' }
    ],
    [
      'post',
      { post: { status: 'invalid_content' } },
      400,
      { ok: false, error: 'Invalid message content', code: 'invalid_message_content' }
    ],
    [
      'post',
      { post: { status: 'invalid_attachments' } },
      400,
      { ok: false, error: 'Invalid attachments', code: 'invalid_attachments' }
    ],
    [
      'post',
      { post: { status: 'reply_unavailable' } },
      409,
      { ok: false, error: 'Reply target is unavailable', code: 'reply_unavailable' }
    ],
    [
      'post',
      { post: { status: 'presence_required' } },
      403,
      { ok: false, error: 'Active room presence or login required', code: 'presence_or_login_required' }
    ],
    [
      'post',
      { post: { status: 'media_unavailable' } },
      503,
      { ok: false, error: 'Media uploads are unavailable', code: 'media_uploads_disabled' }
    ],
    ['list', { list: { status: 'room_banned' } }, 403, null],
    [
      'edit',
      { edit: { status: 'message_not_found' } },
      404,
      { ok: false, error: 'Message not found', code: 'message_not_found' }
    ],
    [
      'edit',
      { edit: { status: 'not_author' } },
      403,
      { ok: false, error: 'Not allowed to edit this message', code: 'message_edit_forbidden' }
    ],
    [
      'remove',
      { remove: { status: 'not_allowed' } },
      403,
      { ok: false, error: 'Not allowed to delete this message', code: 'message_delete_forbidden' }
    ]
  ];
  const routes: Record<string, Route> = {
    post: ['POST', '/api/rooms/room-1/chat', { text: 'x' }],
    list: ['GET', '/api/rooms/room-1/chat'],
    edit: ['PATCH', '/api/rooms/room-1/chat/m1', { text: 'x' }],
    remove: ['DELETE', '/api/rooms/room-1/chat/m1']
  };
  for (const [action, outcomes, status, body] of cases) {
    const { app } = routeApp(t, outcomes);
    const route = routes[action];
    assert.ok(route);
    const response = await call(app, ...route);
    assert.equal(response.status, status, `${action} ${JSON.stringify(outcomes)}`);
    if (body) assert.deepEqual(response.body, body);
  }

  const { app } = routeApp(t, { post: { status: 'rate_limited', retryAfterSeconds: 4 } });
  const limited = await call(app, 'POST', '/api/rooms/room-1/chat', { text: 'x' });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers['retry-after'], '4');
  assert.deepEqual(limited.body, {
    ok: false,
    error: 'Too many chat messages',
    code: 'message_rate_limited',
    retryAfterSeconds: 4
  });
});

test('marking read needs a session and a room', async (t) => {
  assert.deepEqual(
    await call(routeApp(t).app, 'POST', '/api/rooms/room-1/read', {}).then((r) => [r.status, r.body.error]),
    [401, 'Требуется вход']
  );
  const signedIn = routeApp(t, {}, { user: ACCOUNT });
  assert.equal((await call(signedIn.app, 'POST', '/api/rooms/%20/read')).status, 404);
  const gone = routeApp(t, { markRead: { status: 'room_not_found' } }, { user: ACCOUNT });
  assert.equal((await call(gone.app, 'POST', '/api/rooms/room-1/read', {})).status, 404);
});

test('a failing read store answers 500 without its text; a bad cursor still answers 400', async (t) => {
  const codec = createCursorCodec({ keys: ['m'.repeat(32)] });
  const cursor = codec.encode({
    purpose: 'room-read',
    context: 'room:room-1',
    tuple: { createdAtMicros: '9', id: 'm9' }
  });
  // What pg throws when the read table is unreachable: no statusCode, and a
  // message that names the schema.
  const storeDown = Object.assign(new Error('relation "room_read_states" does not exist'), { code: '42P01' });
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
      authorizeRoomRead: async () => true,
      cursorCodec: codec,
      repository: fake<MessageReadRepository>({
        async advanceRoom() {
          throw storeDown;
        }
      })
    })
  });
  registerRoomChatRoutes(
    app,
    {
      logger: fake<ApiContext['logger']>(),
      clientIp: () => '203.0.113.1',
      resolveSession: async () => ({ user: storedUser(ACCOUNT) }),
      hashIp: (ip: string) => ip
    },
    service
  );
  t.after(() => app.close());

  const down = await call(app, 'POST', '/api/rooms/room-1/read', { cursor });
  assert.deepEqual(
    [down.status, down.body],
    [500, { ok: false, error: 'Internal server error', code: 'internal_error' }]
  );
  assert.deepEqual(failures, [storeDown], 'the central handler logs the store failure');

  const bad = await call(app, 'POST', '/api/rooms/room-1/read', { cursor: 'not-a-cursor' });
  assert.deepEqual(
    [bad.status, bad.body],
    [400, { ok: false, error: 'Invalid read cursor', code: 'invalid_read_cursor' }]
  );
});

test('a reply target that vanishes during the send answers 409 reply_unavailable', async (t) => {
  const app = fastify();
  registerHttpKit(app, { securityHeaders: () => ({}), recordRequest() {}, logRequest() {}, logHandlerFailure() {} });
  const { service } = harness({ replyTargetGone: true });
  registerRoomChatRoutes(
    app,
    {
      logger: fake<ApiContext['logger']>(),
      clientIp: () => '203.0.113.1',
      resolveSession: async () => ({ user: storedUser(ACCOUNT) }),
      hashIp: (ip: string) => ip
    },
    service
  );
  t.after(() => app.close());

  const vanished = await call(app, 'POST', '/api/rooms/room-1/chat', { text: 'hi', replyTo: { messageId: UUID_A } });
  assert.deepEqual(
    [vanished.status, vanished.body],
    [409, { ok: false, error: 'Reply target is unavailable', code: 'reply_unavailable' }]
  );
});
