import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from 'typebox/value';
import { FriendLastMessage } from '../src/contracts/social.ts';

test('friend previews accept the old shape and optional typed invitation metadata', () => {
  const legacy = { id: 'message', body: 'User text', createdAt: 1, fromMe: false };
  assert.equal(Value.Check(FriendLastMessage, legacy), true);
  assert.equal(
    Value.Check(FriendLastMessage, {
      ...legacy,
      invite: {
        roomId: 'room',
        roomName: 'Cuisine 🐈',
        status: 'pending',
        expiresAt: null
      }
    }),
    true
  );
  assert.equal(Value.Check(FriendLastMessage, { ...legacy, invite: { roomName: 'incomplete' } }), false);
  assert.equal(Value.Check(FriendLastMessage, { ...legacy, invite: null }), false);
});
