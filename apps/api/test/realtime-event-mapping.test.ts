// In-process account and room messages become the public WebSocket events.

import test from 'node:test';
import assert from 'node:assert/strict';
import type { ServerEvents, ServerEventType } from '@voice-room/shared/contracts/realtime';
import type { ServerEnvelope } from '@voice-room/shared/realtime';
import { toWsAccountEvent } from '../src/realtime/account-events.ts';
import { legacyPeerMessageToWs } from '../src/realtime/legacy-events.ts';
import { notificationPreferences, storedDirectMessage } from './fakes/index.ts';

/** The payload of an event, after checking it is the event expected. */
function payloadOf<Type extends ServerEventType>(envelope: ServerEnvelope, type: Type): ServerEvents[Type] {
  assert.equal(envelope.type, type);
  return (envelope as { payload: unknown }).payload as ServerEvents[Type];
}

test('account realtime maps DM delete events to the public websocket contract', () => {
  const event = toWsAccountEvent({ type: 'dm.message.deleted', messageId: 'msg-1', peerUserId: 'user-2' });
  assert.deepEqual(payloadOf(event, 'dm.message.deleted'), { messageId: 'msg-1', peerUserId: 'user-2' });
});

test('account realtime maps DM edit events with the updated message', () => {
  const message = storedDirectMessage('msg-1', { senderId: 'user-1', recipientId: 'user-2', body: 'updated' });
  const event = toWsAccountEvent({ type: 'dm.message.edited', message });
  assert.deepEqual(payloadOf(event, 'dm.message.edited').message, message);
});

test('account realtime maps ring invitations with their expiry', () => {
  const event = toWsAccountEvent({
    type: 'ring.incoming',
    fromUser: { id: 'user-1', displayName: 'Alice', login: 'alice' },
    room: { id: 'room-1', name: 'Daily', emoji: '' },
    expiresAt: 12345
  });
  const payload = payloadOf(event, 'ring.incoming');
  assert.deepEqual([payload.fromUser.login, payload.room.id, payload.expiresAt], ['alice', 'room-1', 12345]);
});

test('account realtime maps additive notification envelopes', () => {
  const dm = toWsAccountEvent({
    type: 'notification.dm.message',
    dedupeKey: 'dm:msg-1',
    peer: { id: 'user-1', displayName: 'Alice', login: 'alice', avatarColorKey: 'mint' },
    message: { id: 'msg-1', body: 'hello', createdAt: 123 }
  });
  const dmPayload = payloadOf(dm, 'notification.dm.message');
  assert.deepEqual([dmPayload.dedupeKey, dmPayload.peer.login, dmPayload.message.body], ['dm:msg-1', 'alice', 'hello']);

  const room = toWsAccountEvent({
    type: 'notification.room.message',
    dedupeKey: 'room:room-1:message:msg-2',
    room: { roomId: 'room-1', name: 'Daily' },
    sender: { id: 'user-2', displayName: 'Bob', login: 'bob', avatarColorKey: 'rose' },
    message: { id: 'msg-2', body: 'standup', createdAt: 456 }
  });
  const roomPayload = payloadOf(room, 'notification.room.message');
  assert.deepEqual([roomPayload.room.name, roomPayload.sender.login], ['Daily', 'bob']);

  const request = toWsAccountEvent({
    type: 'notification.friend.request',
    dedupeKey: 'friend-request:req-1',
    requester: { id: 'user-3', displayName: 'Cara', login: 'cara', avatarColorKey: 'lime' },
    requestId: 'req-1'
  });
  assert.equal(payloadOf(request, 'notification.friend.request').requestId, 'req-1');

  const accepted = toWsAccountEvent({
    type: 'notification.friend.accepted',
    dedupeKey: 'friend-accepted:user-3:user-4',
    user: { id: 'user-4', displayName: 'Dana', login: 'dana', avatarColorKey: 'gold' },
    context: { relationship: 'friend' }
  });
  assert.deepEqual(payloadOf(accepted, 'notification.friend.accepted').context, { relationship: 'friend' });
});

test('account realtime maps notification settings updates for same-account tabs', () => {
  const preferences = notificationPreferences({ doNotDisturb: true, mutedPeerIds: ['user-2'], presenceStatus: 'dnd' });
  const event = toWsAccountEvent({ type: 'notification-settings-updated', preferences });
  assert.deepEqual(payloadOf(event, 'notification.settings.updated').preferences, preferences);
});

test('reaction updates map onto preview room subscriptions without losing the authoritative revision', () => {
  const summary = { emoji: '👍', count: 2, reactedByMe: false, revision: '7' };
  const event = legacyPeerMessageToWs(
    {
      type: 'reaction.updated',
      payload: { conversation: { type: 'room', id: 'room-1' }, roomId: 'room-1', messageId: 'msg-1', summary }
    },
    'room-1'
  );
  assert.deepEqual(payloadOf(event, 'reaction.updated'), {
    conversation: { type: 'room', id: 'room-1' },
    roomId: 'room-1',
    messageId: 'msg-1',
    summary
  });
});

test('moderation terminal events map on both account and active room transports', () => {
  for (const type of ['room.kicked', 'room.banned'] as const) {
    const account = toWsAccountEvent({ type, roomId: 'room-1', peerId: 'peer-1' });
    assert.deepEqual(payloadOf(account, type), { roomId: 'room-1', peerId: 'peer-1' });

    const active = legacyPeerMessageToWs({ type, roomId: 'room-1', peerId: 'peer-1' }, 'room-1');
    assert.deepEqual(payloadOf(active, type), { roomId: 'room-1', peerId: 'peer-1' });
  }
});
