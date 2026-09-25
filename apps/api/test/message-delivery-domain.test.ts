// Branch-by-branch proofs for message projection, the durable delivery relay,
// push and DM notification dispatch, and link preview events.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createMessageProjection, publicAttachment } from '../src/domains/messaging/message-projection.ts';
import { createMessageDeliveryRelay } from '../src/domains/messaging/message-delivery-relay.ts';
import { createNotificationDispatch } from '../src/domains/notifications/notification-dispatch.ts';
import {
  createLinkPreviewEvents,
  type LinkPreviewEventsDeps
} from '../src/domains/link-previews/link-preview-events.ts';
import { fake, recordingLogger } from './fakes/index.ts';

type Sent = { userId: string; payload: Record<string, unknown>; context: Record<string, unknown> };
const idOf = (message: unknown) => (message as { id?: string }).id;

const ATTACHMENT = {
  id: 'a1',
  context: 'room',
  order: 0,
  mimeType: 'image/webp',
  processedBytes: 10,
  originalBytes: 20,
  width: 1,
  height: 2,
  state: 'ready',
  ownerId: 'secret'
};

function projection({ attachments = true, replies = true } = {}) {
  const calls: unknown[] = [];
  return {
    calls,
    projection: createMessageProjection({
      attachments: () =>
        attachments
          ? {
              async listForMessage(context, id) {
                calls.push(['list', context, id]);
                return [ATTACHMENT, { ...ATTACHMENT, id: 'a2', state: 'processing', processedBytes: 0 }];
              }
            }
          : null,
      replies: () =>
        replies
          ? {
              async getRoomPreview(input) {
                calls.push(['room', input]);
                return { quoted: 'room' };
              },
              async getDirectPreview(input) {
                calls.push(['dm', input]);
                return { quoted: 'dm' };
              }
            }
          : null
    })
  };
}

test('attachments keep only public fields', () => {
  const shape = publicAttachment(ATTACHMENT);
  assert.equal('ownerId' in shape, false);
  assert.equal(shape.bytes, 10);
  assert.equal(shape.url, '/api/media/attachments/a1/preview');
  assert.equal(publicAttachment({ ...ATTACHMENT, state: 'failed', processedBytes: 0 }).url, null);
  assert.equal(publicAttachment({ ...ATTACHMENT, processedBytes: 0 }).bytes, 20);
});

test('projection adds attachments and the reply quote', async () => {
  const { calls, projection: p } = projection();
  const room = await p.project('room', { id: 'm1', replyTo: { messageId: 'm0' } }, { roomId: 'r1' });
  assert.deepEqual(
    room.attachments.map((a) => a.url),
    ['/api/media/attachments/a1/preview', null]
  );
  assert.deepEqual((room as { replyPreview?: unknown }).replyPreview, { quoted: 'room' });
  const dm = await p.project('dm', { id: 'm2', replyTo: { messageId: 'm0' } }, { userId: 'u1', peerId: 'u2' });
  assert.deepEqual((dm as { replyPreview?: unknown }).replyPreview, { quoted: 'dm' });
  assert.deepEqual(calls.at(-1), ['dm', { userId: 'u1', peerId: 'u2', messageId: 'm0' }]);
  assert.deepEqual((await p.projectMedia('room', {})).attachments, []);
  const plain: { id: string; replyTo?: null } = { id: 'm3' };
  assert.equal(await p.projectReply('room', plain), plain);
  assert.equal(await p.projectReply('room', null as never), null);

  const offline = projection({ attachments: false, replies: false }).projection;
  assert.deepEqual((await offline.projectMedia('room', { id: 'm' })).attachments, []);
  const replying = { id: 'm', replyTo: { messageId: 'x' } };
  assert.equal(await offline.projectReply('room', replying), replying);
});

// --- relay ------------------------------------------------------------------------

type RelayOptions = {
  enabled?: boolean;
  pool?: boolean;
  outbox?: boolean;
  findUserFails?: boolean;
  event?: unknown;
};

