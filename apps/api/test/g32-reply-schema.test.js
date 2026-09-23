import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { projectReplyPreview, projectReplyTombstone, requireReplyTarget } from '../src/domains/messaging/reply-projector.js';

test('G32-A01 reply projection is non-recursive and terminal states tombstone', async () => {
  const preview = projectReplyPreview({ id: 'reply', text: ' child ', replyTo: { messageId: 'root' }, replyPreview: { messageId: 'root' } });
  assert.deepEqual(preview, { messageId: 'reply', deleted: false, text: 'child' });
  assert.deepEqual(projectReplyTombstone('gone'), { messageId: 'gone', deleted: true, text: 'Сообщение недоступно' });
  await assert.rejects(requireReplyTarget({ message: { id: 'invite', metadata: { kind: 'room-invite' } }, visibility: true }), { code: 'reply_target_unavailable', statusCode: 409 });
});

test('G32-A02 schema keeps immutable pointers without purge-cascade foreign keys', () => {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, '../src/migrations/20260718123000_add_message_replies.cjs'), 'utf8');
  assert.match(source, /reply_to_message_id is immutable/);
  assert.match(source, /BEFORE UPDATE OF reply_to_message_id/);
  assert.doesNotMatch(source, /references|ON DELETE CASCADE/i);
  const runner = fs.readFileSync(path.resolve(import.meta.dirname, '../src/lib/migrate.js'), 'utf8');
  assert.match(runner, /SET lock_timeout TO '\$\{LOCK_TIMEOUT_MS\}ms'/);
});
