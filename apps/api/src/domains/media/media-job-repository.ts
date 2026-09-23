import crypto from 'node:crypto';
import type pg from 'pg';
import type { Attachment, AttachmentRepository } from './attachment-repository.ts';

type QueryClient = Pick<pg.PoolClient, 'query'>;
type JobPool = QueryClient & { connect?: () => Promise<pg.PoolClient> };
type Client = QueryClient | null | undefined;

export type MediaJobKind = 'process' | 'cleanup';

type MediaJobRow = {
  id: string;
  attachment_id: string;
  kind: MediaJobKind;
  state: 'pending' | 'processing' | 'completed' | 'dead';
  attempts: number;
  available_at: unknown;
  claimed_by: string | null;
  claimed_at: unknown;
  lease_expires_at: unknown;
  fencing_token: string | number;
  last_error: string | null;
  created_at: unknown;
  updated_at: unknown;
  completed_at: unknown;
  dead_at: unknown;
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

function createMediaJobRepository({ pool }: { pool?: JobPool | null } = {}) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('A PostgreSQL pool is required');
  const db = pool;
  const executor = (client: Client): QueryClient => client && typeof client.query === 'function' ? client : db;

  async function enqueue(attachmentId: string, { kind = 'process', availableAt = new Date(), client }: {
    kind?: string;
    availableAt?: Date;
    client?: Client;
  } = {}): Promise<MediaJob | null> {
    if (!JOB_KINDS.has(kind)) throw new TypeError('Invalid media job kind');
    const query = executor(client);
    const existing = await query.query<MediaJobRow>(
      `SELECT * FROM media_processing_jobs
       WHERE attachment_id = $1 AND kind = $2 AND state IN ('pending', 'processing')`,
      [attachmentId, kind]
    );
    if (existing.rows[0]) return mapMediaJob(existing.rows[0]);
    const result = await query.query<MediaJobRow>(
      `INSERT INTO media_processing_jobs (id, attachment_id, kind, available_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (attachment_id, kind) WHERE state IN ('pending', 'processing') DO NOTHING
       RETURNING *`,
      [crypto.randomUUID(), attachmentId, kind, availableAt]
    );
    if (result.rows[0]) return mapMediaJob(result.rows[0]);
    const raced = await query.query<MediaJobRow>(
      `SELECT * FROM media_processing_jobs
       WHERE attachment_id = $1 AND kind = $2 AND state IN ('pending', 'processing')`,
      [attachmentId, kind]
    );
    return mapMediaJob(raced.rows[0]);
  }

  async function claimBatch({
    workerId,
    kind = 'process',
    limit = 10,
    leaseMs = 120_000,
    client
  }: { workerId: unknown; kind?: string; limit?: unknown; leaseMs?: unknown; client?: Client }): Promise<MediaJob[]> {
    if (!JOB_KINDS.has(kind)) throw new TypeError('Invalid media job kind');
    if (typeof workerId !== 'string' || !workerId.trim()) throw new TypeError('A media worker id is required');
    const result = await executor(client).query<MediaJobRow>(
      `WITH candidates AS (
         SELECT id FROM media_processing_jobs
         WHERE kind = $1 AND (
           (state = 'pending' AND available_at <= current_timestamp) OR
           (state = 'processing' AND lease_expires_at <= current_timestamp)
         )
         ORDER BY available_at ASC, created_at ASC, id ASC
         FOR UPDATE SKIP LOCKED LIMIT $2
       )
       UPDATE media_processing_jobs AS job
       SET state = 'processing', attempts = attempts + 1, claimed_by = $3,
           claimed_at = current_timestamp,
           lease_expires_at = current_timestamp + ($4 * interval '1 millisecond'),
           fencing_token = fencing_token + 1, last_error = NULL,
           completed_at = NULL, dead_at = NULL, updated_at = current_timestamp
       FROM candidates WHERE job.id = candidates.id
       RETURNING job.*`,
      [
        kind,
        positiveInteger(limit, 10, 100),
        workerId.trim(),
        positiveInteger(leaseMs, 120_000, 15 * 60 * 1000)
      ]
    );
    return result.rows.map(mapMediaJob) as MediaJob[];
  }

  async function renew(jobId: string, { workerId, fencingToken, leaseMs = 120_000, client }: JobLease & { leaseMs?: unknown }): Promise<MediaJob> {
    const result = await executor(client).query<MediaJobRow>(
      `UPDATE media_processing_jobs
       SET lease_expires_at = current_timestamp + ($4 * interval '1 millisecond'),
           updated_at = current_timestamp
       WHERE id = $1 AND state = 'processing' AND claimed_by = $2 AND fencing_token = $3
         AND lease_expires_at > current_timestamp
       RETURNING *`,
      [jobId, workerId, fencingToken, positiveInteger(leaseMs, 120_000, 15 * 60 * 1000)]
    );
    if (!result.rows[0]) throw new MediaJobFenceError();
    return mapMediaJob(result.rows[0]) as MediaJob;
  }

  async function complete(jobId: string, { workerId, fencingToken, client }: JobLease): Promise<MediaJob> {
    const result = await executor(client).query<MediaJobRow>(
      `UPDATE media_processing_jobs
       SET state = 'completed', completed_at = current_timestamp, claimed_by = NULL,
           claimed_at = NULL, lease_expires_at = NULL, last_error = NULL,
           updated_at = current_timestamp
       WHERE id = $1 AND state = 'processing' AND claimed_by = $2 AND fencing_token = $3
         AND lease_expires_at > current_timestamp
       RETURNING *`,
      [jobId, workerId, fencingToken]
    );
    if (!result.rows[0]) throw new MediaJobFenceError();
    return mapMediaJob(result.rows[0]) as MediaJob;
  }

  async function fail(jobId: string, {
    workerId,
    fencingToken,
    error,
    retryDelayMs = 5_000,
    maxAttempts = 5,
    client
  }: JobLease & { error?: unknown; retryDelayMs?: unknown; maxAttempts?: unknown }): Promise<MediaJob> {
    const message = String((error as { message?: unknown } | null | undefined)?.message || error || 'Media job failed').slice(0, 2_000);
    const result = await executor(client).query<MediaJobRow>(
      `UPDATE media_processing_jobs
       SET state = CASE WHEN attempts >= $4 THEN 'dead' ELSE 'pending' END,
           available_at = CASE WHEN attempts >= $4 THEN available_at
             ELSE current_timestamp + ($5 * interval '1 millisecond') END,
           dead_at = CASE WHEN attempts >= $4 THEN current_timestamp ELSE NULL END,
           completed_at = NULL, claimed_by = NULL, claimed_at = NULL, lease_expires_at = NULL,
           last_error = $6, updated_at = current_timestamp
       WHERE id = $1 AND state = 'processing' AND claimed_by = $2 AND fencing_token = $3
         AND lease_expires_at > current_timestamp
       RETURNING *`,
      [
        jobId,
        workerId,
        fencingToken,
        positiveInteger(maxAttempts, 5, 100),
        positiveInteger(retryDelayMs, 5_000, 15 * 60 * 1000),
        message
      ]
    );
    if (!result.rows[0]) throw new MediaJobFenceError();
    return mapMediaJob(result.rows[0]) as MediaJob;
  }

  async function findById(id: string, { client }: { client?: Client } = {}): Promise<MediaJob | null> {
    const result = await executor(client).query<MediaJobRow>('SELECT * FROM media_processing_jobs WHERE id = $1', [id]);
    return mapMediaJob(result.rows[0]);
  }

  async function oldestPendingAgeMs({ client }: { client?: Client } = {}): Promise<number> {
    const result = await executor(client).query<{ age_ms: string | number | null }>(
      `SELECT COALESCE(EXTRACT(EPOCH FROM (current_timestamp-MIN(created_at)))*1000,0)::bigint AS age_ms
       FROM media_processing_jobs WHERE state IN ('pending', 'processing')`
    );
    return Number(result.rows[0]?.age_ms || 0);
  }

  async function removeTerminalBefore(before: Date, { limit = 500, client }: { limit?: unknown; client?: Client } = {}): Promise<string[]> {
    const result = await executor(client).query<{ id: string }>(
      `WITH candidates AS (
         SELECT id FROM media_processing_jobs
         WHERE state IN ('completed', 'dead') AND updated_at < $1
         ORDER BY updated_at ASC, id ASC LIMIT $2
       )
       DELETE FROM media_processing_jobs AS job USING candidates
       WHERE job.id = candidates.id RETURNING job.id`,
      [before, positiveInteger(limit, 500, 500)]
    );
    return result.rows.map((row) => row.id);
  }

  async function completeProcessing(jobId: string, {
    workerId,
    fencingToken,
    attachmentRepository,
    attachmentResult
  }: {
    workerId: string;
    fencingToken: number;
    attachmentRepository?: Pick<AttachmentRepository, 'markReady'> | null;
    attachmentResult: Parameters<AttachmentRepository['markReady']>[1];
  }): Promise<Attachment> {
    if (!db.connect || !attachmentRepository?.markReady) throw new TypeError('Processing completion dependencies are required');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const owned = await client.query<{ attachment_id: string }>(
        `SELECT attachment_id FROM media_processing_jobs
         WHERE id = $1 AND state = 'processing' AND claimed_by = $2 AND fencing_token = $3
           AND lease_expires_at > current_timestamp FOR UPDATE`,
        [jobId, workerId, fencingToken]
      );
      const row = owned.rows[0];
      if (!row) throw new MediaJobFenceError();
      const attachment = await attachmentRepository.markReady(row.attachment_id, attachmentResult, client);
      if (!attachment) throw new Error('Attachment is no longer processable');
      await complete(jobId, { workerId, fencingToken, client });
      await client.query('COMMIT');
      return attachment;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  return Object.freeze({ claimBatch, complete, completeProcessing, enqueue, fail, findById, oldestPendingAgeMs, removeTerminalBefore, renew });
}

export type MediaJobRepository = ReturnType<typeof createMediaJobRepository>;

export { MediaJobFenceError, createMediaJobRepository, mapMediaJob };
