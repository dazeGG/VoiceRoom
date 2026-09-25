// The attachment repository over a migrated database: drafts, the upload and
// processing states, binding to a message, cleanup, storage inventory, quotas
// and the upload lock.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type pg from 'pg';

import { createAttachmentRepository, mapAttachment } from '../src/domains/media/attachment-repository.ts';
import { transaction } from '../src/platform/db/pool.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;

const ROW = Object.freeze({
  id: 'attachment-1',
  owner_id: 'owner-1',
  context: 'room' as const,
  state: 'ready' as const,
  client_request_id: 'request-1',
  reserved_bytes: '10',
  reservation_expires_at: new Date('2026-07-22T00:00:00Z'),
  mime_type: 'image/png',
  original_bytes: '20',
  processed_bytes: '15',
  preview_bytes: '5',
  width: 800,
  height: 600,
  original_storage_key: 'original',
  processed_storage_key: 'processed',
  preview_storage_key: 'preview',
  room_message_id: 'room-message-1',
  direct_message_id: null,
  attachment_order: 1,
  failure_code: null,
  metadata: { source: 'test' },
  created_at: new Date('2026-07-22T00:00:00Z'),
  updated_at: new Date('2026-07-22T00:01:00Z'),
  uploaded_at: new Date('2026-07-22T00:00:10Z'),
  ready_at: new Date('2026-07-22T00:00:20Z'),
  failed_at: null,
  bound_at: new Date('2026-07-22T00:00:30Z'),
  deleted_at: null
});

const UPLOAD = { mimeType: 'image/png', bytes: 20, width: 800, height: 600, originalStorageKey: ' original ' };
const PROCESSED = {
  processedStorageKey: ' processed ',
  previewStorageKey: ' preview ',
  processedBytes: 15,
  previewBytes: 5
};

