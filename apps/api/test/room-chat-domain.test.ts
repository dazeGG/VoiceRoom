// Branch-by-branch proofs for the room chat (domains/messaging/room-chat.*):
// the list the room link grants, sending with every refusal in its original
// order, editing, deleting, marking read, and the HTTP answer each outcome
// becomes. Everything runs on fakes; the integration suites cover the store.

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
import { registerHttpKit } from '../src/platform/http/http-kit.ts';
import { fake, recordingLogger } from './fakes/index.ts';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const TOKEN = 't'.repeat(32);
const ACCOUNT = {
  id: 'user-1',
  displayName: 'Alice',
  avatarColorKey: 'teal',
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

// A field of an outcome union, read without narrowing it to one member first.
function fieldOf(outcome: object, key: string) {
  return (outcome as Record<string, unknown>)[key];
}

// The stores hand the unit-of-work callbacks a transaction marker, not a client.
const transactionMarker = (name: string) => ({ transaction: name }) as never;

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
    attachments: [1],
    linkPreview: { url: 'u' }
  });
  assert.equal(full.avatarUrl, '/x');
  assert.equal(full.avatarColorKey, 'blue');
  assert.deepEqual(full.attachments, [1]);
  assert.equal(publicChatMessage({ id: 'm', peerId: 'p' } as RoomChatMessage).avatarUrl, null);
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
  features?: Partial<Record<'engagement' | 'replies' | 'mediaUploads', boolean>>;
  notifications?: null;
  retireFails?: boolean;
  noMarkRoomRead?: boolean;
  delivery?: false;
  replay?: boolean;
  readError?: Error;
  ban?: (userId: string | null | undefined, ip: string) => boolean;
  rate?: { allowed: boolean; retryAfterSeconds?: number };
  findUserFails?: boolean;
  media?: null;
  directEmit?: boolean;
};

function harness(options: HarnessOptions = {}) {
  const logger = recordingLogger();
  const logged = (level: string) =>
    logger.records.filter((record) => record.level === level).map((record) => record.evt);
  const calls = {
    lockedIn: '',
    appended: [] as Parameters<RoomMessages['appendMessage']>[1][],
    edited: [] as string[],
    deleted: [] as string[],
    detail: [] as Array<{ type?: string }>,
    pins: [] as string[],
    previews: [] as unknown[],
    emitted: [] as string[],
    summaries: [] as string[],
    retired: [] as Array<{ through?: unknown }>,
    addressed: [] as Array<Record<string, unknown>>,
    outbox: [] as Array<{ type?: string; message?: RoomChatMessage }>,
    bound: [] as Array<{ attachmentIds?: unknown }>,
    completed: [] as unknown[],
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
        replyTo: input.replyToMessageId ? { messageId: input.replyToMessageId } : undefined
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
        : { ...((options.messages || {})[messageId] as RoomChatMessage), text, editedAt: 9 };
    },
    async markRoomChatRead() {
      return options.lastReadAt === undefined ? 5 : options.lastReadAt;
    }
  };
  const features: Record<'engagement' | 'replies' | 'mediaUploads', boolean> = {
    engagement: true,
    replies: true,
    mediaUploads: true,
    ...(options.features || {})
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
                }),
            ...(options.noMarkRoomRead ? { markRoomRead: undefined } : {})
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
                    response: {
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
    readService: () => ({
      async advanceRoom(input) {
        if (options.readError) throw options.readError;
        return { readThrough: 77, cursor: input.cursor };
      }
    }),
    getRoom: async () => currentRoom,
    findRoomBan: async (_roomId, userId, ip) => (options.ban ? options.ban(userId, ip) : false),
    feature: (name) => features[name],
    prepareContent: ({ content, text }) => {
      if (content === 'broken') throw new Error('bad content');
      return { content, text: text || 'from content' };
    },
    mentionUserIds: (content) =>
      content === 'bad-mention'
        ? { ok: false, code: 'mention_not_member' }
        : { ok: true, userIds: content === 'mention' ? ['user-2'] : [] },
    limiter: { check: () => options.rate || { allowed: true } },
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
              }
            }
          },
    replies: () => ({
      async lockRoomTarget(input) {
        calls.lockedIn = (input.client as unknown as { transaction: string }).transaction;
        return { id: UUID_A, text: 'target', authorUserId: 'user-3', createdAt: Date.now() };
      }
    }),
    notifications: () => notifications,
    delivery: () => delivery,
    projectMedia: async (_context, message) => ({ ...message, attachments: [] }),
    projectReply: async (_context, message) =>
      message.replyTo ? { ...message, replyPreview: { projected: true } } : message,
    identity: {
      chatPeerId: (user) => `auth-${user?.id}`,
      avatarColorKey: (user) => user?.avatarColorKey || '',
      displayName: (user) => (user ? user.displayName || '' : '')
    },
    directEmit: options.directEmit ?? true,
    broadcastChatMessage: (_roomId, message) => calls.emitted.push(message.id),
    broadcastRoomDetail: (_roomId, event) => calls.detail.push(event),
    roomDetailEvent: (type, payload) => ({ type, payload }),
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
    stored: [{ id: 'a' }, { id: 'b', replyTo: { messageId: UUID_A } }] as RoomChatMessage[]
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
    [{ features: { engagement: false } }, { content: 'x' }, 'structured_unavailable'],
    [{}, { content: 'broken' }, 'invalid_content'],
    [{}, { content: 'bad-mention' }, 'invalid_mention'],
    [{ room: null }, {}, 'room_not_found'],
    [{ ban: () => true }, {}, 'room_banned'],
    [{}, { attachmentIds: ['bad'] }, 'invalid_attachments'],
    [{}, { replyTo: {}, replyToMessageId: '' }, 'reply_unavailable'],
    [
      { features: { replies: false } },
      { replyTo: { messageId: UUID_A }, replyToMessageId: UUID_A },
      'reply_unavailable'
    ],
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
    [{ features: { mediaUploads: false } }, { user: ACCOUNT, attachmentIds: [UUID_A] }, 'media_unavailable'],
    [{ appendResult: null }, { user: ACCOUNT }, 'empty']
  ];
  for (const [options, input, status] of cases) {
    const result = await harness(options).service.post({ ...postBase, ...input });
    assert.equal(result.status, status, JSON.stringify(input));
  }
  const mention = await harness().service.post({ ...postBase, content: 'bad-mention' });
  assert.equal(fieldOf(mention, 'code'), 'mention_not_member');
  const limited = await harness({ rate: { allowed: false, retryAfterSeconds: 3 } }).service.post(postBase);
  assert.equal(fieldOf(limited, 'retryAfterSeconds'), 3);
  assert.equal(fieldOf(await harness({ rate: { allowed: false } }).service.post(postBase), 'retryAfterSeconds'), 0);
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