function relayHarness({
  enabled = true,
  pool = true,
  outbox = true,
  findUserFails = false,
  event = null
}: RelayOptions = {}) {
  const calls = {
    chat: [] as unknown[],
    events: [] as unknown[],
    dm: [] as unknown[],
    errors: [] as unknown[],
    queries: [] as string[],
    released: 0,
    failUnlisten: false
  };
  const logger = recordingLogger();
  const client = Object.assign(new EventEmitter(), {
    async query(sql: string) {
      calls.queries.push(sql);
      if (sql.startsWith('UNLISTEN') && calls.failUnlisten) throw new Error('gone');
    },
    release() {
      calls.released += 1;
    }
  });
  const relay = createMessageDeliveryRelay({
    enabled,
    pool: () =>
      pool
        ? {
            async connect() {
              return client;
            }
          }
        : null,
    outbox: () =>
      outbox
        ? {
            async getEvent(id) {
              if (id === 'broken') throw new Error('db');
              return id === 'e1' ? { payload: event } : null;
            }
          }
        : null,
    projection: projection().projection,
    broadcastChatMessage: (roomId, message) => calls.chat.push([roomId, idOf(message)]),
    notifyUser: (userId, event) => calls.events.push([userId, event.type]),
    findUser: async (userId) => {
      if (findUserFails) throw new Error('users');
      return { id: userId };
    },
    broadcastDmNotification: async (recipientId, sender) => {
      calls.dm.push([recipientId, sender.id]);
    },
    publicChatMessage: (message) => ({ id: idOf(message), public: true }),
    logger: () => logger
  });
  const errors = () => logger.records.map((record) => record.evt);
  return { calls, client, errors, relay };
}

test('relayed room and DM messages reach sockets and raise the DM notification', async () => {
  const { calls, relay } = relayHarness();
  await relay.dispatch(null);
  await relay.dispatch({ type: 'message.deleted', message: {} });
  await relay.dispatch({ type: 'message.created' });
  await relay.dispatch({ type: 'message.created', conversation: { type: 'other' }, message: {} });
  await relay.dispatch({ type: 'message.created', conversation: { type: 'room', id: 'r1' }, message: { id: 'm1' } });
  assert.deepEqual(calls.chat, [['r1', 'm1']]);
  await relay.dispatch({
    type: 'message.created',
    conversation: { type: 'dm', id: 'u2' },
    message: { id: 'm2', senderId: 'u1', recipientId: 'u2' }
  });
  await relay.dispatch({
    type: 'message.created',
    conversation: { type: 'dm', id: 'u1' },
    message: { id: 'm3', senderId: 'u1', recipientId: 'u2' }
  });
  assert.deepEqual(calls.events, [
    ['u1', 'dm-message'],
    ['u2', 'dm-message'],
    ['u1', 'dm-message'],
    ['u2', 'dm-message']
  ]);
  assert.deepEqual(calls.dm, [
    ['u2', 'u1'],
    ['u2', 'u1']
  ]);

  const noSender = relayHarness({ findUserFails: true });
  await noSender.relay.dispatch({
    type: 'message.created',
    conversation: { type: 'dm', id: 'u2' },
    message: { id: 'm', senderId: 'u1', recipientId: 'u2' }
  });
  assert.deepEqual(noSender.calls.dm, []);
});

test('the listener LISTENs once, dispatches notified outbox events and cleans up', async () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
  const { calls, client, errors, relay } = relayHarness({
    event: { type: 'message.created', conversation: { type: 'room', id: 'r1' }, message: { id: 'm1' } }
  });
  await relay.start();
  await relay.start();
  assert.deepEqual(calls.queries, ['LISTEN voice_room_message_delivery']);
  client.emit('notification', { channel: 'other', payload: '{"eventId":"e1"}' });
  client.emit('notification', { channel: 'voice_room_message_delivery', payload: '{"eventId":"e1"}' });
  client.emit('notification', { channel: 'voice_room_message_delivery', payload: '{}' });
  client.emit('notification', { channel: 'voice_room_message_delivery' });
  client.emit('notification', { channel: 'voice_room_message_delivery', payload: '{"eventId":"missing"}' });
  client.emit('notification', { channel: 'voice_room_message_delivery', payload: '{"eventId":"broken"}' });
  client.emit('notification', { channel: 'voice_room_message_delivery', payload: 'not json' });
  client.emit('error', new Error('socket'));
  await settle();
  assert.deepEqual(calls.chat, [['r1', 'm1']]);
  assert.deepEqual(
    errors().sort(),
    ['msg.event_dispatch_failed', 'msg.event_dispatch_failed', 'msg.listener_failed'].sort()
  );
  calls.failUnlisten = true;
  await relay.stop();
  await relay.stop();
  assert.equal(calls.released, 1);
  assert.equal(client.listenerCount('notification'), 0);
});

