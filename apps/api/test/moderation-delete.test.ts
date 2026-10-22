// An owner deleting a room message: the tombstone, the attachment denial and
// the cleanup intent commit together, and only then is the deletion published.
// The real attachment and media job repositories do the work, behind the exact
// ports the service declares, so the test runs the path production runs.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createAttachmentRepository } from '../src/domains/media/attachment.repository.ts';
import { createMediaJobRepository } from '../src/domains/media/media-job.repository.ts';
import {
  createMessageModerationService,
  type ModerationAttachments,
  type ModerationMediaJobs
} from '../src/domains/moderation/message-moderation.service.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';

const skip = !process.env.TEST_DATABASE_URL;
const OWNER = '11111111-1111-4111-8111-111111111111';
const ATTACHMENT = '22222222-2222-4222-8222-222222222222';

async function harness(t: TestContext, { failCleanup = false } = {}) {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: { log() {}, info() {}, warn() {}, error() {} } });
  await pool.query(`
    INSERT INTO users (id, login, display_name, password_hash) VALUES ('${OWNER}', 'owner', 'Owner', 'x');
    INSERT INTO rooms (id, is_static) VALUES ('room', true);
    INSERT INTO room_messages (id, room_id, text) VALUES ('message', 'room', 'spam');
    INSERT INTO message_attachments (id, owner_id, context, state, room_message_id, attachment_order, bound_at)
      VALUES ('${ATTACHMENT}', '${OWNER}', 'room', 'processing', 'message', 0, current_timestamp)`);
  const committed = async () => {
    const row = await pool.query<{ deleted: boolean }>(`SELECT deleted_at IS NOT NULL AS deleted FROM room_messages`);
    return row.rows[0]?.deleted;
  };
  const stored = async () => ({
    attachment: (await pool.query<{ state: string }>(`SELECT state FROM message_attachments`)).rows,
    jobs: (
      await pool.query<{ attachment_id: string; kind: string }>(`SELECT attachment_id, kind FROM media_processing_jobs`)
    ).rows
  });
  const events: string[] = [];
  const attachments = createAttachmentRepository({ pool });
  const jobs = createMediaJobRepository({ pool });
  const attachmentRepository: ModerationAttachments = {
    listForMessage: (...args) => attachments.listForMessage(...args),
    async markDeleted(id, client) {
      events.push(`attachment-revoked ${id}`);
      return attachments.markDeleted(id, client);
    }
  };
  const mediaJobRepository: ModerationMediaJobs = {
    async enqueue(id, options) {
      events.push(`cleanup-enqueued ${id}, tombstone committed: ${String(await committed())}`);
      if (failCleanup) throw new Error('queue unavailable');
      return jobs.enqueue(id, options);
    }
  };
  const service = createMessageModerationService({
    pool,
    moderationService: {
      async authorizeOwner() {
        return true;
      }
    },
    attachmentRepository,
    mediaJobRepository,
    async publishMessageDeleted() {
      events.push(`published, tombstone committed: ${String(await committed())}`);
    },
    now: () => 1234
  });
  return { events, service, committed, stored };
}

test('G87-A01 tombstone, attachment denial and cleanup intent commit before publication', { skip }, async (t) => {
  const { events, service, stored } = await harness(t);
  const result = await service.deleteRoomMessage({ roomId: 'room', messageId: 'message', actorUserId: 'owner' });
  assert.equal(result.status, 'deleted');
  assert.deepEqual(result.deletion, { roomId: 'room', messageId: 'message', deletedAt: 1234 });
  assert.deepEqual(events, [
    `attachment-revoked ${ATTACHMENT}`,
    `cleanup-enqueued ${ATTACHMENT}, tombstone committed: false`,
    'published, tombstone committed: true'
  ]);
  assert.deepEqual(await stored(), {
    attachment: [{ state: 'deleted' }],
    jobs: [{ attachment_id: ATTACHMENT, kind: 'cleanup' }]
  });
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
  const { events, service, committed, stored } = await harness(t, { failCleanup: true });
  await assert.rejects(
    service.deleteRoomMessage({ roomId: 'room', messageId: 'message', actorUserId: 'owner' }),
    /queue unavailable/
  );
  assert.equal(await committed(), false, 'the tombstone rolled back');
  assert.deepEqual(await stored(), { attachment: [{ state: 'processing' }], jobs: [] }, 'the denial rolled back');
  assert.equal(
    events.some((event) => event.startsWith('published')),
    false
  );
});