test('an idempotent replay answers the stored message without broadcasting again', async () => {
  const { calls, service } = harness({ replay: true });
  const replay = await service.post({ ...postBase, user: ACCOUNT, idempotencyKey: 'idem-key-1' });
  assert.equal(replay.status, 'created');
  assert.equal(replay.message.id, 'old');
  assert.deepEqual(replay.message.replyPreview, { projected: true });
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

  const bad = await harness({
    readError: Object.assign(new Error('Stale cursor'), { statusCode: 409, code: 'stale_cursor' })
  }).service.markRead('room-1', 'user-1', 'c');
  assert.deepEqual(bad, { status: 'invalid_cursor', statusCode: 409, code: 'stale_cursor', error: 'Stale cursor' });
  assert.deepEqual(await harness({ readError: new Error() }).service.markRead('room-1', 'user-1', 'c'), {
    status: 'invalid_cursor',
    statusCode: 400,
    code: 'invalid_read_cursor',
    error: 'invalid_read_cursor'
  });

  // Retiring is best effort and a missing inbox is a quiet no-op.
  const failing = harness({ retireFails: true });
  assert.equal((await failing.service.markRead('room-1', 'user-1', '')).status, 'read');
  assert.equal(failing.calls.errors.length, 1);
  assert.equal((await harness({ notifications: null }).service.markRead('room-1', 'user-1', '')).status, 'read');
  assert.equal((await harness({ noMarkRoomRead: true }).service.markRead('room-1', 'user-1', '')).status, 'read');
});

// --- routes ------------------------------------------------------------------------