test('the listener stays off when disabled or without a pool or outbox', async () => {
  for (const options of [{ enabled: false }, { pool: false }, { outbox: false }]) {
    const { calls, relay } = relayHarness(options);
    await relay.start();
    assert.deepEqual(calls.queries, []);
  }
});

// --- notification dispatch ------------------------------------------------------------

function dispatchHarness({ enabled = true, preferences = {}, sendFails = false, preferencesFail = false } = {}) {
  const calls = { sent: [] as Sent[], events: [] as unknown[], warnings: [] as unknown[], errors: [] as unknown[] };
  const dispatch = createNotificationDispatch({
    push: () => ({
      config: { enabled },
      async sendToUser(userId, payload, context) {
        if (sendFails) throw new Error('push');
        calls.sent.push({ userId, payload, context });
      }
    }),
    preferences: async () => {
      if (preferencesFail) throw new Error('prefs');
      return { mutedPeerIds: [], mutedRoomIds: [], doNotDisturb: false, ...preferences };
    },
    notifyUser: (userId, event) => {
      calls.events.push([userId, event.type]);
      return 2;
    },
    logger: () => ({
      warn: (fields: { evt?: string }) => calls.warnings.push(fields.evt),
      error: (fields: { evt?: string }) => calls.errors.push(fields.evt)
    })
  });
  return { calls, dispatch };
}

const PAYLOAD = { type: 't', title: 'T', body: 'public', privateBody: 'private' };

test('push respects the switch, preferences, private text and expiry', async () => {
  const off = dispatchHarness({ enabled: false });
  await off.dispatch.queuePush('u', PAYLOAD);
  assert.deepEqual(off.calls.sent, []);

  const dnd = dispatchHarness({ preferences: { doNotDisturb: true } });
  await dnd.dispatch.queuePush('u', PAYLOAD);
  assert.deepEqual(dnd.calls.sent, []);
  await dnd.dispatch.queuePush('u', PAYLOAD, { ignorePreferences: true });
  assert.equal(dnd.calls.sent.length, 1);

  const privacy = dispatchHarness({ preferences: { privateNotifications: true } });
  await privacy.dispatch.queuePush('u', PAYLOAD);
  assert.equal(privacy.calls.sent[0]?.payload.body, 'private');
  assert.equal('privateBody' in (privacy.calls.sent[0]?.payload ?? {}), false);
  await privacy.dispatch.queuePush('u', { type: 't', title: 'T', body: 'only public' });
  assert.equal(privacy.calls.sent[1]?.payload.body, 'only public');

  const expiring = dispatchHarness();
  await expiring.dispatch.queuePush('u', PAYLOAD, { expiresAt: Date.now() - 1000 });
  assert.equal(expiring.calls.sent.length, 0);
  await expiring.dispatch.queuePush('u', PAYLOAD, { expiresAt: Date.now() + 60_000 });
  assert.ok(Number(expiring.calls.sent[0]?.context.ttl) > 0);

  const failing = dispatchHarness({ sendFails: true });
  await failing.dispatch.queuePush('u', PAYLOAD);
  assert.deepEqual(failing.calls.warnings, ['push.send_failed']);
});

