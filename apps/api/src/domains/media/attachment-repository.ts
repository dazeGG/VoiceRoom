import crypto from 'node:crypto';
import type pg from 'pg';

type QueryClient = Pick<pg.PoolClient, 'query'>;
type AttachmentPool = QueryClient & { connect?: () => Promise<pg.PoolClient> };
type Client = QueryClient | null | undefined;

export type AttachmentContext = 'room' | 'dm';
export type AttachmentState = 'uploading' | 'processing' | 'ready' | 'failed' | 'deleted';

type AttachmentRow = {
  id: string;
  owner_id: string;
  context: AttachmentContext;
  state: AttachmentState;
  client_request_id: string | null;
  reserved_bytes: string | number | null;
  reservation_expires_at: unknown;
  mime_type: string | null;
  original_bytes: string | number | null;
  processed_bytes: string | number | null;
  preview_bytes: string | number | null;
  width: number | null;
  height: number | null;
  original_storage_key: string | null;
  processed_storage_key: string | null;
  preview_storage_key: string | null;
  room_message_id: string | null;
  direct_message_id: string | null;
  attachment_order: number;
  failure_code: string | null;
  metadata: Record<string, unknown> | null;
  created_at: unknown;
  updated_at: Date | string;
  uploaded_at: unknown;
  ready_at: unknown;
  failed_at: unknown;
  bound_at: unknown;
  deleted_at: unknown;
};

export type Attachment = Readonly<{
  id: string;
  ownerId: string;
  context: AttachmentContext;
  state: 'pending' | Exclude<AttachmentState, 'uploading'>;
  internalState: AttachmentState;
  clientRequestId: string | null;
  reservedBytes: number | null;
  reservationExpiresAt: unknown;
  mimeType: string | null;
  originalBytes: number | null;
  processedBytes: number | null;
  previewBytes: number | null;
  width: number | null;
  height: number | null;
  storageKeys: Readonly<{ original: string | null; processed: string | null; preview: string | null }>;
  roomMessageId: string | null;
  directMessageId: string | null;
  order: number;
  failureCode: string | null;
  metadata: Record<string, unknown>;
  createdAt: unknown;
  updatedAt: Date | string;
  uploadedAt: unknown;
  readyAt: unknown;
  failedAt: unknown;
  boundAt: unknown;
  deletedAt: unknown;
}>;

export type AttachmentDraft = {
  id?: string;
  ownerId: unknown;
  context: unknown;
  clientRequestId?: unknown;
  reservedBytes?: number | null;
  reservationExpiresAt?: Date | null;
  metadata?: unknown;
};

const CONTEXTS = new Set<string>(['room', 'dm']);
const MIME_TYPES = new Set<unknown>(['image/jpeg', 'image/png', 'image/webp']);
const CLEANUP_CANDIDATE_PREDICATE = `
         (state = 'uploading' AND updated_at <= current_timestamp - interval '1 hour') OR
         (state = 'failed' AND updated_at <= current_timestamp - interval '1 hour') OR
         (state = 'ready' AND bound_at IS NULL AND updated_at <= current_timestamp - interval '24 hours')`;

function requiredText(value: unknown, name: string, max = 256): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > max) throw new TypeError(`Invalid ${name}`);
  return normalized;
}

function mapAttachment(row: AttachmentRow | null | undefined): Attachment | null {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    ownerId: row.owner_id,
    context: row.context,
    state: row.state === 'uploading' ? 'pending' : row.state,
    internalState: row.state,
    clientRequestId: row.client_request_id,
    reservedBytes: row.reserved_bytes == null ? null : Number(row.reserved_bytes),
    reservationExpiresAt: row.reservation_expires_at,
    mimeType: row.mime_type,
    originalBytes: row.original_bytes == null ? null : Number(row.original_bytes),
    processedBytes: row.processed_bytes == null ? null : Number(row.processed_bytes),
    previewBytes: row.preview_bytes == null ? null : Number(row.preview_bytes),
    width: row.width,
    height: row.height,
    storageKeys: Object.freeze({
      original: row.original_storage_key,
      processed: row.processed_storage_key,
      preview: row.preview_storage_key
    }),
    roomMessageId: row.room_message_id,
    directMessageId: row.direct_message_id,
    order: row.attachment_order,
    failureCode: row.failure_code,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    uploadedAt: row.uploaded_at,
    readyAt: row.ready_at,
    failedAt: row.failed_at,
    boundAt: row.bound_at,
    deletedAt: row.deleted_at
  });
}

