'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toWsAccountEvent } = require('../src/realtime/account-events');
const { legacyPeerMessageToWs } = require('../src/realtime/legacy-events');

test('account realtime maps DM delete events to the public websocket contract', () => {
  const event = toWsAccountEvent({
    type: 'dm.message.deleted',
    messageId: 'msg-1',
    peerUserId: 'user-2'
  });

  assert.equal(event.type, 'dm.message.deleted');
  assert.equal(event.payload.messageId, 'msg-1');
  assert.equal(event.payload.peerUserId, 'user-2');
});

test('account realtime maps ring invitations with their expiry', () => {
  const event = toWsAccountEvent({
    type: 'ring.incoming',
    fromUser: { id: 'user-1', displayName: 'Alice', login: 'alice' },
    room: { id: 'room-1', name: 'Daily', emoji: '' },
    expiresAt: 12345
  });

  assert.equal(event.type, 'ring.incoming');
  assert.equal(event.payload.fromUser.login, 'alice');
  assert.equal(event.payload.room.id, 'room-1');
  assert.equal(event.payload.expiresAt, 12345);
});

test('account realtime maps additive notification envelopes', () => {
  const dm = toWsAccountEvent({
    type: 'notification.dm.message',
    dedupeKey: 'dm:msg-1',
    peer: { id: 'user-1', displayName: 'Alice', login: 'alice', avatarColorKey: 'mint' },
    message: { id: 'msg-1', body: 'hello', createdAt: 123 }
  });
  assert.equal(dm.type, 'notification.dm.message');
  assert.equal(dm.payload.dedupeKey, 'dm:msg-1');
  assert.equal(dm.payload.peer.login, 'alice');
  assert.equal(dm.payload.message.body, 'hello');

  const room = toWsAccountEvent({
    type: 'notification.room.message',
    dedupeKey: 'room:room-1:message:msg-2',
    room: { roomId: 'room-1', name: 'Daily', emoji: '☕', avatarColorKey: 'sky' },
    sender: { id: 'user-2', displayName: 'Bob', login: 'bob', avatarColorKey: 'rose' },
    message: { id: 'msg-2', body: 'standup', createdAt: 456 }
  });
  assert.equal(room.type, 'notification.room.message');
  assert.equal(room.payload.room.name, 'Daily');
  assert.equal(room.payload.sender.login, 'bob');

  const request = toWsAccountEvent({
    type: 'notification.friend.request',
    dedupeKey: 'friend-request:req-1',
    requester: { id: 'user-3', displayName: 'Cara', login: 'cara', avatarColorKey: 'lime' },
    requestId: 'req-1'
  });
  assert.equal(request.type, 'notification.friend.request');
  assert.equal(request.payload.requestId, 'req-1');

  const accepted = toWsAccountEvent({
    type: 'notification.friend.accepted',
    dedupeKey: 'friend-accepted:user-3:user-4',
    user: { id: 'user-4', displayName: 'Dana', login: 'dana', avatarColorKey: 'gold' },
    context: { relationship: 'friend' }
  });
  assert.equal(accepted.type, 'notification.friend.accepted');
  assert.equal(accepted.payload.dedupeKey, 'friend-accepted:user-3:user-4');
  assert.equal(accepted.payload.context.relationship, 'friend');
});

test('room chat delete is not treated as a legacy peer event', () => {
  assert.equal(
    legacyPeerMessageToWs({ type: 'room.chat.deleted', payload: { roomId: 'room-1', messageId: 'msg-1' } }, 'room-1'),
    null
  );
});
