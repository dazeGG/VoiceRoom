import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MediaJobFenceError,
  createMediaJobRepository,
  mapMediaJob
} from '../src/domains/media/media-job-repository.ts';
import type { Attachment, AttachmentRepository } from '../src/domains/media/attachment-repository.ts';
import { attachment, fake, fakeDb, result } from './fakes/index.ts';

const JOB = Object.freeze({
  id: 'job-1',
  attachment_id: 'attachment-1',
  kind: 'process',
  state: 'processing',
  attempts: 1,
  available_at: new Date(),
  claimed_by: 'worker-1',
  claimed_at: new Date(),
  lease_expires_at: new Date(),
  fencing_token: '2',
  last_error: null,
  created_at: new Date(),
  updated_at: new Date(),
  completed_at: null,
  dead_at: null
});

function poolWith(handler: (text: string) => unknown) {
  const pool = fakeDb(handler);
  return { calls: pool.calls, pool };
}

// The last statement the fake ran.
function last(calls: Array<{ text: string; values: unknown[] }>) {
  const call = calls.at(-1);
  assert.ok(call);
  return call;
}

// What the attachment side of a completion receives; the fake ignores it.
const READY_RESULT = {
  processedStorageKey: 'processed',
  previewStorageKey: 'preview',
  processedBytes: 1,
  previewBytes: 1
};

test('media job repository validates dependencies and maps fenced jobs', () => {
  assert.throws(() => createMediaJobRepository(), /PostgreSQL pool is required/);
  assert.equal(mapMediaJob(null), null);
  const mapped = mapMediaJob(JOB);
  assert.ok(mapped);
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
  const { calls, pool } = poolWith((text) => {
    if (mode === 'existing') return result([JOB]);
    if (mode === 'inserted') return /INSERT/.test(text) ? result([JOB]) : result();
    if (/INSERT/.test(text)) return result();
    racedSelects += 1;
    return racedSelects === 1 ? result() : result([JOB]);
  });
  const repository = createMediaJobRepository({ pool });

  assert.equal((await repository.enqueue('attachment-1'))?.id, 'job-1');
  mode = 'inserted';
  assert.equal(
    (await repository.enqueue('attachment-1', { kind: 'cleanup', availableAt: JOB.available_at }))?.id,
    'job-1'
  );
  mode = 'raced';
  const raced = await repository.enqueue('attachment-1');
  assert.equal(raced?.id, 'job-1');
  assert.ok(calls.some((call) => /INSERT INTO media_processing_jobs/.test(call.text)));
  await assert.rejects(() => repository.enqueue('attachment-1', { kind: 'other' }), /Invalid media job kind/);
});

test('media job claims validate workers and clamp batch and lease limits', async () => {
  const { calls, pool } = poolWith(() => result([JOB]));
  const repository = createMediaJobRepository({ pool });

  assert.equal((await repository.claimBatch({ workerId: ' worker-1 ', limit: 999, leaseMs: 9999999 })).length, 1);
  assert.deepEqual(last(calls).values, ['process', 100, 'worker-1', 15 * 60 * 1000]);
  await repository.claimBatch({ workerId: 'worker-1', kind: 'cleanup', limit: 0, leaseMs: 'bad' });
  assert.deepEqual(last(calls).values, ['cleanup', 10, 'worker-1', 120_000]);
  await repository.claimBatch({ workerId: 'worker-1', limit: 2, leaseMs: 5_000 });
  assert.deepEqual(last(calls).values, ['process', 2, 'worker-1', 5_000]);
  await assert.rejects(() => repository.claimBatch({ workerId: 'worker-1', kind: 'other' }), /Invalid media job kind/);
  await assert.rejects(() => repository.claimBatch({ workerId: ' ' }), /worker id is required/);
  await assert.rejects(() => repository.claimBatch({ workerId: null }), /worker id is required/);
});

test('media job renew, complete, and fail enforce fencing tokens', async () => {
  let found = true;
  const { calls, pool } = poolWith(() => (found ? result([JOB]) : result()));
  const repository = createMediaJobRepository({ pool });

  assert.equal((await repository.renew('job-1', { workerId: 'worker-1', fencingToken: 2, leaseMs: 0 }))?.id, 'job-1');
  assert.equal(last(calls).values[3], 120_000);
  assert.equal((await repository.complete('job-1', { workerId: 'worker-1', fencingToken: 2 }))?.id, 'job-1');
  assert.equal(
    (
      await repository.fail('job-1', {
        workerId: 'worker-1',
        fencingToken: 2,
        error: new Error('failed'),
        retryDelayMs: 9999999,
        maxAttempts: 999
      })
    )?.id,
    'job-1'
  );
  assert.equal(last(calls).values[3], 100);
  assert.equal(last(calls).values[4], 15 * 60 * 1000);
  assert.equal(last(calls).values[5], 'failed');
  await repository.fail('job-1', {
    workerId: 'worker-1',
    fencingToken: 2,
    error: null,
    retryDelayMs: 0,
    maxAttempts: 0
  });
  assert.equal(last(calls).values[5], 'Media job failed');
  await repository.fail('job-1', { workerId: 'worker-1', fencingToken: 2, error: 'plain failure' });
  assert.equal(last(calls).values[5], 'plain failure');

  found = false;
  await assert.rejects(() => repository.renew('job-1', { workerId: 'worker-1', fencingToken: 2 }), MediaJobFenceError);
  await assert.rejects(
    () => repository.complete('job-1', { workerId: 'worker-1', fencingToken: 2 }),
    MediaJobFenceError
  );
  await assert.rejects(() => repository.fail('job-1', { workerId: 'worker-1', fencingToken: 2 }), MediaJobFenceError);
});

