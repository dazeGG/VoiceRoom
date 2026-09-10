'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MediaJobFenceError,
  createMediaJobRepository,
  mapMediaJob
} = require('../src/domains/media/media-job-repository');

const JOB = Object.freeze({
  id: 'job-1', attachment_id: 'attachment-1', kind: 'process', state: 'processing', attempts: 1,
  available_at: new Date(), claimed_by: 'worker-1', claimed_at: new Date(), lease_expires_at: new Date(),
  fencing_token: '2', last_error: null, created_at: new Date(), updated_at: new Date(),
  completed_at: null, dead_at: null
});

function poolWith(handler) {
  const calls = [];
  const query = async (text, values) => {
    calls.push({ text, values });
    return handler(text, values, calls.length);
  };
  return { calls, pool: { query } };
}

test('media job repository validates dependencies and maps fenced jobs', () => {
  assert.throws(() => createMediaJobRepository(), /PostgreSQL pool is required/);
  assert.equal(mapMediaJob(null), null);
  const mapped = mapMediaJob(JOB);
  assert.equal(mapped.attachmentId, 'attachment-1');
  assert.equal(mapped.fencingToken, 2);
  assert.equal(Object.isFrozen(mapped), true);
  const error = new MediaJobFenceError();
  assert.equal(error.name, 'MediaJobFenceError');
  assert.equal(error.code, 'MEDIA_JOB_FENCE_LOST');
});

test('media job enqueue is idempotent across existing, inserted, and raced jobs', async () => {
  let mode = 'existing';
  let racedSelects = 0;
  const { calls, pool } = poolWith(async (text) => {
    if (mode === 'existing') return { rows: [JOB], rowCount: 1 };
    if (mode === 'inserted') return /INSERT/.test(text) ? { rows: [JOB], rowCount: 1 } : { rows: [] };
    if (/INSERT/.test(text)) return { rows: [], rowCount: 0 };
    racedSelects += 1;
    return racedSelects === 1 ? { rows: [] } : { rows: [JOB], rowCount: 1 };
  });
  const repository = createMediaJobRepository({ pool });

  assert.equal((await repository.enqueue('attachment-1')).id, 'job-1');
  mode = 'inserted';
  assert.equal((await repository.enqueue('attachment-1', { kind: 'cleanup', availableAt: JOB.available_at })).id, 'job-1');
  mode = 'raced';
  const raced = await repository.enqueue('attachment-1');
  assert.equal(raced.id, 'job-1');
  assert.ok(calls.some((call) => /INSERT INTO media_processing_jobs/.test(call.text)));
  await assert.rejects(() => repository.enqueue('attachment-1', { kind: 'other' }), /Invalid media job kind/);
});

test('media job claims validate workers and clamp batch and lease limits', async () => {
  const { calls, pool } = poolWith(async () => ({ rows: [JOB], rowCount: 1 }));
  const repository = createMediaJobRepository({ pool });

  assert.equal((await repository.claimBatch({ workerId: ' worker-1 ', limit: 999, leaseMs: 9999999 })).length, 1);
  assert.deepEqual(calls.at(-1).values, ['process', 100, 'worker-1', 15 * 60 * 1000]);
  await repository.claimBatch({ workerId: 'worker-1', kind: 'cleanup', limit: 0, leaseMs: 'bad' });
  assert.deepEqual(calls.at(-1).values, ['cleanup', 10, 'worker-1', 120_000]);
  await repository.claimBatch({ workerId: 'worker-1', limit: 2, leaseMs: 5_000 });
  assert.deepEqual(calls.at(-1).values, ['process', 2, 'worker-1', 5_000]);
  await assert.rejects(() => repository.claimBatch({ workerId: 'worker-1', kind: 'other' }), /Invalid media job kind/);
  await assert.rejects(() => repository.claimBatch({ workerId: ' ' }), /worker id is required/);
  await assert.rejects(() => repository.claimBatch({ workerId: null }), /worker id is required/);
});

test('media job renew, complete, and fail enforce fencing tokens', async () => {
  let found = true;
  const { calls, pool } = poolWith(async () => ({ rows: found ? [JOB] : [], rowCount: found ? 1 : 0 }));
  const repository = createMediaJobRepository({ pool });

  assert.equal((await repository.renew('job-1', { workerId: 'worker-1', fencingToken: 2, leaseMs: 0 })).id, 'job-1');
  assert.equal(calls.at(-1).values[3], 120_000);
  assert.equal((await repository.complete('job-1', { workerId: 'worker-1', fencingToken: 2 })).id, 'job-1');
  assert.equal((await repository.fail('job-1', {
    workerId: 'worker-1', fencingToken: 2, error: new Error('failed'), retryDelayMs: 9999999, maxAttempts: 999
  })).id, 'job-1');
  assert.equal(calls.at(-1).values[3], 100);
  assert.equal(calls.at(-1).values[4], 15 * 60 * 1000);
  assert.equal(calls.at(-1).values[5], 'failed');
  await repository.fail('job-1', { workerId: 'worker-1', fencingToken: 2, error: null, retryDelayMs: 0, maxAttempts: 0 });
  assert.equal(calls.at(-1).values[5], 'Media job failed');
  await repository.fail('job-1', { workerId: 'worker-1', fencingToken: 2, error: 'plain failure' });
  assert.equal(calls.at(-1).values[5], 'plain failure');

  found = false;
  await assert.rejects(() => repository.renew('job-1', { workerId: 'worker-1', fencingToken: 2 }), MediaJobFenceError);
  await assert.rejects(() => repository.complete('job-1', { workerId: 'worker-1', fencingToken: 2 }), MediaJobFenceError);
  await assert.rejects(() => repository.fail('job-1', { workerId: 'worker-1', fencingToken: 2 }), MediaJobFenceError);
});

