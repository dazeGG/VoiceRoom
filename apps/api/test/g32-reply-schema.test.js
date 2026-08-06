'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { projectReplyPreview, projectReplyTombstone, requireReplyTarget } = require('../src/domains/messaging/reply-projector');

test('G32-A01 reply projection is non-recursive and terminal states tombstone', async () => {
  const preview = projectReplyPreview({ id: 'reply', text: ' child ', replyTo: { messageId: 'root' }, replyPreview: { messageId: 'root' } });
  assert.deepEqual(preview, { messageId: 'reply', deleted: false, text: 'child' });
  assert.deepEqual(projectReplyTombstone('gone'), { messageId: 'gone', deleted: true, text: 'Сообщение недоступно' });
  await assert.rejects(requireReplyTarget({ message: { id: 'invite', metadata: { kind: 'room-invite' } }, visibility: true }), { code: 'reply_target_unavailable', statusCode: 409 });
});

test('G32-A02 schema keeps immutable pointers without purge-cascade foreign keys', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/migrations/20260718123000_add_message_replies.js'), 'utf8');
  assert.match(source, /reply_to_message_id is immutable/);
  assert.match(source, /BEFORE UPDATE OF reply_to_message_id/);
  assert.doesNotMatch(source, /references|ON DELETE CASCADE/i);
  assert.match(source, /SET LOCAL lock_timeout = '5s'/);
});
