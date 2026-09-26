// The media job queue over a migrated database: one live job per attachment,
// leased claims fenced by a token, retries and dead jobs, pruning, and the
// completion that marks the attachment ready in the same transaction.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type pg from 'pg';

import {
  MediaJobFenceError,
  createMediaJobRepository,
  mapMediaJob
} from '../src/domains/media/media-job.repository.ts';
import { createAttachmentRepository, type AttachmentRepository } from '../src/domains/media/attachment.repository.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';
import { fake } from './fakes/index.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;

const JOB = Object.freeze({
  id: 'job-1',
  attachment_id: 'attachment-1',
  kind: 'process' as const,
  state: 'processing' as const,
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

const READY_RESULT = {
  processedStorageKey: 'processed',
  previewStorageKey: 'preview',
  processedBytes: 1,
  previewBytes: 1
};

async function setup(t: TestContext) {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  const ownerId = crypto.randomUUID();
  await pool.query(`INSERT INTO users (id, login, display_name, password_hash) VALUES ($1, 'owner', 'Owner', 'x')`, [
    ownerId
  ]);
  const attachments = createAttachmentRepository({ pool });
  const jobs = createMediaJobRepository({ pool });
  // An uploaded attachment waiting for processing.
  async function processing() {
    const draft = await attachments.createDraft({ ownerId, context: 'room' });
    assert.ok(draft);
    await attachments.markUploaded(draft.id, {
      mimeType: 'image/png',
      bytes: 10,
      width: 1,
      height: 1,
      originalStorageKey: 'original'
    });
    return draft.id;
  }
  return { pool, attachments, jobs, processing };
}

async function expireLease(pool: pg.Pool, jobId: string) {
  await pool.query(
    `UPDATE media_processing_jobs SET lease_expires_at = current_timestamp - interval '1 second' WHERE id = $1`,
    [jobId]
  );
}

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

test('an attachment has at most one live job of a kind', { skip }, async (t) => {
  const { pool, jobs, processing } = await setup(t);
  const attachmentId = await processing();

  const first = await jobs.enqueue(attachmentId);
  assert.equal(first?.state, 'pending');
  assert.equal((await jobs.enqueue(attachmentId))?.id, first?.id, 'a second enqueue answers with the live job');
  const cleanup = await jobs.enqueue(attachmentId, { kind: 'cleanup', availableAt: new Date(Date.now() + 60_000) });
  assert.notEqual(cleanup?.id, first?.id, 'another kind is its own job');

  // Another enqueue has inserted but not committed: this one sees no live job,
  // waits on the unique index, and then answers with the winner's job.
  const other = await processing();
  const winnerId = crypto.randomUUID();
  const winner = await pool.connect();
  await winner.query('BEGIN');
  await winner.query(`INSERT INTO media_processing_jobs (id, attachment_id, kind) VALUES ($1, $2, 'process')`, [
    winnerId,
    other
  ]);
  const racing = jobs.enqueue(other);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await winner.query('COMMIT');
  winner.release();
  assert.equal((await racing)?.id, winnerId);

  await assert.rejects(() => jobs.enqueue(attachmentId, { kind: 'other' }), /Invalid media job kind/);
});

test('claims take due jobs, fence each lease, and reclaim expired leases', { skip }, async (t) => {
  const { pool, jobs, processing } = await setup(t);
  const due = await jobs.enqueue(await processing());
  await jobs.enqueue(await processing(), { availableAt: new Date(Date.now() + 60_000) });
  await jobs.enqueue(await processing(), { kind: 'cleanup' });

  await assert.rejects(() => jobs.claimBatch({ workerId: 'worker-1', kind: 'other' }), /Invalid media job kind/);
  await assert.rejects(() => jobs.claimBatch({ workerId: ' ' }), /worker id is required/);
  await assert.rejects(() => jobs.claimBatch({ workerId: null }), /worker id is required/);

  const [claimed, ...rest] = await jobs.claimBatch({ workerId: ' worker-1 ', limit: 999, leaseMs: 9_999_999 });
  assert.deepEqual(rest, [], 'only the due process job');
  assert.equal(claimed?.id, due?.id);
  assert.deepEqual([claimed?.state, claimed?.claimedBy, claimed?.attempts], ['processing', 'worker-1', 1]);
  const token = claimed?.fencingToken ?? 0;
  assert.deepEqual(await jobs.claimBatch({ workerId: 'worker-2' }), [], 'a live lease is not reclaimed');

  await expireLease(pool, claimed?.id ?? '');
  const [reclaimed] = await jobs.claimBatch({ workerId: 'worker-2', limit: 0, leaseMs: 'bad' });
  assert.equal(reclaimed?.id, claimed?.id);
  assert.equal(reclaimed?.fencingToken, token + 1, 'every claim moves the fence');
  assert.equal(reclaimed?.attempts, 2);
  const [cleanupJob] = await jobs.claimBatch({ workerId: 'worker-3', kind: 'cleanup', limit: 1, leaseMs: 5_000 });
  assert.equal(cleanupJob?.kind, 'cleanup');
});

test('renew, complete and fail work only while the lease and fence are held', { skip }, async (t) => {
  const { pool, jobs, processing } = await setup(t);
  await jobs.enqueue(await processing());
  const [job] = await jobs.claimBatch({ workerId: 'worker-1' });
  assert.ok(job);
  const lease = { workerId: 'worker-1', fencingToken: job.fencingToken };

  assert.equal((await jobs.renew(job.id, { ...lease, leaseMs: 0 })).id, job.id);
  await assert.rejects(() => jobs.renew(job.id, { ...lease, fencingToken: job.fencingToken + 1 }), MediaJobFenceError);
  await assert.rejects(() => jobs.complete(job.id, { ...lease, workerId: 'worker-2' }), MediaJobFenceError);

  const retried = await jobs.fail(job.id, {
    ...lease,
    error: new Error('failed'),
    retryDelayMs: 9_999_999,
    maxAttempts: 999
  });
  assert.deepEqual([retried.state, retried.lastError, retried.claimedBy], ['pending', 'failed', null]);
  assert.ok(new Date(retried.availableAt as Date).getTime() > Date.now() + 60_000, 'retried after the delay');
  await assert.rejects(() => jobs.fail(job.id, lease), MediaJobFenceError, 'a failed job no longer holds the lease');

  await pool.query(`UPDATE media_processing_jobs SET available_at = current_timestamp WHERE id = $1`, [job.id]);
  const [again] = await jobs.claimBatch({ workerId: 'worker-1' });
  assert.ok(again);
  const dead = await jobs.fail(again.id, {
    workerId: 'worker-1',
    fencingToken: again.fencingToken,
    error: null,
    retryDelayMs: 0,
    maxAttempts: 2
  });
  assert.deepEqual([dead.state, dead.lastError], ['dead', 'Media job failed']);
  assert.ok(dead.deadAt);

  await jobs.enqueue(await processing());
  const [next] = await jobs.claimBatch({ workerId: 'worker-1' });
  assert.ok(next);
  const plain = await jobs.fail(next.id, {
    workerId: 'worker-1',
    fencingToken: next.fencingToken,
    error: 'plain failure'
  });
  assert.equal(plain.lastError, 'plain failure');

  await pool.query(`UPDATE media_processing_jobs SET available_at = current_timestamp WHERE id = $1`, [next.id]);
  const [last] = await jobs.claimBatch({ workerId: 'worker-1' });
  assert.ok(last);
  const completed = await jobs.complete(last.id, { workerId: 'worker-1', fencingToken: last.fencingToken });
  assert.deepEqual([completed.state, completed.claimedBy], ['completed', null]);
  await assert.rejects(
    () => jobs.renew(last.id, { workerId: 'worker-1', fencingToken: last.fencingToken }),
    MediaJobFenceError,
    'a completed job has no lease to renew'
  );
});

test('jobs are found by id, the backlog has an age, and finished jobs are pruned', { skip }, async (t) => {
  const { pool, jobs, processing } = await setup(t);
  assert.equal(await jobs.oldestPendingAgeMs(), 0);
  const pending = await jobs.enqueue(await processing());
  assert.ok(pending);
  await pool.query(
    `UPDATE media_processing_jobs SET created_at = current_timestamp - interval '5 seconds' WHERE id = $1`,
    [pending.id]
  );
  assert.equal((await jobs.findById(pending.id))?.id, pending.id);
  assert.equal(await jobs.findById(crypto.randomUUID()), null);
  assert.ok((await jobs.oldestPendingAgeMs()) >= 5_000);

  const finished: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    await jobs.enqueue(await processing());
  }
  for (const job of await jobs.claimBatch({ workerId: 'worker-1', limit: 10 })) {
    await jobs.complete(job.id, { workerId: 'worker-1', fencingToken: job.fencingToken });
    finished.push(job.id);
  }
  const later = new Date(Date.now() + 1_000);
  const firstBatch = await jobs.removeTerminalBefore(later, { limit: 2 });
  assert.equal(firstBatch.length, 2);
  const rest = await jobs.removeTerminalBefore(later, { limit: 0 });
  assert.deepEqual([...firstBatch, ...rest].sort(), finished.sort());
  assert.equal(await jobs.findById(finished[0] ?? ''), null);
});

test('completion marks the attachment ready and the job done together, or neither', { skip }, async (t) => {
  const { pool, attachments, jobs, processing } = await setup(t);
  const attachmentId = await processing();
  await jobs.enqueue(attachmentId);
  const [job] = await jobs.claimBatch({ workerId: 'worker-1' });
  assert.ok(job);
  const lease = { workerId: 'worker-1', fencingToken: job.fencingToken };
  const complete = (overrides: Partial<Parameters<typeof jobs.completeProcessing>[1]> = {}, repository = jobs) =>
    repository.completeProcessing(job.id, {
      ...lease,
      attachmentRepository: attachments,
      attachmentResult: READY_RESULT,
      ...overrides
    });

  await assert.rejects(() => complete({ fencingToken: job.fencingToken + 1 }), MediaJobFenceError);
  await assert.rejects(
    () => complete({ attachmentRepository: fake<AttachmentRepository>({ markReady: async () => null }) }),
    /no longer processable/
  );
  assert.equal((await jobs.findById(job.id))?.state, 'processing', 'nothing changed');

  // The attachment turns ready but the job's lease is gone before it completes.
  await assert.rejects(
    () =>
      complete({
        attachmentRepository: fake<AttachmentRepository>({
          async markReady(id, ready, client) {
            const marked = await attachments.markReady(id, ready, client);
            await client?.query(`UPDATE media_processing_jobs SET claimed_by = 'someone-else' WHERE id = $1`, [job.id]);
            return marked;
          }
        })
      }),
    MediaJobFenceError
  );
  assert.equal((await attachments.findById(attachmentId))?.state, 'processing', 'the attachment rolled back too');

  const ready = await complete();
  assert.equal(ready.state, 'ready');
  assert.equal((await jobs.findById(job.id))?.state, 'completed');

  await assert.rejects(
    () => complete({}, createMediaJobRepository({ pool: { query: pool.query.bind(pool) } })),
    /completion dependencies are required/
  );
  await assert.rejects(
    () => complete({ attachmentRepository: fake<AttachmentRepository>() }),
    /completion dependencies are required/
  );
});

test('completion always gives its connection back, even when the transaction plumbing fails', { skip }, async (t) => {
  const { pool } = await setup(t);
  let failOn = '';
  let releases = 0;
  const faulty = {
    query: pool.query.bind(pool),
    async connect() {
      const client = await pool.connect();
      const query = client.query.bind(client) as (text: string, values?: unknown[]) => Promise<unknown>;
      return Object.assign(Object.create(client) as pg.PoolClient, {
        query: (text: string, values?: unknown[]) =>
          text === failOn ? Promise.reject(new Error(`${text} failed`)) : query(text, values),
        release: () => {
          releases += 1;
          client.release();
          if (failOn === 'release') throw new Error('release failed');
        }
      });
    }
  };
  const jobs = createMediaJobRepository({ pool: faulty });
  const attempt = () =>
    jobs.completeProcessing(crypto.randomUUID(), {
      workerId: 'worker-1',
      fencingToken: 1,
      attachmentRepository: fake<AttachmentRepository>({ markReady: async () => null }),
      attachmentResult: READY_RESULT
    });

  failOn = 'BEGIN';
  await assert.rejects(attempt, /BEGIN failed/);
  failOn = 'ROLLBACK';
  await assert.rejects(attempt, MediaJobFenceError, 'a failing rollback does not hide the cause');
  failOn = 'release';
  await assert.rejects(attempt, /release failed/);
  assert.equal(releases, 3);
});