function createAttachmentRepository({ pool }: { pool?: AttachmentPool | null } = {}) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('A PostgreSQL pool is required');
  const db = pool;
  const executor = (client: Client): QueryClient => client && typeof client.query === 'function' ? client : db;

  async function createDraft({
    id = crypto.randomUUID(),
    ownerId,
    context,
    clientRequestId = null,
    reservedBytes = null,
    reservationExpiresAt = null,
    metadata = {}
  }: AttachmentDraft, client?: Client): Promise<Attachment | null> {
    const normalizedContext = requiredText(context, 'attachment context', 8);
    if (!CONTEXTS.has(normalizedContext)) throw new TypeError('Invalid attachment context');
    const result = await executor(client).query<AttachmentRow>(
      `INSERT INTO message_attachments (
         id, owner_id, context, client_request_id, reserved_bytes, reservation_expires_at, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (owner_id, context, client_request_id) WHERE client_request_id IS NOT NULL
       DO UPDATE SET client_request_id = EXCLUDED.client_request_id
       RETURNING *`,
      [
        id,
        requiredText(ownerId, 'attachment owner', 36),
        normalizedContext,
        clientRequestId == null ? null : requiredText(clientRequestId, 'client request id', 128),
        reservedBytes,
        reservationExpiresAt,
        metadata
      ]
    );
    return mapAttachment(result.rows[0]);
  }

  async function findById(id: string, { forUpdate = false, client }: { forUpdate?: boolean; client?: Client } = {}): Promise<Attachment | null> {
    const result = await executor(client).query<AttachmentRow>(
      `SELECT * FROM message_attachments WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
      [id]
    );
    return mapAttachment(result.rows[0]);
  }

  async function listOwnerDrafts(ownerId: string, context: string, { limit = 20, client }: { limit?: unknown; client?: Client } = {}): Promise<Attachment[]> {
    const result = await executor(client).query<AttachmentRow>(
      `SELECT * FROM message_attachments
       WHERE owner_id = $1 AND context = $2 AND bound_at IS NULL AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC LIMIT $3`,
      [ownerId, context, Math.max(1, Math.min(Number(limit) || 20, 100))]
    );
    return result.rows.map(mapAttachment) as Attachment[];
  }

  async function findByClientRequest(ownerId: string, context: string, clientRequestId: string, { client }: { client?: Client } = {}): Promise<Attachment | null> {
    const result = await executor(client).query<AttachmentRow>(
      `SELECT * FROM message_attachments
       WHERE owner_id = $1 AND context = $2 AND client_request_id = $3`,
      [ownerId, context, clientRequestId]
    );
    return mapAttachment(result.rows[0]);
  }

  async function markUploaded(id: string, {
    mimeType,
    bytes,
    width,
    height,
    originalStorageKey
  }: { mimeType: string; bytes: number; width: number; height: number; originalStorageKey: string }, client?: Client): Promise<Attachment | null> {
    if (!MIME_TYPES.has(mimeType)) throw new TypeError('Invalid attachment MIME type');
    const result = await executor(client).query<AttachmentRow>(
      `UPDATE message_attachments
       SET state = 'processing', mime_type = $2, original_bytes = $3, width = $4, height = $5,
           original_storage_key = $6, uploaded_at = current_timestamp, failure_code = NULL,
           failed_at = NULL, reserved_bytes = NULL, reservation_expires_at = NULL,
           updated_at = current_timestamp
       WHERE id = $1 AND state = 'uploading' AND bound_at IS NULL
       RETURNING *`,
      [id, mimeType, bytes, width, height, requiredText(originalStorageKey, 'original storage key', 512)]
    );
    return mapAttachment(result.rows[0]);
  }

  async function retryProcessing(id: string, client?: Client): Promise<Attachment | null> {
    const result = await executor(client).query<AttachmentRow>(
      `UPDATE message_attachments
       SET state = 'processing', failure_code = NULL, failed_at = NULL, updated_at = current_timestamp
       WHERE id = $1 AND state = 'failed' AND bound_at IS NULL AND original_storage_key IS NOT NULL
       RETURNING *`,
      [id]
    );
    return mapAttachment(result.rows[0]);
  }

  async function markReady(id: string, {
    processedStorageKey,
    previewStorageKey,
    processedBytes,
    previewBytes
  }: { processedStorageKey: string; previewStorageKey: string; processedBytes: number; previewBytes: number }, client?: Client): Promise<Attachment | null> {
    const result = await executor(client).query<AttachmentRow>(
      `UPDATE message_attachments
       SET state = 'ready', processed_storage_key = $2, preview_storage_key = $3,
           processed_bytes = $4, preview_bytes = $5, ready_at = current_timestamp,
           failure_code = NULL, failed_at = NULL, updated_at = current_timestamp
       WHERE id = $1 AND state = 'processing'
       RETURNING *`,
      [
        id,
        requiredText(processedStorageKey, 'processed storage key', 512),
        requiredText(previewStorageKey, 'preview storage key', 512),
        processedBytes,
        previewBytes
      ]
    );
    return mapAttachment(result.rows[0]);
  }

  async function markFailed(id: string, failureCode: unknown, client?: Client): Promise<Attachment | null> {
    const result = await executor(client).query<AttachmentRow>(
      `UPDATE message_attachments
       SET state = 'failed', failure_code = $2, failed_at = current_timestamp,
           ready_at = NULL, reserved_bytes = NULL, reservation_expires_at = NULL,
           updated_at = current_timestamp
       WHERE id = $1 AND state IN ('uploading', 'processing', 'ready')
       RETURNING *`,
      [id, requiredText(failureCode, 'failure code', 64)]
    );
    return mapAttachment(result.rows[0]);
  }

  async function markDeleted(id: string, client?: Client): Promise<Attachment | null> {
    const result = await executor(client).query<AttachmentRow>(
      `UPDATE message_attachments
       SET state = 'deleted', deleted_at = current_timestamp, updated_at = current_timestamp
       WHERE id = $1 AND state <> 'deleted'
       RETURNING *`,
      [id]
    );
    if (result.rows[0]) return mapAttachment(result.rows[0]);
    return findById(id, { client });
  }

  async function bindReady({ ownerId, context, messageId, attachmentIds }: {
    ownerId: string;
    context: string;
    messageId: string;
    attachmentIds: unknown;
  }, client?: Client): Promise<Attachment[]> {
    if (!Array.isArray(attachmentIds) || attachmentIds.length < 1 || attachmentIds.length > 4) {
      throw new TypeError('Between one and four attachment ids are required');
    }
    if (new Set(attachmentIds).size !== attachmentIds.length) {
      throw new TypeError('Attachment ids must be unique');
    }
    const messageColumn = context === 'room' ? 'room_message_id' : context === 'dm' ? 'direct_message_id' : null;
    if (!messageColumn) throw new TypeError('Invalid attachment context');
    const query = executor(client);
    const result = await query.query<AttachmentRow>(
      `WITH requested AS MATERIALIZED (
         SELECT id::uuid, ordinality - 1 AS attachment_order
         FROM unnest($4::text[]) WITH ORDINALITY AS requested(id, ordinality)
       ), candidates AS MATERIALIZED (
         SELECT attachment.id, requested.attachment_order
         FROM message_attachments AS attachment
         JOIN requested ON requested.id = attachment.id
         WHERE attachment.owner_id = $1 AND attachment.context = $2
           AND attachment.state = 'ready' AND attachment.bound_at IS NULL
         FOR UPDATE OF attachment
       )
       UPDATE message_attachments AS attachment
       SET ${messageColumn} = $3, attachment_order = candidates.attachment_order,
           bound_at = current_timestamp, updated_at = current_timestamp
       FROM candidates
       WHERE attachment.id = candidates.id
         AND (SELECT count(*) FROM candidates) = (SELECT count(*) FROM requested)
       RETURNING attachment.*`,
      [ownerId, context, messageId, attachmentIds]
    );
    if (result.rowCount !== attachmentIds.length) {
      throw new Error('One or more attachments cannot be bound');
    }
    return (result.rows.map(mapAttachment) as Attachment[]).sort((left, right) => left.order - right.order);
  }

  async function listForMessage(context: string, messageId: string, { client }: { client?: Client } = {}): Promise<Attachment[]> {
    const column = context === 'room' ? 'room_message_id' : context === 'dm' ? 'direct_message_id' : null;
    if (!column) throw new TypeError('Invalid attachment context');
    const result = await executor(client).query<AttachmentRow>(
      `SELECT * FROM message_attachments WHERE ${column} = $1 ORDER BY attachment_order ASC`,
      [messageId]
    );
    return result.rows.map(mapAttachment) as Attachment[];
  }

  async function listCleanupCandidates({ limit = 500, client }: { limit?: unknown; client?: Client } = {}): Promise<Attachment[]> {
    const result = await executor(client).query<AttachmentRow>(
      `SELECT * FROM message_attachments
       WHERE
${CLEANUP_CANDIDATE_PREDICATE} OR
         (state = 'deleted' AND updated_at <= current_timestamp - interval '1 hour')
       ORDER BY updated_at ASC, id ASC LIMIT $1`,
      [Math.max(1, Math.min(Number(limit) || 500, 500))]
    );
    return result.rows.map(mapAttachment) as Attachment[];
  }

  async function markCleanupDeleted(id: string, client?: Client): Promise<Attachment | null> {
    const result = await executor(client).query<AttachmentRow>(
      `UPDATE message_attachments SET state = 'deleted', deleted_at = current_timestamp,
         updated_at = current_timestamp
       WHERE id = $1 AND (
${CLEANUP_CANDIDATE_PREDICATE}
       ) RETURNING *`,
      [id]
    );
    if (result.rows[0]) return mapAttachment(result.rows[0]);
    const current = await findById(id, { client });
    return current?.internalState === 'deleted' && new Date(current.updatedAt).getTime() <= Date.now() - 60 * 60 * 1000
      ? current
      : null;
  }

  async function listStorageKeys({ afterId = null, limit = 500, client }: { afterId?: string | null; limit?: unknown; client?: Client } = {}):
    Promise<{ id: string; keys: string[] }[]> {
    const result = await executor(client).query<Pick<AttachmentRow, 'id' | 'original_storage_key' | 'processed_storage_key' | 'preview_storage_key'>>(
      `SELECT id, original_storage_key, processed_storage_key, preview_storage_key
       FROM message_attachments WHERE ($1::uuid IS NULL OR id > $1::uuid)
       ORDER BY id ASC LIMIT $2`,
      [afterId, Math.max(1, Math.min(Number(limit) || 500, 2_000))]
    );
    return result.rows.map((row) => ({
      id: row.id,
      keys: [row.original_storage_key, row.processed_storage_key, row.preview_storage_key].filter((key): key is string => Boolean(key))
    }));
  }

  async function listProcessingWithoutActiveJob({ limit = 500, client }: { limit?: unknown; client?: Client } = {}): Promise<Attachment[]> {
    const result = await executor(client).query<AttachmentRow>(
      `SELECT attachment.* FROM message_attachments attachment
       WHERE attachment.state = 'processing'
         AND NOT EXISTS (
           SELECT 1 FROM media_processing_jobs job
           WHERE job.attachment_id = attachment.id AND job.kind = 'process'
             AND job.state IN ('pending', 'processing')
         )
       ORDER BY attachment.updated_at ASC, attachment.id ASC LIMIT $1`,
      [Math.max(1, Math.min(Number(limit) || 500, 500))]
    );
    return result.rows.map(mapAttachment) as Attachment[];
  }

  async function markUnavailable(id: string, failureCode: string = 'media_missing', client?: Client): Promise<Attachment | null> {
    return markFailed(id, failureCode, client);
  }

  async function clearPhysicalData(id: string, client?: Client): Promise<Attachment | null> {
    const result = await executor(client).query<AttachmentRow>(
      `UPDATE message_attachments
       SET original_storage_key = NULL, processed_storage_key = NULL, preview_storage_key = NULL,
           original_bytes = NULL, processed_bytes = NULL, preview_bytes = NULL,
           reserved_bytes = NULL, reservation_expires_at = NULL, updated_at = current_timestamp
       WHERE id = $1 RETURNING *`,
      [id]
    );
    return mapAttachment(result.rows[0]);
  }

  async function quotaUsage(ownerId: string, { since = new Date(Date.now() - 10 * 60 * 1000), client }: { since?: Date; client?: Client } = {}):
    Promise<Readonly<{ pendingCount: number; recentCount: number; usedBytes: number }>> {
    const result = await executor(client).query<{ pending_count?: number; recent_count?: number; used_bytes?: string | number }>(
      `SELECT
         count(*) FILTER (WHERE state = 'uploading')::integer AS pending_count,
         count(*) FILTER (WHERE created_at >= $2)::integer AS recent_count,
         COALESCE(sum(CASE
           WHEN state = 'uploading' THEN reserved_bytes
           WHEN state IN ('processing', 'ready') THEN original_bytes
           ELSE 0 END), 0)::bigint AS used_bytes
       FROM message_attachments
       WHERE owner_id = $1`,
      [ownerId, since]
    );
    const row = result.rows[0] || {};
    return Object.freeze({
      pendingCount: Number(row.pending_count || 0),
      recentCount: Number(row.recent_count || 0),
      usedBytes: Number(row.used_bytes || 0)
    });
  }

  async function lockOwner(ownerId: string, client: Client): Promise<void> {
    if (!client) throw new TypeError('A transaction client is required');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`media-quota:${ownerId}`]);
  }

  async function withAttachmentLock<T>(id: string, operation: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    if (!db.connect) throw new TypeError('The PostgreSQL pool cannot acquire attachment locks');
    const client = await db.connect();
    const key = `media-upload:${id}`;
    try {
      await client.query('SELECT pg_advisory_lock(hashtext($1))', [key]);
      return await operation(client);
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]).catch(() => {});
      client.release();
    }
  }

  return Object.freeze({
    bindReady,
    clearPhysicalData,
    createDraft,
    findByClientRequest,
    findById,
    listCleanupCandidates,
    listForMessage,
    listOwnerDrafts,
    listProcessingWithoutActiveJob,
    listStorageKeys,
    lockOwner,
    markDeleted,
    markCleanupDeleted,
    markFailed,
    markReady,
    markUploaded,
    markUnavailable,
    quotaUsage,
    retryProcessing,
    withAttachmentLock
  });
}

export type AttachmentRepository = ReturnType<typeof createAttachmentRepository>;

export { createAttachmentRepository, mapAttachment };