test('media job repository finds and prunes terminal jobs', async () => {
  const { calls, pool } = poolWith(async (text) => {
    if (/DELETE/.test(text)) return { rows: [{ id: 'job-1' }, { id: 'job-2' }], rowCount: 2 };
    if (/AS age_ms/.test(text)) return { rows: [{ age_ms: '1234' }], rowCount: 1 };
    return { rows: [JOB], rowCount: 1 };
  });
  const repository = createMediaJobRepository({ pool });

  assert.equal((await repository.findById('job-1')).id, 'job-1');
  const client = { async query() { return { rows: [JOB], rowCount: 1 }; } };
  assert.equal((await repository.findById('job-1', { client })).id, 'job-1');
  assert.equal(await repository.oldestPendingAgeMs(), 1234);
  assert.match(calls.at(-1).text, /state IN \('pending', 'processing'\)/);
  assert.equal(await repository.oldestPendingAgeMs({
    client: { async query() { return { rows: [{ age_ms: null }] }; } }
  }), 0);
  assert.deepEqual(await repository.removeTerminalBefore(new Date(), { limit: 0 }), ['job-1', 'job-2']);
  assert.equal(calls.at(-1).values[1], 500);
  await repository.removeTerminalBefore(new Date(), { limit: 2 });
  assert.equal(calls.at(-1).values[1], 2);
});

test('media job completion atomically marks the attachment and job ready', async () => {
  const calls = [];
  let owned = true;
  let attachment = { id: 'attachment-1' };
  let rollbackFails = false;
  let completionFound = true;
  let releaseFails = false;
  let beginFails = false;
  let releases = 0;
  const client = {
    async query(text) {
      calls.push(text);
      if (beginFails && text === 'BEGIN') throw new Error('begin failed');
      if (text === 'ROLLBACK' && rollbackFails) throw new Error('rollback failed');
      if (/SELECT attachment_id/.test(text)) return { rows: owned ? [{ attachment_id: 'attachment-1' }] : [] };
      if (/SET state = 'completed'/.test(text)) return { rows: completionFound ? [JOB] : [], rowCount: completionFound ? 1 : 0 };
      return { rows: [], rowCount: 0 };
    },
    release() {
      releases += 1;
      if (releaseFails) throw new Error('release failed');
    }
  };
  const pool = { async query() { return { rows: [] }; }, async connect() { return client; } };
  const repository = createMediaJobRepository({ pool });
  const attachmentRepository = {
    async markReady(id, result, transaction) {
      assert.equal(id, 'attachment-1');
      assert.equal(typeof result, 'object');
      assert.equal(transaction, client);
      return attachment;
    }
  };

  assert.equal((await repository.completeProcessing('job-1', {
    workerId: 'worker-1', fencingToken: 2, attachmentRepository,
    attachmentResult: { processedStorageKey: 'processed' }
  })).id, 'attachment-1');
  assert.deepEqual(calls.slice(0, 2), ['BEGIN', calls[1]]);
  assert.equal(calls.at(-1), 'COMMIT');
  assert.equal(releases, 1);

  owned = false;
  await assert.rejects(() => repository.completeProcessing('job-1', {
    workerId: 'worker-1', fencingToken: 2, attachmentRepository, attachmentResult: {}
  }), MediaJobFenceError);
  assert.equal(calls.at(-1), 'ROLLBACK');

  owned = true;
  completionFound = false;
  await assert.rejects(() => repository.completeProcessing('job-1', {
    workerId: 'worker-1', fencingToken: 2, attachmentRepository, attachmentResult: {}
  }), MediaJobFenceError);
  completionFound = true;
  attachment = null;
  rollbackFails = true;
  await assert.rejects(() => repository.completeProcessing('job-1', {
    workerId: 'worker-1', fencingToken: 2, attachmentRepository, attachmentResult: {}
  }), /no longer processable/);
  assert.equal(releases, 4);

  attachment = { id: 'attachment-1' };
  rollbackFails = false;
  releaseFails = true;
  await assert.rejects(() => repository.completeProcessing('job-1', {
    workerId: 'worker-1', fencingToken: 2, attachmentRepository, attachmentResult: {}
  }), /release failed/);
  releaseFails = false;

  beginFails = true;
  await assert.rejects(() => repository.completeProcessing('job-1', {
    workerId: 'worker-1', fencingToken: 2, attachmentRepository, attachmentResult: {}
  }), /begin failed/);
  beginFails = false;

  const noConnect = createMediaJobRepository({ pool: { async query() { return { rows: [] }; } } });
  await assert.rejects(() => noConnect.completeProcessing('job-1', {
    attachmentRepository, attachmentResult: {}
  }), /completion dependencies are required/);
  await assert.rejects(() => repository.completeProcessing('job-1', {
    attachmentRepository: {}, attachmentResult: {}
  }), /completion dependencies are required/);
});
