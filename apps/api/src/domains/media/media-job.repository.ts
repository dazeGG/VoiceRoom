import crypto from 'node:crypto';
import { sql, type Selectable } from 'kysely';
import type pg from 'pg';
import { kyselyOn, type Database } from '../../platform/db/kysely.ts';
import { transaction } from '../../platform/db/pool.ts';
import type { MediaProcessingJobs } from '../../platform/db/schema.ts';
import type { Attachment, AttachmentRepository } from './attachment.repository.ts';

type QueryClient = Pick<pg.PoolClient, 'query'>;
type JobPool = QueryClient & { connect?: () => Promise<pg.PoolClient> };
type Client = QueryClient | null | undefined;

export type MediaJobKind = 'process' | 'cleanup';

type MediaJobRow = Omit<Selectable<MediaProcessingJobs>, 'kind' | 'state'> & {
  kind: MediaJobKind;
  state: 'pending' | 'processing' | 'completed' | 'dead';
};

export type MediaJob = Readonly<{
  id: string;
  attachmentId: string;
  kind: MediaJobKind;
  state: MediaJobRow['state'];
  attempts: number;
  availableAt: unknown;
  claimedBy: string | null;
  claimedAt: unknown;
  leaseExpiresAt: unknown;
  fencingToken: number;
  lastError: string | null;
  createdAt: unknown;
  updatedAt: unknown;
  completedAt: unknown;
  deadAt: unknown;
}>;

type JobLease = { workerId: string; fencingToken: number; client?: Client };

const JOB_KINDS = new Set<unknown>(['process', 'cleanup']);

class MediaJobFenceError extends Error {
  declare code: string;

  constructor() {
    super('Media job lease is no longer owned by this worker');
    this.name = 'MediaJobFenceError';
    this.code = 'MEDIA_JOB_FENCE_LOST';
  }
}

function mapMediaJob(row: MediaJobRow | null | undefined): MediaJob | null {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    attachmentId: row.attachment_id,
    kind: row.kind,
    state: row.state,
    attempts: row.attempts,
    availableAt: row.available_at,
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at,
    leaseExpiresAt: row.lease_expires_at,
    fencingToken: Number(row.fencing_token),
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    deadAt: row.dead_at
  });
}

function positiveInteger(value: unknown, fallback: number, maximum: number): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, maximum) : fallback;
}

// A job whose lease this worker still holds: the one it claimed, at the fence
// it was given, before the lease ran out.
function ownedJob(q: Database, jobId: string, workerId: string, fencingToken: number) {
  return q
    .updateTable('media_processing_jobs')
    .where('id', '=', jobId)
    .where('state', '=', 'processing')
    .where('claimed_by', '=', workerId)
    .where('fencing_token', '=', String(fencingToken))
    .where('lease_expires_at', '>', sql<Date>`current_timestamp`);
}

const now = sql<Date>`current_timestamp`;
const after = (ms: number) => sql<Date>`current_timestamp + (${ms} * interval '1 millisecond')`;

