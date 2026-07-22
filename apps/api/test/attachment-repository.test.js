'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAttachmentRepository,
  mapAttachment
} = require('../src/domains/media/attachment-repository');

const ROW = Object.freeze({
  id: 'attachment-1',
  owner_id: 'owner-1',
  context: 'room',
  state: 'ready',
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

function createPool(handler = async () => ({ rows: [ROW], rowCount: 1 })) {
  const calls = [];
  const query = async (text, values) => {
    calls.push({ text, values });
    return handler(text, values, calls.length);
  };
  return { calls, pool: { query } };
}

test('attachment repository validates its pool and maps database rows', () => {
  assert.throws(() => createAttachmentRepository(), /PostgreSQL pool is required/);
  assert.equal(mapAttachment(null), null);

  const mapped = mapAttachment(ROW);
  assert.deepEqual(mapped.storageKeys, { original: 'original', processed: 'processed', preview: 'preview' });
  assert.equal(mapped.state, 'ready');
  assert.equal(mapped.internalState, 'ready');
  assert.equal(mapped.reservedBytes, 10);
  assert.equal(mapped.originalBytes, 20);
  assert.equal(mapped.processedBytes, 15);
  assert.equal(mapped.previewBytes, 5);
  assert.equal(Object.isFrozen(mapped), true);
  assert.equal(Object.isFrozen(mapped.storageKeys), true);

  const pending = mapAttachment({ ...ROW, state: 'uploading', metadata: null,
    reserved_bytes: null, original_bytes: null, processed_bytes: null, preview_bytes: null });
  assert.equal(pending.state, 'pending');
  assert.deepEqual(pending.metadata, {});
  assert.equal(pending.reservedBytes, null);
  assert.equal(pending.originalBytes, null);
  assert.equal(pending.processedBytes, null);
  assert.equal(pending.previewBytes, null);
});

test('attachment repository covers draft, lookup, upload, processing, and deletion transitions', async () => {
  const { calls, pool } = createPool();
  const repository = createAttachmentRepository({ pool });
  const clientCalls = [];
  const client = { async query(text, values) { clientCalls.push({ text, values }); return { rows: [ROW], rowCount: 1 }; } };

  const draft = await repository.createDraft({
    id: 'attachment-1', ownerId: ' owner-1 ', context: 'room', clientRequestId: ' request-1 ',
    reservedBytes: 100, reservationExpiresAt: ROW.reservation_expires_at, metadata: { source: 'test' }
  });
  assert.equal(draft.id, 'attachment-1');
  assert.deepEqual(calls.at(-1).values, [
    'attachment-1', 'owner-1', 'room', 'request-1', 100, ROW.reservation_expires_at, { source: 'test' }
  ]);
  await repository.createDraft({ ownerId: 'owner-1', context: 'dm' });
  assert.equal(typeof calls.at(-1).values[0], 'string');
  assert.equal(calls.at(-1).values[3], null);

  assert.equal((await repository.findById('attachment-1')).id, 'attachment-1');
  await repository.findById('attachment-1', { forUpdate: true, client });
  assert.match(clientCalls[0].text, /FOR UPDATE/);
  assert.equal((await repository.listOwnerDrafts('owner-1', 'room', { limit: 0 })).length, 1);
  assert.equal(calls.at(-1).values[2], 20);
  await repository.listOwnerDrafts('owner-1', 'room', { limit: 999 });
  assert.equal(calls.at(-1).values[2], 100);
  assert.equal((await repository.findByClientRequest('owner-1', 'room', 'request-1')).id, 'attachment-1');

  assert.equal((await repository.markUploaded('attachment-1', {
    mimeType: 'image/png', bytes: 20, width: 800, height: 600, originalStorageKey: ' original '
  })).id, 'attachment-1');
  assert.equal((await repository.retryProcessing('attachment-1')).id, 'attachment-1');
  assert.equal((await repository.markReady('attachment-1', {
    processedStorageKey: ' processed ', previewStorageKey: ' preview ', processedBytes: 15, previewBytes: 5
  })).id, 'attachment-1');
  assert.equal((await repository.markFailed('attachment-1', ' processing_failed ')).id, 'attachment-1');
  assert.equal((await repository.markUnavailable('attachment-1')).id, 'attachment-1');
  assert.equal(calls.at(-1).values[1], 'media_missing');
  assert.equal((await repository.markDeleted('attachment-1')).id, 'attachment-1');
  assert.equal((await repository.clearPhysicalData('attachment-1')).id, 'attachment-1');

  const fallbackDelete = createAttachmentRepository({
    pool: {
      async query(text) {
        return /SET state = 'deleted'/.test(text)
          ? { rows: [], rowCount: 0 }
          : { rows: [ROW], rowCount: 1 };
      }
    }
  });
  assert.equal((await fallbackDelete.markDeleted('attachment-1')).id, 'attachment-1');

  await assert.rejects(() => repository.createDraft({ ownerId: 'owner-1', context: 'other' }), /Invalid attachment context/);
  await assert.rejects(() => repository.createDraft({ ownerId: '', context: 'room' }), /Invalid attachment owner/);
  await assert.rejects(() => repository.createDraft({ ownerId: null, context: 'room' }), /Invalid attachment owner/);
  await assert.rejects(() => repository.createDraft({ ownerId: 'owner-1', context: 'room', clientRequestId: 'x'.repeat(129) }), /Invalid client request id/);
  await assert.rejects(() => repository.markUploaded('attachment-1', { mimeType: 'text/plain' }), /Invalid attachment MIME type/);
  await assert.rejects(() => repository.markReady('attachment-1', {
    processedStorageKey: '', previewStorageKey: 'preview'
  }), /Invalid processed storage key/);
});

test('attachment repository binds ordered attachments and lists message data', async () => {
  let rowCount = 2;
  const rows = [{ ...ROW, id: 'attachment-2', attachment_order: 1 }, { ...ROW, attachment_order: 0 }];
  const { calls, pool } = createPool(async () => ({ rows, rowCount }));
  const repository = createAttachmentRepository({ pool });

  const bound = await repository.bindReady({
    ownerId: 'owner-1', context: 'room', messageId: 'message-1',
    attachmentIds: ['attachment-1', 'attachment-2']
  });
  assert.deepEqual(bound.map((attachment) => attachment.order), [0, 1]);
  assert.match(calls.at(-1).text, /room_message_id/);

  await repository.bindReady({
    ownerId: 'owner-1', context: 'dm', messageId: 'message-2',
    attachmentIds: ['attachment-1', 'attachment-2']
  });
  assert.match(calls.at(-1).text, /direct_message_id/);
  assert.equal((await repository.listForMessage('room', 'message-1')).length, 2);
  assert.match(calls.at(-1).text, /room_message_id/);
  assert.equal((await repository.listForMessage('dm', 'message-2')).length, 2);
  assert.match(calls.at(-1).text, /direct_message_id/);

  await assert.rejects(() => repository.bindReady({ attachmentIds: [] }), /one and four/);
  await assert.rejects(() => repository.bindReady({ attachmentIds: ['a', 'a'] }), /must be unique/);
  await assert.rejects(() => repository.bindReady({ context: 'other', attachmentIds: ['a'] }), /Invalid attachment context/);
  await assert.rejects(() => repository.listForMessage('other', 'message-1'), /Invalid attachment context/);
  rowCount = 1;
  await assert.rejects(() => repository.bindReady({
    ownerId: 'owner-1', context: 'room', messageId: 'message-1', attachmentIds: ['a', 'b']
  }), /cannot be bound/);
});

test('attachment repository covers cleanup, storage inventory, quota, and owner locks', async () => {
  let mode = 'row';
  const staleDeleted = { ...ROW, state: 'deleted', updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000) };
  const { calls, pool } = createPool(async (text) => {
    if (/pending_count/.test(text)) {
      return mode === 'empty'
        ? { rows: [], rowCount: 0 }
        : { rows: [{ pending_count: '2', recent_count: '3', used_bytes: '40' }], rowCount: 1 };
    }
    if (/original_storage_key, processed_storage_key/.test(text)) {
      return { rows: [{ id: 'attachment-1', original_storage_key: 'original', processed_storage_key: null, preview_storage_key: 'preview' }], rowCount: 1 };
    }
    if (/SET state = 'deleted'/.test(text) && mode === 'fallback') return { rows: [], rowCount: 0 };
    if (/SELECT \* FROM message_attachments WHERE id/.test(text) && mode === 'fallback') return { rows: [staleDeleted], rowCount: 1 };
    if (/SET state = 'deleted'/.test(text) && mode === 'missing') return { rows: [], rowCount: 0 };
    if (/SELECT \* FROM message_attachments WHERE id/.test(text) && mode === 'missing') return { rows: [], rowCount: 0 };
    return { rows: [ROW], rowCount: 1 };
  });
  const repository = createAttachmentRepository({ pool });

  assert.equal((await repository.listCleanupCandidates({ limit: 0 })).length, 1);
  assert.equal(calls.at(-1).values[0], 500);
  await repository.listCleanupCandidates({ limit: 1 });
  assert.equal(calls.at(-1).values[0], 1);
  assert.equal((await repository.markCleanupDeleted('attachment-1')).id, 'attachment-1');
  const cleanupDeleteSql = calls.at(-1).text;
  assert.equal((cleanupDeleteSql.match(/WHERE id = \$1/g) || []).length, 1);
  assert.equal((cleanupDeleteSql.match(/state = 'uploading'/g) || []).length, 1);
  assert.equal((cleanupDeleteSql.match(/state = 'failed'/g) || []).length, 1);
  assert.equal((cleanupDeleteSql.match(/state = 'ready'/g) || []).length, 1);
  mode = 'fallback';
  assert.equal((await repository.markCleanupDeleted('attachment-1')).internalState, 'deleted');
  mode = 'missing';
  assert.equal(await repository.markCleanupDeleted('attachment-1'), null);

  mode = 'row';
  assert.deepEqual(await repository.listStorageKeys({ afterId: 'attachment-0', limit: 3_000 }), [{
    id: 'attachment-1', keys: ['original', 'preview']
  }]);
  assert.deepEqual(calls.at(-1).values, ['attachment-0', 2_000]);
  await repository.listStorageKeys({ limit: 0 });
  assert.deepEqual(calls.at(-1).values, [null, 500]);
  assert.deepEqual(await repository.quotaUsage('owner-1'), { pendingCount: 2, recentCount: 3, usedBytes: 40 });
  mode = 'empty';
  assert.deepEqual(await repository.quotaUsage('owner-1'), { pendingCount: 0, recentCount: 0, usedBytes: 0 });

  await assert.rejects(() => repository.lockOwner('owner-1'), /transaction client is required/);
  const transactionCalls = [];
  await repository.lockOwner('owner-1', { async query(text, values) { transactionCalls.push({ text, values }); } });
  assert.deepEqual(transactionCalls[0].values, ['media-quota:owner-1']);
});

test('attachment repository serializes physical upload work with advisory locks', async () => {
  const calls = [];
  let releaseCalls = 0;
  let unlockFails = false;
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (unlockFails && /unlock/.test(text)) throw new Error('unlock failed');
      return { rows: [] };
    },
    release() { releaseCalls += 1; }
  };
  const repository = createAttachmentRepository({
    pool: { async query() { return { rows: [] }; }, async connect() { return client; } }
  });

  assert.equal(await repository.withAttachmentLock('attachment-1', async (lockedClient) => {
    assert.equal(lockedClient, client);
    return 'done';
  }), 'done');
  assert.match(calls[0].text, /pg_advisory_lock/);
  assert.match(calls[1].text, /pg_advisory_unlock/);
  assert.equal(releaseCalls, 1);

  unlockFails = true;
  await assert.rejects(() => repository.withAttachmentLock('attachment-2', async () => {
    throw new Error('operation failed');
  }), /operation failed/);
  assert.equal(releaseCalls, 2);

  const noConnect = createAttachmentRepository({ pool: { async query() { return { rows: [] }; } } });
  await assert.rejects(() => noConnect.withAttachmentLock('attachment-1', async () => {}), /cannot acquire attachment locks/);
});
