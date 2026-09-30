// The authorization rules the routes and the realtime paths share.

import test from 'node:test';
import assert from 'node:assert/strict';

import { isRoomOwner } from '../src/domains/rooms/room.policy.ts';
import { mayModerateRoomMessage, roomMessageAuthorship } from '../src/domains/messaging/room-message.policy.ts';
import { isDirectParticipant, isDirectSender } from '../src/domains/messaging/direct-message.policy.ts';
import { mayLeaveRoom } from '../src/domains/membership/membership.policy.ts';
import { ownsAttachment } from '../src/domains/media/attachment.policy.ts';

const persistent = { isStatic: true, ownerId: 'owner' };

test('only the owner of a persistent room owns it', () => {
  assert.equal(isRoomOwner(persistent, 'owner'), true);
  assert.equal(isRoomOwner(persistent, 'someone'), false);
  assert.equal(isRoomOwner({ isStatic: false, ownerId: 'owner' }, 'owner'), false, 'a temporary room has no owner');
  assert.equal(isRoomOwner({ isStatic: true, ownerId: null }, null), false);
  assert.equal(isRoomOwner(null, 'owner'), false);
});

test('a room message belongs to its account, or to its guest peer when no account wrote it', () => {
  const accountMessage = { authorUserId: 'ada', peerId: 'peer-1' };
  assert.equal(roomMessageAuthorship(accountMessage, { userId: 'ada' }), 'account');
  assert.equal(
    roomMessageAuthorship(accountMessage, { userId: 'eve', peerId: 'peer-1' }),
    null,
    "the peer id of an account's message proves nothing"
  );
  const guestMessage = { authorUserId: null, peerId: 'peer-2' };
  assert.equal(roomMessageAuthorship(guestMessage, { peerId: 'peer-2' }), 'peer');
  assert.equal(roomMessageAuthorship(guestMessage, { userId: 'ada', peerId: 'peer-3' }), null);
  assert.equal(roomMessageAuthorship(guestMessage, {}), null);

  assert.equal(mayModerateRoomMessage(persistent, 'owner'), true);
  assert.equal(mayModerateRoomMessage({ isStatic: false, ownerId: 'owner' }, 'owner'), false);
});

test('a direct message is seen by its two users and changed by its sender', () => {
  const message = { senderId: 'ada', recipientId: 'bob' };
  assert.deepEqual(
    ['ada', 'bob', 'eve', ''].map((userId) => isDirectParticipant(message, userId)),
    [true, true, false, false]
  );
  assert.deepEqual(
    ['ada', 'bob', null].map((userId) => isDirectSender(message, userId)),
    [true, false, false]
  );
});

test('an owner cannot leave the room, anyone else can', () => {
  assert.equal(mayLeaveRoom({ role: 'owner' }), false);
  assert.equal(mayLeaveRoom({ role: 'member' }), true);
  assert.equal(mayLeaveRoom(null), true, 'leaving without a membership is a no-op, not a refusal');
});

test('an attachment belongs to the account that uploaded it', () => {
  assert.equal(ownsAttachment({ ownerId: 'ada' }, 'ada'), true);
  assert.equal(ownsAttachment({ ownerId: 'ada' }, 'bob'), false);
  assert.equal(ownsAttachment(null, 'ada'), false);
  assert.equal(ownsAttachment({ ownerId: '' }, ''), false);
});
