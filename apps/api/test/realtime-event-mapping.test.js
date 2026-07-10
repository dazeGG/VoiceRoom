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

test('room chat delete is not treated as a legacy peer event', () => {
  assert.equal(
    legacyPeerMessageToWs({ type: 'room.chat.deleted', payload: { roomId: 'room-1', messageId: 'msg-1' } }, 'room-1'),
    null
  );
});
