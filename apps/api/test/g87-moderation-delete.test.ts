// An owner deleting a room message: the tombstone, the attachment denial and
// the cleanup intent commit together, and only then is the deletion published.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createMessageModerationService } from '../src/domains/moderation/message-moderation-service.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';

const skip = !process.env.TEST_DATABASE_URL;

async function harness(t: TestContext, { failCleanup = false } = {}) {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: { log() {}, info() {}, warn() {}, error() {} } });
  await pool.query(`
    INSERT INTO rooms (id, is_static) VALUES ('room', true);
    INSERT INTO room_messages (id, room_id, text) VALUES ('message', 'room', 'spam')`);
  const committed = async () => {
    const row = await pool.query<{ deleted: boolean }>(`SELECT deleted_at IS NOT NULL AS deleted FROM room_messages`);
    return row.rows[0]?.deleted;
  };
  const events: string[] = [];
  const service = createMessageModerationService({
    pool,
    moderationService: {
      async authorizeOwner() {
        return true;
      }
    },
    attachmentRepository: {
      async revokeForRoomMessage() {
        events.push('attachments-revoked');
        return [{ id: 'attachment' }];
      }
    },
    mediaJobRepository: {
      async enqueueCleanupForRoomMessage() {
        events.push(`cleanup-enqueued, tombstone committed: ${String(await committed())}`);
        if (failCleanup) throw new Error('queue unavailable');
      }
    },
    async publishMessageDeleted() {
      events.push(`published, tombstone committed: ${String(await committed())}`);
    },
    now: () => 1234
  });
  return { events, service, committed };
}

test('G87-A01 tombstone, attachment denial and cleanup intent commit before publication', { skip }, async (t) => {
  const { events, service } = await harness(t);
  const result = await service.deleteRoomMessage({ roomId: 'room', messageId: 'message', actorUserId: 'owner' });
  assert.equal(result.status, 'deleted');
  assert.deepEqual(result.deletion, { roomId: 'room', messageId: 'message', deletedAt: 1234 });
  assert.deepEqual(events, [
    'attachments-revoked',
    'cleanup-enqueued, tombstone committed: false',
    'published, tombstone committed: true'
  ]);
  assert.equal(
    (await service.deleteRoomMessage({ roomId: 'room', messageId: 'message', actorUserId: 'owner' })).status,
    'already_deleted'
  );
  assert.equal(
    (await service.deleteRoomMessage({ roomId: 'room', messageId: 'missing', actorUserId: 'owner' })).status,
    'not_found'
  );
});

test('G87-A02 cleanup failure rolls back and emits no deletion event', { skip }, async (t) => {
  const { events, service, committed } = await harness(t, { failCleanup: true });
  await assert.rejects(
    service.deleteRoomMessage({ roomId: 'room', messageId: 'message', actorUserId: 'owner' }),
    /queue unavailable/
  );
  assert.equal(await committed(), false, 'the tombstone rolled back');
  assert.equal(
    events.some((event) => event.startsWith('published')),
    false
  );
});
