'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMessageModerationService } = require('../src/domains/moderation/message-moderation-service');

function harness({ failCleanup = false } = {}) {
  const events = [];
  const client = {
    async query(sql) {
      events.push(sql);
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('SELECT id, room_id')) return { rows: [{ id: 'message', room_id: 'room', deleted_at: null }] };
      return { rows: [] };
    },
    release() { events.push('release'); }
  };
  const service = createMessageModerationService({
    pool: { async connect() { return client; } },
    moderationService: { async authorizeOwner() { return true; } },
    attachmentRepository: { async revokeForRoomMessage() { events.push('attachments-revoked'); return [{ id: 'attachment' }]; } },
    mediaJobRepository: { async enqueueCleanupForRoomMessage() { events.push('cleanup-enqueued'); if (failCleanup) throw new Error('queue unavailable'); } },
    async publishMessageDeleted() { events.push('published'); }, now: () => 1234
  });
  return { events, service };
}

test('G87-A01 tombstone, attachment denial and cleanup intent commit before publication', async () => {
  const { events, service } = harness();
  const result = await service.deleteRoomMessage({ roomId: 'room', messageId: 'message', actorUserId: 'owner' });
  assert.equal(result.status, 'deleted');
  assert.ok(events.indexOf('attachments-revoked') < events.indexOf('cleanup-enqueued'));
  assert.ok(events.indexOf('cleanup-enqueued') < events.indexOf('COMMIT'));
  assert.ok(events.indexOf('COMMIT') < events.indexOf('published'));
});

test('G87-A02 cleanup failure rolls back and emits no deletion event', async () => {
  const { events, service } = harness({ failCleanup: true });
  await assert.rejects(service.deleteRoomMessage({ roomId: 'room', messageId: 'message', actorUserId: 'owner' }), /queue unavailable/);
  assert.ok(events.includes('ROLLBACK'));
  assert.equal(events.includes('COMMIT'), false);
  assert.equal(events.includes('published'), false);
});