async function setup(t: TestContext) {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  const ownerId = crypto.randomUUID();
  const peerId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, login, display_name, password_hash) VALUES ($1, 'owner', 'Owner', 'x'), ($2, 'peer', 'Peer', 'x');
     INSERT INTO rooms (id, is_static) VALUES ('room-1', true);
     INSERT INTO room_messages (id, room_id, text) VALUES ('room-message-1', 'room-1', 'hi');`
      .replaceAll('$1', `'${ownerId}'`)
      .replaceAll('$2', `'${peerId}'`)
  );
  await pool.query(`INSERT INTO direct_messages (id, sender_id, recipient_id, body) VALUES ('dm-1', $1, $2, 'hi')`, [
    ownerId,
    peerId
  ]);
  const repository = createAttachmentRepository({ pool });
  // A draft taken through upload and processing to ready.
  async function ready(context: 'room' | 'dm' = 'room') {
    const draft = await repository.createDraft({ ownerId, context });
    assert.ok(draft);
    await repository.markUploaded(draft.id, UPLOAD);
    const done = await repository.markReady(draft.id, PROCESSED);
    assert.equal(done?.state, 'ready');
    return done;
  }
  return { pool, repository, ownerId, ready };
}

async function age(pool: pg.Pool, id: string, interval: string) {
  await pool.query(`UPDATE message_attachments SET updated_at = current_timestamp - $2::interval WHERE id = $1`, [
    id,
    interval
  ]);
}

test('attachment repository validates its pool and maps database rows', () => {
  assert.throws(() => createAttachmentRepository(), /PostgreSQL pool is required/);
  assert.equal(mapAttachment(null), null);

  const mapped = mapAttachment(ROW);
  assert.ok(mapped);
  assert.deepEqual(mapped.storageKeys, { original: 'original', processed: 'processed', preview: 'preview' });
  assert.equal(mapped.state, 'ready');
  assert.equal(mapped.internalState, 'ready');
  assert.deepEqual(
    [mapped.reservedBytes, mapped.originalBytes, mapped.processedBytes, mapped.previewBytes],
    [10, 20, 15, 5]
  );
  assert.equal(Object.isFrozen(mapped), true);
  assert.equal(Object.isFrozen(mapped.storageKeys), true);

  const pending = mapAttachment({
    ...ROW,
    state: 'uploading',
    metadata: null,
    reserved_bytes: null,
    original_bytes: null,
    processed_bytes: null,
    preview_bytes: null,
    attachment_order: null
  });
  assert.ok(pending);
  assert.equal(pending.state, 'pending');
  assert.deepEqual(pending.metadata, {});
  assert.deepEqual(
    [pending.reservedBytes, pending.originalBytes, pending.processedBytes, pending.previewBytes, pending.order],
    [null, null, null, null, 0]
  );
});

test('a draft moves through upload, processing, failure and deletion', { skip }, async (t) => {
  const { pool, repository, ownerId } = await setup(t);
  const expires = new Date(Date.now() + 60_000);

  const draft = await repository.createDraft({
    ownerId: ` ${ownerId} `,
    context: 'room',
    clientRequestId: ' request-1 ',
    reservedBytes: 100,
    reservationExpiresAt: expires,
    metadata: { source: 'test' }
  });
  assert.ok(draft);
  assert.deepEqual(
    [draft.ownerId, draft.state, draft.clientRequestId, draft.reservedBytes, draft.metadata],
    [ownerId, 'pending', 'request-1', 100, { source: 'test' }]
  );
  const retried = await repository.createDraft({ ownerId, context: 'room', clientRequestId: 'request-1' });
  assert.equal(retried?.id, draft.id, 'the same client request answers with the same draft');
  const plain = await repository.createDraft({ ownerId, context: 'dm' });
  assert.equal(plain?.clientRequestId, null);

  assert.equal((await repository.findById(draft.id))?.id, draft.id);
  await transaction(pool, async (client) => {
    assert.equal((await repository.findById(draft.id, { forUpdate: true, client }))?.id, draft.id);
  });
  assert.equal(await repository.findById(crypto.randomUUID()), null);
  assert.equal((await repository.listOwnerDrafts(ownerId, 'room', { limit: 0 })).length, 1);
  assert.equal((await repository.listOwnerDrafts(ownerId, 'dm', { limit: 999 })).length, 1);
  assert.equal((await repository.findByClientRequest(ownerId, 'room', 'request-1'))?.id, draft.id);

  const uploaded = await repository.markUploaded(draft.id, UPLOAD);
  assert.deepEqual(
    [uploaded?.state, uploaded?.originalBytes, uploaded?.storageKeys.original, uploaded?.reservedBytes],
    ['processing', 20, 'original', null]
  );
  assert.equal(await repository.markUploaded(draft.id, UPLOAD), null, 'only an uploading draft takes an upload');
  assert.equal(await repository.retryProcessing(draft.id), null, 'only a failed attachment is retried');

  const failed = await repository.markFailed(draft.id, ' processing_failed ');
  assert.deepEqual([failed?.state, failed?.failureCode], ['failed', 'processing_failed']);
  assert.equal((await repository.retryProcessing(draft.id))?.state, 'processing');
  const done = await repository.markReady(draft.id, PROCESSED);
  assert.deepEqual([done?.state, done?.storageKeys.processed, done?.previewBytes], ['ready', 'processed', 5]);
  assert.equal(await repository.markReady(draft.id, PROCESSED), null, 'only a processing attachment turns ready');

  const unavailable = await repository.markUnavailable(draft.id);
  assert.deepEqual([unavailable?.state, unavailable?.failureCode], ['failed', 'media_missing']);
  const deleted = await repository.markDeleted(draft.id);
  assert.equal(deleted?.internalState, 'deleted');
  assert.equal((await repository.markDeleted(draft.id))?.id, draft.id, 'deleting again answers with the row');
  assert.equal(await repository.markDeleted(crypto.randomUUID()), null);
  const cleared = await repository.clearPhysicalData(draft.id);
  assert.deepEqual(cleared?.storageKeys, { original: null, processed: null, preview: null });

  await assert.rejects(() => repository.createDraft({ ownerId, context: 'other' }), /Invalid attachment context/);
  await assert.rejects(() => repository.createDraft({ ownerId: '', context: 'room' }), /Invalid attachment owner/);
  await assert.rejects(() => repository.createDraft({ ownerId: null, context: 'room' }), /Invalid attachment owner/);
  await assert.rejects(
    () => repository.createDraft({ ownerId, context: 'room', clientRequestId: 'x'.repeat(129) }),
    /Invalid client request id/
  );
  await assert.rejects(
    () => repository.markUploaded(draft.id, { mimeType: 'text/plain' } as never),
    /Invalid attachment MIME type/
  );
  await assert.rejects(
    () => repository.markReady(draft.id, { processedStorageKey: '', previewStorageKey: 'preview' } as never),
    /Invalid processed storage key/
  );
});

test('ready attachments bind to one message in order, all or none', { skip }, async (t) => {
  const { repository, ownerId, ready } = await setup(t);
  const first = await ready();
  const second = await ready();
  assert.ok(first && second);

  const bound = await repository.bindReady({
    ownerId,
    context: 'room',
    messageId: 'room-message-1',
    attachmentIds: [second.id, first.id]
  });
  assert.deepEqual(
    bound.map((attachment) => [attachment.id, attachment.order, attachment.roomMessageId]),
    [
      [second.id, 0, 'room-message-1'],
      [first.id, 1, 'room-message-1']
    ]
  );
  assert.deepEqual(
    (await repository.listForMessage('room', 'room-message-1')).map((attachment) => attachment.id),
    [second.id, first.id]
  );

  const direct = await ready('dm');
  assert.ok(direct);
  const [inDm] = await repository.bindReady({ ownerId, context: 'dm', messageId: 'dm-1', attachmentIds: [direct.id] });
  assert.equal(inDm?.directMessageId, 'dm-1');
  assert.deepEqual(
    (await repository.listForMessage('dm', 'dm-1')).map((attachment) => attachment.id),
    [direct.id]
  );

  const bind = { ownerId, context: 'room', messageId: 'room-message-1' };
  await assert.rejects(() => repository.bindReady({ ...bind, attachmentIds: [] }), /one and four/);
  await assert.rejects(() => repository.bindReady({ ...bind, attachmentIds: ['a', 'a'] }), /must be unique/);
  await assert.rejects(
    () => repository.bindReady({ ...bind, context: 'other', attachmentIds: ['a'] }),
    /Invalid attachment context/
  );
  await assert.rejects(() => repository.listForMessage('other', 'room-message-1'), /Invalid attachment context/);

  const loose = await ready();
  const pendingDraft = await repository.createDraft({ ownerId, context: 'room' });
  assert.ok(loose && pendingDraft);
  await assert.rejects(
    () => repository.bindReady({ ...bind, attachmentIds: [loose.id, pendingDraft.id] }),
    /cannot be bound/
  );
  assert.equal((await repository.findById(loose.id))?.boundAt, null, 'a failed bind binds nothing');
});

test('cleanup, processing inventory, storage keys and quota read the live rows', { skip }, async (t) => {
  const { pool, repository, ownerId, ready } = await setup(t);
  const stale = await repository.createDraft({ ownerId, context: 'room', reservedBytes: 40 });
  const withJob = await repository.createDraft({ ownerId, context: 'room' });
  const orphan = await repository.createDraft({ ownerId, context: 'room' });
  assert.ok(stale && withJob && orphan);
  await age(pool, stale.id, '2 hours');
  await repository.markUploaded(withJob.id, UPLOAD);
  await repository.markUploaded(orphan.id, UPLOAD);
  await pool.query(`INSERT INTO media_processing_jobs (id, attachment_id, kind) VALUES ($1, $2, 'process')`, [
    crypto.randomUUID(),
    withJob.id
  ]);

  assert.deepEqual(
    (await repository.listCleanupCandidates({ limit: 0 })).map((attachment) => attachment.id),
    [stale.id]
  );
  assert.deepEqual(
    (await repository.listProcessingWithoutActiveJob({ limit: 999 })).map((attachment) => attachment.id),
    [orphan.id],
    'an attachment with a live job is not an orphan'
  );

  assert.equal((await repository.markCleanupDeleted(stale.id))?.internalState, 'deleted');
  assert.equal(await repository.markCleanupDeleted(orphan.id), null, 'a fresh attachment is no candidate');
  assert.equal(await repository.markCleanupDeleted(stale.id), null, 'deleted under an hour ago: not yet done');
  await age(pool, stale.id, '2 hours');
  assert.equal((await repository.markCleanupDeleted(stale.id))?.id, stale.id, 'deleted long ago counts as done');
  assert.equal(await repository.markCleanupDeleted(crypto.randomUUID()), null);

  const readyOne = await ready();
  assert.ok(readyOne);
  const inventory = await repository.listStorageKeys({ limit: 3_000 });
  assert.equal(inventory.length, 4);
  assert.deepEqual(inventory.find((entry) => entry.id === readyOne.id)?.keys, ['original', 'processed', 'preview']);
  const [firstId] = inventory.map((entry) => entry.id);
  assert.ok(firstId);
  assert.deepEqual(
    (await repository.listStorageKeys({ afterId: firstId, limit: 0 })).map((entry) => entry.id),
    inventory.slice(1).map((entry) => entry.id)
  );

  await repository.createDraft({ ownerId, context: 'room', reservedBytes: 7 });
  assert.deepEqual(await repository.quotaUsage(ownerId), { pendingCount: 1, recentCount: 5, usedBytes: 7 + 20 * 3 });
  assert.deepEqual(await repository.quotaUsage(crypto.randomUUID()), { pendingCount: 0, recentCount: 0, usedBytes: 0 });

  await assert.rejects(() => repository.lockOwner(ownerId, null), /transaction client is required/);
  await transaction(pool, (client) => repository.lockOwner(ownerId, client));
});

test('the upload lock serializes work on one attachment and always lets go', { skip }, async (t) => {
  const { pool, repository } = await setup(t);
  const order: string[] = [];
  let releaseFirst = () => {};
  const firstHolds = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const first = repository.withAttachmentLock('attachment-1', async (client) => {
    assert.equal(typeof client.query, 'function');
    order.push('first in');
    await firstHolds;
    order.push('first out');
    return 'first';
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const second = repository.withAttachmentLock('attachment-1', async () => {
    order.push('second in');
    return 'second';
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(order, ['first in'], 'the second waits for the first');
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
  assert.deepEqual(order, ['first in', 'first out', 'second in']);

  await assert.rejects(
    () =>
      repository.withAttachmentLock('attachment-2', async () => {
        throw new Error('operation failed');
      }),
    /operation failed/
  );
  assert.equal(
    await repository.withAttachmentLock('attachment-2', async () => 'free again'),
    'free again',
    'a failed operation still unlocks'
  );
  assert.equal(pool.totalCount - pool.idleCount, 0, 'every connection went back to the pool');

  const noConnect = createAttachmentRepository({ pool: { query: pool.query.bind(pool) } });
  await assert.rejects(
    () => noConnect.withAttachmentLock('attachment-1', async () => {}),
    /cannot acquire attachment locks/
  );
});