function routeApp(
  t: TestContext,
  outcomes: Record<string, unknown> = {},
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
    async list(roomId: string, caller: { user?: { id: string } | null }) {
      seen.list = caller;
      return (
        outcomes.list || {
          status: 'listed',
          messages: [{ id: 'm', roomId, peerId: 'p', name: 'A', text: 't', createdAt: 1 }]
        }
      );
    },
    async post(input: PostInput) {
      seen.post = input;
      return (
        outcomes.post || {
          status: 'created',
          message: { id: 'm', roomId: input.roomId, peerId: 'p', name: 'A', text: 't', createdAt: 1 }
        }
      );
    },
    async edit(input: { messageId: string }) {
      seen.edit = input;
      return outcomes.edit || { status: 'edited', message: { id: 'm', text: 'e' } };
    },
    async remove(input: unknown) {
      seen.remove = input;
      return outcomes.remove || { status: 'deleted' };
    },
    async markRead(roomId: string, userId: string, cursor: unknown) {
      seen.read = { roomId, userId, cursor };
      return outcomes.read || { status: 'read', result: { lastReadAt: 5, unreadCount: 0 } };
    }
  } as Partial<Record<keyof RoomChatService, unknown>> as Partial<RoomChatService>);
  registerRoomChatRoutes(
    app,
    {
      logger: fake<ApiContext['logger']>(),
      clientIp: () => '203.0.113.1',
      resolveSession: async () => (user ? { user } : null),
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

type Route = [string, string, object?];

async function call(
  app: FastifyInstance,
  method: string,
  url: string,
  payload?: object,
  headers: Record<string, string> = {}
) {
  const response = await app.inject({
    method: method as 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url,
    headers,
    ...(payload === undefined ? {} : { payload })
  });
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

  assert.deepEqual((await call(app, 'PATCH', `/api/rooms/room-1/chat/${UUID_A}`, { text: 'e' })).body, {
    ok: true,
    message: { id: 'm', text: 'e' }
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
  const cases: Array<[string, { status: string; code?: string }, number, object | null]> = [
    ['post', { status: 'room_not_found' }, 404, { ok: false, error: 'Room not found', roomId: 'room-1' }],
    [
      'post',
      { status: 'room_banned' },
      403,
      { ok: false, error: 'Вы заблокированы в этой комнате', code: 'room_banned', roomId: 'room-1' }
    ],
    ['post', { status: 'invalid_session' }, 403, { ok: false, error: 'Invalid peer session' }],
    ['post', { status: 'empty' }, 400, { ok: false, error: 'Invalid chat message' }],
    ['post', { status: 'structured_unavailable' }, 409, { ok: false, error: 'Structured messages are unavailable' }],
    [
      'post',
      { status: 'invalid_mention', code: 'mention_x' },
      422,
      { ok: false, error: 'Invalid mention target', code: 'mention_x' }
    ],
    [
      'post',
      { status: 'invalid_content' },
      400,
      { ok: false, error: 'Invalid message content', code: 'invalid_message_content' }
    ],
    ['post', { status: 'invalid_attachments' }, 400, { ok: false, error: 'Invalid attachments' }],
    ['post', { status: 'reply_unavailable' }, 409, { ok: false, error: 'Reply target is unavailable' }],
    ['post', { status: 'presence_required' }, 403, { ok: false, error: 'Active room presence or login required' }],
    ['post', { status: 'media_unavailable' }, 503, { ok: false, error: 'Media uploads are unavailable' }],
    ['list', { status: 'room_banned' }, 403, null],
    ['edit', { status: 'message_not_found' }, 404, { ok: false, error: 'Message not found' }],
    ['edit', { status: 'not_author' }, 403, { ok: false, error: 'Not allowed to edit this message' }],
    ['remove', { status: 'not_allowed' }, 403, { ok: false, error: 'Not allowed to delete this message' }]
  ];
  const routes: Record<string, Route> = {
    post: ['POST', '/api/rooms/room-1/chat', { text: 'x' }],
    list: ['GET', '/api/rooms/room-1/chat'],
    edit: ['PATCH', '/api/rooms/room-1/chat/m1', { text: 'x' }],
    remove: ['DELETE', '/api/rooms/room-1/chat/m1']
  };
  for (const [action, outcome, status, body] of cases) {
    const { app } = routeApp(t, { [action]: outcome });
    const route = routes[action];
    assert.ok(route);
    const response = await call(app, ...route);
    assert.equal(response.status, status, `${action} ${outcome.status}`);
    if (body) assert.deepEqual(response.body, body);
  }

  const { app } = routeApp(t, { post: { status: 'rate_limited', retryAfterSeconds: 4 } });
  const limited = await call(app, 'POST', '/api/rooms/room-1/chat', { text: 'x' });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers['retry-after'], '4');
  assert.deepEqual(limited.body, { ok: false, error: 'Too many chat messages', retryAfterSeconds: 4 });
});

test('marking read needs a session, a room and a usable cursor', async (t) => {
  assert.deepEqual(
    await call(routeApp(t).app, 'POST', '/api/rooms/room-1/read', {}).then((r) => [r.status, r.body.error]),
    [401, 'Требуется вход']
  );
  const signedIn = routeApp(t, {}, { user: ACCOUNT });
  assert.equal((await call(signedIn.app, 'POST', '/api/rooms/%20/read')).status, 404);
  const gone = routeApp(t, { read: { status: 'room_not_found' } }, { user: ACCOUNT });
  assert.equal((await call(gone.app, 'POST', '/api/rooms/room-1/read', {})).status, 404);
  const stale = routeApp(
    t,
    { read: { status: 'invalid_cursor', statusCode: 409, code: 'stale_cursor', error: 'Stale cursor' } },
    { user: ACCOUNT }
  );
  assert.deepEqual(
    await call(stale.app, 'POST', '/api/rooms/room-1/read', { cursor: 'c' }).then((r) => [r.status, r.body]),
    [409, { ok: false, error: 'Stale cursor', code: 'stale_cursor' }]
  );
});