test('a DM notification skips self, muted senders and failures', async () => {
  const sender = { id: 's1', login: 'sam' };
  const message = { id: 'm1', body: 'hi', createdAt: 1 };
  const { calls, dispatch } = dispatchHarness();
  assert.equal(await dispatch.broadcastDmNotification('', sender, message), 0);
  assert.equal(await dispatch.broadcastDmNotification('s1', sender, message), 0);
  assert.equal(await dispatch.broadcastDmNotification('r1', null, message), 0);
  assert.equal(await dispatch.broadcastDmNotification('r1', sender, message), 2);
  assert.deepEqual(calls.events, [['r1', 'notification.dm.message']]);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(calls.sent[0]?.payload.title, 'sam');
  assert.deepEqual(calls.sent[0]?.context, { peerUserId: 's1' });
  await dispatch.broadcastDmNotification('r1', { id: 's1', displayName: 'Sam' }, message);
  await dispatch.broadcastDmNotification('r1', { id: 's1' }, message);

  const muted = dispatchHarness({ preferences: { mutedPeerIds: ['s1'] } });
  assert.equal(await muted.dispatch.broadcastDmNotification('r1', sender, message), 0);
  const broken = dispatchHarness({ preferencesFail: true });
  assert.equal(await broken.dispatch.broadcastDmNotification('r1', sender, message), 0);
  assert.deepEqual(broken.calls.errors, ['notify.broadcast_failed']);
});

// --- link preview events --------------------------------------------------------------

test('link previews are scheduled only when a link may be affected and arrive as edits', async () => {
  const calls: { scheduled: unknown[]; edits: unknown[]; events: unknown[] } = { scheduled: [], edits: [], events: [] };
  const events = createLinkPreviewEvents({
    previews: () => ({
      scheduleRoomMessage: (input) => calls.scheduled.push(['room', input.messageId]),
      scheduleDirectMessage: (input) => calls.scheduled.push(['dm', input.messageId])
    }),
    roomMessage: async (roomId, messageId) => (messageId === 'gone' ? null : { id: messageId }),
    directMessage: async (senderId, recipientId, messageId) => (messageId === 'gone' ? null : { id: messageId }),
    projection: projection().projection,
    publicChatMessage: (message) => ({ id: idOf(message) }),
    broadcastRoomEdit: (roomId, message) => calls.edits.push([roomId, idOf(message)]),
    notifyUser: (userId, event) => calls.events.push([userId, event.type])
  });
  events.scheduleRoomLinkPreview('r1', 'm1', 'no link here');
  events.scheduleRoomLinkPreview('r1', 'm2', 'see https://example.com');
  events.scheduleRoomLinkPreview('r1', 'm3', 'edited', { edited: true });
  events.scheduleDirectLinkPreview({ messageId: 'd1', senderId: 'a', recipientId: 'b', text: 'plain' });
  events.scheduleDirectLinkPreview({ messageId: 'd2', senderId: 'a', recipientId: 'b', text: 'https://example.com' });
  events.scheduleDirectLinkPreview({ messageId: 'd3', senderId: 'a', recipientId: 'b', text: '', edited: true });
  assert.deepEqual(calls.scheduled, [
    ['room', 'm2'],
    ['room', 'm3'],
    ['dm', 'd2'],
    ['dm', 'd3']
  ]);

  await events.broadcastRoomLinkPreview({ roomId: 'r1', messageId: 'gone' });
  await events.broadcastRoomLinkPreview({ roomId: 'r1', messageId: 'm2' });
  await events.broadcastDirectLinkPreview({ messageId: 'gone', senderId: 'a', recipientId: 'b' });
  await events.broadcastDirectLinkPreview({ messageId: 'd2', senderId: 'a', recipientId: 'b' });
  assert.deepEqual(calls.edits, [['r1', 'm2']]);
  assert.deepEqual(calls.events, [
    ['b', 'dm.message.edited'],
    ['a', 'dm.message.edited']
  ]);

  const disabled = createLinkPreviewEvents(fake<LinkPreviewEventsDeps>({ previews: () => null }));
  disabled.scheduleRoomLinkPreview('r1', 'm', 'https://example.com');
  disabled.scheduleDirectLinkPreview({ messageId: 'm', senderId: 'a', recipientId: 'b', text: 'https://example.com' });
});