test('media job repository finds and prunes terminal jobs', async () => {
  const { calls, pool } = poolWith((text) => {
    if (/DELETE/.test(text)) return result([{ id: 'job-1' }, { id: 'job-2' }]);
    if (/AS age_ms/.test(text)) return result([{ age_ms: '1234' }]);
    return result([JOB]);
  });
  const repository = createMediaJobRepository({ pool });

  assert.equal((await repository.findById('job-1'))?.id, 'job-1');
  const client = fakeDb(() => result([JOB]));
  assert.equal((await repository.findById('job-1', { client }))?.id, 'job-1');
  assert.equal(await repository.oldestPendingAgeMs(), 1234);
  assert.match(last(calls).text, /state IN \('pending', 'processing'\)/);
  assert.equal(await repository.oldestPendingAgeMs({ client: fakeDb(() => result([{ age_ms: null }])) }), 0);
  assert.deepEqual(await repository.removeTerminalBefore(new Date(), { limit: 0 }), ['job-1', 'job-2']);
  assert.equal(last(calls).values[1], 500);
  await repository.removeTerminalBefore(new Date(), { limit: 2 });
  assert.equal(last(calls).values[1], 2);
});

test('media job completion atomically marks the attachment and job ready', async () => {
  let owned = true;
  let marked: Attachment | null = attachment({ id: 'attachment-1' });
  let rollbackFails = false;
  let completionFound = true;
  let releaseFails = false;
  let beginFails = false;
  let releases = 0;
  const client = fakeDb((text) => {
    if (beginFails && text === 'BEGIN') throw new Error('begin failed');
    if (text === 'ROLLBACK' && rollbackFails) throw new Error('rollback failed');
    if (/SELECT attachment_id/.test(text)) return result(owned ? [{ attachment_id: 'attachment-1' }] : []);
    if (/SET state = 'completed'/.test(text)) return completionFound ? result([JOB]) : result();
    return result();
  });
  client.release = () => {
    releases += 1;
    if (releaseFails) throw new Error('release failed');
  };
  const calls = () => client.calls.map((call) => call.text);
  const idle = fakeDb();
  const repository = createMediaJobRepository({ pool: { query: idle.query.bind(idle), connect: async () => client } });
  const attachmentRepository = fake<AttachmentRepository>({
    async markReady(id, ready, transaction) {
      assert.equal(id, 'attachment-1');
      assert.equal(typeof ready, 'object');
      assert.equal(transaction, client);
      return marked;
    }
  });

  assert.equal(
    (
      await repository.completeProcessing('job-1', {
        workerId: 'worker-1',
        fencingToken: 2,
        attachmentRepository,
        attachmentResult: READY_RESULT
      })
    )?.id,
    'attachment-1'
  );
  assert.equal(calls()[0], 'BEGIN');
  assert.equal(calls().at(-1), 'COMMIT');
  assert.equal(releases, 1);

  owned = false;
  await assert.rejects(
    () =>
      repository.completeProcessing('job-1', {
        workerId: 'worker-1',
        fencingToken: 2,
        attachmentRepository,
        attachmentResult: READY_RESULT
      }),
    MediaJobFenceError
  );
  assert.equal(calls().at(-1), 'ROLLBACK');

  owned = true;
  completionFound = false;
  await assert.rejects(
    () =>
      repository.completeProcessing('job-1', {
        workerId: 'worker-1',
        fencingToken: 2,
        attachmentRepository,
        attachmentResult: READY_RESULT
      }),
    MediaJobFenceError
  );
  completionFound = true;
  marked = null;
  rollbackFails = true;
  await assert.rejects(
    () =>
      repository.completeProcessing('job-1', {
        workerId: 'worker-1',
        fencingToken: 2,
        attachmentRepository,
        attachmentResult: READY_RESULT
      }),
    /no longer processable/
  );
  assert.equal(releases, 4);

  marked = attachment({ id: 'attachment-1' });
  rollbackFails = false;
  releaseFails = true;
  await assert.rejects(
    () =>
      repository.completeProcessing('job-1', {
        workerId: 'worker-1',
        fencingToken: 2,
        attachmentRepository,
        attachmentResult: READY_RESULT
      }),
    /release failed/
  );
  releaseFails = false;

  beginFails = true;
  await assert.rejects(
    () =>
      repository.completeProcessing('job-1', {
        workerId: 'worker-1',
        fencingToken: 2,
        attachmentRepository,
        attachmentResult: READY_RESULT
      }),
    /begin failed/
  );
  beginFails = false;

  const noConnect = createMediaJobRepository({ pool: { query: idle.query.bind(idle) } });
  await assert.rejects(
    () =>
      noConnect.completeProcessing('job-1', {
        workerId: 'worker-1',
        fencingToken: 2,
        attachmentRepository,
        attachmentResult: READY_RESULT
      }),
    /completion dependencies are required/
  );
  await assert.rejects(
    () =>
      repository.completeProcessing('job-1', {
        workerId: 'worker-1',
        fencingToken: 2,
        attachmentRepository: fake<AttachmentRepository>(),
        attachmentResult: READY_RESULT
      }),
    /completion dependencies are required/
  );
});
