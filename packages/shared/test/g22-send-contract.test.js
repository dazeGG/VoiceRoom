'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const send = require('../src/messaging-send');

test('G22-A01 reply pointers allow reply-to-reply while previews stay one level', () => {
  assert.deepEqual(send.normalizeReplyPointer({ messageId: 'reply', replyTo: { messageId: 'root' } }), { messageId: 'reply' });
  assert.deepEqual(send.normalizeReplyPreview({ messageId: 'reply', text: 'ok', replyPreview: { messageId: 'root' } }), { messageId: 'reply', deleted: false, author: undefined, text: 'ok' });
  assert.equal(send.normalizeReplyPointer({ messageId: 'system', content: { type: 'system' } }), null);
});

test('G22-A02 account, guest and DM idempotency identities are bounded and context-scoped', () => {
  const account = send.normalizeIdempotency({ key: '12345678', fingerprint: 'fp', actorType: 'account', actorId: 'u', conversation: { type: 'room', id: 'r' } });
  const guest = send.normalizeIdempotency({ key: 'abcdefgh', fingerprint: 'fp', actorType: 'guest', actorId: 'p', conversation: { type: 'room', id: 'r' } });
  const dm = send.normalizeIdempotency({ key: 'abcdefgh', fingerprint: 'fp', actorType: 'account', actorId: 'u', conversation: { type: 'dm', id: 'v' } });
  assert.equal(account.actorType, 'account'); assert.equal(guest.actorType, 'guest'); assert.equal(dm.conversation.type, 'dm');
  assert.equal(send.normalizeIdempotency({ key: 'short', fingerprint: 'fp', actorType: 'account', actorId: 'u', conversation: { type: 'room', id: 'r' } }), null);
});