function createMediaJobRepository({ pool }: { pool?: JobPool | null } = {}) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('A PostgreSQL pool is required');
  const base = pool;
  const on = (client: Client): Database => kyselyOn(client && typeof client.query === 'function' ? client : base);
  const job = (row: Selectable<MediaProcessingJobs> | undefined) => mapMediaJob(row as MediaJobRow | undefined);
  const leased = (row: Selectable<MediaProcessingJobs> | undefined): MediaJob => {
    if (!row) throw new MediaJobFenceError();
    return job(row) as MediaJob;
  };

  // One live (pending or processing) job per attachment and kind.
  async function enqueue(
    attachmentId: string,
    {
      kind = 'process',
      availableAt = new Date(),
      client
    }: {
      kind?: string;
      availableAt?: Date;
      client?: Client;
    } = {}
  ): Promise<MediaJob | null> {
    if (!JOB_KINDS.has(kind)) throw new TypeError('Invalid media job kind');
    const q = on(client);
    const live = () =>
      q
        .selectFrom('media_processing_jobs')
        .selectAll()
        .where('attachment_id', '=', attachmentId)
        .where('kind', '=', kind)
        .where('state', 'in', ['pending', 'processing'])
        .executeTakeFirst();
    const existing = await live();
    if (existing) return job(existing);
    const inserted = await q
      .insertInto('media_processing_jobs')
      .values({ id: crypto.randomUUID(), attachment_id: attachmentId, kind, available_at: availableAt })
      .onConflict((oc) =>
        oc.columns(['attachment_id', 'kind']).where('state', 'in', ['pending', 'processing']).doNothing()
      )
      .returningAll()
      .executeTakeFirst();
    if (inserted) return job(inserted);
    // Another enqueue won the race; answer with its job.
    return job(await live());
  }

  // Claims due jobs, and jobs whose lease ran out, skipping rows another worker
  // holds; every claim bumps the fencing token.
  async function claimBatch({
    workerId,
    kind = 'process',
    limit = 10,
    leaseMs = 120_000,
    client
  }: {
    workerId: unknown;
    kind?: string;
    limit?: unknown;
    leaseMs?: unknown;
    client?: Client;
  }): Promise<MediaJob[]> {
    if (!JOB_KINDS.has(kind)) throw new TypeError('Invalid media job kind');
    if (typeof workerId !== 'string' || !workerId.trim()) throw new TypeError('A media worker id is required');
    const claimed = await on(client)
      .with('candidates', (qb) =>
        qb
          .selectFrom('media_processing_jobs')
          .select('id')
          .where('kind', '=', kind)
          .where((eb) =>
            eb.or([
              eb.and([eb('state', '=', 'pending'), eb('available_at', '<=', now)]),
              eb.and([eb('state', '=', 'processing'), eb('lease_expires_at', '<=', now)])
            ])
          )
          .orderBy('available_at', 'asc')
          .orderBy('created_at', 'asc')
          .orderBy('id', 'asc')
          .forUpdate()
          .skipLocked()
          .limit(positiveInteger(limit, 10, 100))
      )
      .updateTable('media_processing_jobs as job')
      .from('candidates')
      .set((eb) => ({
        state: 'processing',
        attempts: eb('job.attempts', '+', 1),
        claimed_by: workerId.trim(),
        claimed_at: now,
        lease_expires_at: after(positiveInteger(leaseMs, 120_000, 15 * 60 * 1000)),
        fencing_token: sql<string>`job.fencing_token + 1`,
        last_error: null,
        completed_at: null,
        dead_at: null,
        updated_at: now
      }))
      .whereRef('job.id', '=', 'candidates.id')
      .returningAll('job')
      .execute();
    return claimed.map((row) => job(row) as MediaJob);
  }

  async function renew(
    jobId: string,
    { workerId, fencingToken, leaseMs = 120_000, client }: JobLease & { leaseMs?: unknown }
  ): Promise<MediaJob> {
    return leased(
      await ownedJob(on(client), jobId, workerId, fencingToken)
        .set({ lease_expires_at: after(positiveInteger(leaseMs, 120_000, 15 * 60 * 1000)), updated_at: now })
        .returningAll()
        .executeTakeFirst()
    );
  }

  async function complete(jobId: string, { workerId, fencingToken, client }: JobLease): Promise<MediaJob> {
    return leased(
      await ownedJob(on(client), jobId, workerId, fencingToken)
        .set({
          state: 'completed',
          completed_at: now,
          claimed_by: null,
          claimed_at: null,
          lease_expires_at: null,
          last_error: null,
          updated_at: now
        })
        .returningAll()
        .executeTakeFirst()
    );
  }

  // A failed attempt goes back to pending after the retry delay, or dead once
  // it has used its attempts.
  async function fail(
    jobId: string,
    {
      workerId,
      fencingToken,
      error,
      retryDelayMs = 5_000,
      maxAttempts = 5,
      client
    }: JobLease & { error?: unknown; retryDelayMs?: unknown; maxAttempts?: unknown }
  ): Promise<MediaJob> {
    const reason = (error as { message?: unknown } | null | undefined)?.message || error || 'Media job failed';
    const message = (typeof reason === 'string' ? reason : 'Media job failed').slice(0, 2_000);
    const attemptsLeft = sql<boolean>`attempts < ${positiveInteger(maxAttempts, 5, 100)}`;
    return leased(
      await ownedJob(on(client), jobId, workerId, fencingToken)
        .set({
          state: sql<string>`CASE WHEN ${attemptsLeft} THEN 'pending' ELSE 'dead' END`,
          available_at: sql<Date>`CASE WHEN ${attemptsLeft}
            THEN ${after(positiveInteger(retryDelayMs, 5_000, 15 * 60 * 1000))} ELSE available_at END`,
          dead_at: sql<Date | null>`CASE WHEN ${attemptsLeft} THEN NULL ELSE current_timestamp END`,
          completed_at: null,
          claimed_by: null,
          claimed_at: null,
          lease_expires_at: null,
          last_error: message,
          updated_at: now
        })
        .returningAll()
        .executeTakeFirst()
    );
  }

  async function findById(id: string, { client }: { client?: Client } = {}): Promise<MediaJob | null> {
    return job(
      await on(client).selectFrom('media_processing_jobs').selectAll().where('id', '=', id).executeTakeFirst()
    );
  }

  async function oldestPendingAgeMs({ client }: { client?: Client } = {}): Promise<number> {
    const row = await on(client)
      .selectFrom('media_processing_jobs')
      .select(
        sql<string>`COALESCE(EXTRACT(EPOCH FROM (current_timestamp - MIN(created_at))) * 1000, 0)::bigint`.as('age_ms')
      )
      .where('state', 'in', ['pending', 'processing'])
      .executeTakeFirst();
    return Number(row?.age_ms || 0);
  }

  async function removeTerminalBefore(
    before: Date,
    { limit = 500, client }: { limit?: unknown; client?: Client } = {}
  ): Promise<string[]> {
    const removed = await on(client)
      .deleteFrom('media_processing_jobs')
      .where('id', 'in', (eb) =>
        eb
          .selectFrom('media_processing_jobs')
          .select('id')
          .where('state', 'in', ['completed', 'dead'])
          .where('updated_at', '<', before)
          .orderBy('updated_at', 'asc')
          .orderBy('id', 'asc')
          .limit(positiveInteger(limit, 500, 500))
      )
      .returning('id')
      .execute();
    return removed.map((row) => row.id);
  }

  // The attachment turns ready and its job completes in one transaction, and
  // only while this worker still holds the job's lease.
  async function completeProcessing(
    jobId: string,
    {
      workerId,
      fencingToken,
      attachmentRepository,
      attachmentResult
    }: {
      workerId: string;
      fencingToken: number;
      attachmentRepository?: Pick<AttachmentRepository, 'markReady'> | null;
      attachmentResult: Parameters<AttachmentRepository['markReady']>[1];
    }
  ): Promise<Attachment> {
    if (!base.connect || !attachmentRepository?.markReady)
      throw new TypeError('Processing completion dependencies are required');
    return transaction(base as Pick<pg.Pool, 'connect'>, async (client) => {
      const owned = await kyselyOn(client)
        .selectFrom('media_processing_jobs')
        .select('attachment_id')
        .where('id', '=', jobId)
        .where('state', '=', 'processing')
        .where('claimed_by', '=', workerId)
        .where('fencing_token', '=', String(fencingToken))
        .where('lease_expires_at', '>', now)
        .forUpdate()
        .executeTakeFirst();
      if (!owned) throw new MediaJobFenceError();
      const attachment = await attachmentRepository.markReady(owned.attachment_id, attachmentResult, client);
      if (!attachment) throw new Error('Attachment is no longer processable');
      await complete(jobId, { workerId, fencingToken, client });
      return attachment;
    });
  }

  return Object.freeze({
    claimBatch,
    complete,
    completeProcessing,
    enqueue,
    fail,
    findById,
    oldestPendingAgeMs,
    removeTerminalBefore,
    renew
  });
}

export type MediaJobRepository = ReturnType<typeof createMediaJobRepository>;

export { MediaJobFenceError, createMediaJobRepository, mapMediaJob };
