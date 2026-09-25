import crypto from 'node:crypto';
import { sql, type Selectable } from 'kysely';
import type pg from 'pg';
import { kyselyOn, type Database } from '../../platform/db/kysely.ts';
import type { MessageAttachments } from '../../platform/db/schema.ts';

type QueryClient = Pick<pg.PoolClient, 'query'>;
type AttachmentPool = QueryClient & { connect?: () => Promise<pg.PoolClient> };
type Client = QueryClient | null | undefined;

export type AttachmentContext = 'room' | 'dm';
export type AttachmentState = 'uploading' | 'processing' | 'ready' | 'failed' | 'deleted';

type AttachmentRow = Omit<Selectable<MessageAttachments>, 'context' | 'state' | 'metadata'> & {
  context: AttachmentContext;
  state: AttachmentState;
  metadata: Record<string, unknown> | null;
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
// Uploads that never finished, failures, and ready files nobody sent.
const CLEANUP_CANDIDATE_PREDICATE = sql<boolean>`(
  (state = 'uploading' AND updated_at <= current_timestamp - interval '1 hour') OR
  (state = 'failed' AND updated_at <= current_timestamp - interval '1 hour') OR
  (state = 'ready' AND bound_at IS NULL AND updated_at <= current_timestamp - interval '24 hours')
)`;
const now = sql<Date>`current_timestamp`;

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
    order: row.attachment_order ?? 0,
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
  const base = pool;
  const on = (client: Client): Database => kyselyOn(client && typeof client.query === 'function' ? client : base);
  const rows = (query: Promise<Selectable<MessageAttachments>[]>) =>
    query.then((found) => found.map((row) => mapAttachment(row as AttachmentRow) as Attachment));
  const row = (query: Promise<Selectable<MessageAttachments> | undefined>) =>
    query.then((found) => mapAttachment(found as AttachmentRow | undefined));

  async function createDraft(
    {
      id = crypto.randomUUID(),
      ownerId,
      context,
      clientRequestId = null,
      reservedBytes = null,
      reservationExpiresAt = null,
      metadata = {}
    }: AttachmentDraft,
    client?: Client
  ): Promise<Attachment | null> {
    const normalizedContext = requiredText(context, 'attachment context', 8);
    if (!CONTEXTS.has(normalizedContext)) throw new TypeError('Invalid attachment context');
    return row(
      on(client)
        .insertInto('message_attachments')
        .values({
          id,
          owner_id: requiredText(ownerId, 'attachment owner', 36),
          context: normalizedContext,
          client_request_id: clientRequestId == null ? null : requiredText(clientRequestId, 'client request id', 128),
          reserved_bytes: reservedBytes,
          reservation_expires_at: reservationExpiresAt,
          metadata: JSON.stringify(metadata ?? {})
        })
        // A retried draft (same client request) answers with the one already made.
        .onConflict((oc) =>
          oc
            .columns(['owner_id', 'context', 'client_request_id'])
            .where('client_request_id', 'is not', null)
            .doUpdateSet((eb) => ({ client_request_id: eb.ref('excluded.client_request_id') }))
        )
        .returningAll()
        .executeTakeFirst()
    );
  }

  async function findById(
    id: string,
    { forUpdate = false, client }: { forUpdate?: boolean; client?: Client } = {}
  ): Promise<Attachment | null> {
    const query = on(client).selectFrom('message_attachments').selectAll().where('id', '=', id);
    return row((forUpdate ? query.forUpdate() : query).executeTakeFirst());
  }

  async function listOwnerDrafts(
    ownerId: string,
    context: string,
    { limit = 20, client }: { limit?: unknown; client?: Client } = {}
  ): Promise<Attachment[]> {
    return rows(
      on(client)
        .selectFrom('message_attachments')
        .selectAll()
        .where('owner_id', '=', ownerId)
        .where('context', '=', context)
        .where('bound_at', 'is', null)
        .where('deleted_at', 'is', null)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(Math.max(1, Math.min(Number(limit) || 20, 100)))
        .execute()
    );
  }

  async function findByClientRequest(
    ownerId: string,
    context: string,
    clientRequestId: string,
    { client }: { client?: Client } = {}
  ): Promise<Attachment | null> {
    return row(
      on(client)
        .selectFrom('message_attachments')
        .selectAll()
        .where('owner_id', '=', ownerId)
        .where('context', '=', context)
        .where('client_request_id', '=', clientRequestId)
        .executeTakeFirst()
    );
  }

  async function markUploaded(
    id: string,
    {
      mimeType,
      bytes,
      width,
      height,
      originalStorageKey
    }: { mimeType: string; bytes: number; width: number; height: number; originalStorageKey: string },
    client?: Client
  ): Promise<Attachment | null> {
    if (!MIME_TYPES.has(mimeType)) throw new TypeError('Invalid attachment MIME type');
    return row(
      on(client)
        .updateTable('message_attachments')
        .set({
          state: 'processing',
          mime_type: mimeType,
          original_bytes: bytes,
          width,
          height,
          original_storage_key: requiredText(originalStorageKey, 'original storage key', 512),
          uploaded_at: now,
          failure_code: null,
          failed_at: null,
          reserved_bytes: null,
          reservation_expires_at: null,
          updated_at: now
        })
        .where('id', '=', id)
        .where('state', '=', 'uploading')
        .where('bound_at', 'is', null)
        .returningAll()
        .executeTakeFirst()
    );
  }

  async function retryProcessing(id: string, client?: Client): Promise<Attachment | null> {
    return row(
      on(client)
        .updateTable('message_attachments')
        .set({ state: 'processing', failure_code: null, failed_at: null, updated_at: now })
        .where('id', '=', id)
        .where('state', '=', 'failed')
        .where('bound_at', 'is', null)
        .where('original_storage_key', 'is not', null)
        .returningAll()
        .executeTakeFirst()
    );
  }

  async function markReady(
    id: string,
    {
      processedStorageKey,
      previewStorageKey,
      processedBytes,
      previewBytes
    }: { processedStorageKey: string; previewStorageKey: string; processedBytes: number; previewBytes: number },
    client?: Client
  ): Promise<Attachment | null> {
    const processed = requiredText(processedStorageKey, 'processed storage key', 512);
    const preview = requiredText(previewStorageKey, 'preview storage key', 512);
    return row(
      on(client)
        .updateTable('message_attachments')
        .set({
          state: 'ready',
          processed_storage_key: processed,
          preview_storage_key: preview,
          processed_bytes: processedBytes,
          preview_bytes: previewBytes,
          ready_at: now,
          failure_code: null,
          failed_at: null,
          updated_at: now
        })
        .where('id', '=', id)
        .where('state', '=', 'processing')
        .returningAll()
        .executeTakeFirst()
    );
  }

  async function markFailed(id: string, failureCode: unknown, client?: Client): Promise<Attachment | null> {
    const code = requiredText(failureCode, 'failure code', 64);
    return row(
      on(client)
        .updateTable('message_attachments')
        .set({
          state: 'failed',
          failure_code: code,
          failed_at: now,
          ready_at: null,
          reserved_bytes: null,
          reservation_expires_at: null,
          updated_at: now
        })
        .where('id', '=', id)
        .where('state', 'in', ['uploading', 'processing', 'ready'])
        .returningAll()
        .executeTakeFirst()
    );
  }

  async function markDeleted(id: string, client?: Client): Promise<Attachment | null> {
    const deleted = await row(
      on(client)
        .updateTable('message_attachments')
        .set({ state: 'deleted', deleted_at: now, updated_at: now })
        .where('id', '=', id)
        .where('state', '<>', 'deleted')
        .returningAll()
        .executeTakeFirst()
    );
    return deleted ?? findById(id, { client });
  }

  // Binds every requested ready draft of the owner to one message, in the
  // requested order, or none of them.
  async function bindReady(
    {
      ownerId,
      context,
      messageId,
      attachmentIds
    }: {
      ownerId: string;
      context: string;
      messageId: string;
      attachmentIds: unknown;
    },
    client?: Client
  ): Promise<Attachment[]> {
    if (!Array.isArray(attachmentIds) || attachmentIds.length < 1 || attachmentIds.length > 4) {
      throw new TypeError('Between one and four attachment ids are required');
    }
    if (new Set(attachmentIds).size !== attachmentIds.length) {
      throw new TypeError('Attachment ids must be unique');
    }
    const messageColumn = context === 'room' ? 'room_message_id' : context === 'dm' ? 'direct_message_id' : null;
    if (!messageColumn) throw new TypeError('Invalid attachment context');
    const result = await sql<AttachmentRow>`
      WITH requested AS MATERIALIZED (
        SELECT id::uuid, ordinality - 1 AS attachment_order
        FROM unnest(${attachmentIds as string[]}::text[]) WITH ORDINALITY AS requested(id, ordinality)
      ), candidates AS MATERIALIZED (
        SELECT attachment.id, requested.attachment_order
        FROM message_attachments AS attachment
        JOIN requested ON requested.id = attachment.id
        WHERE attachment.owner_id = ${ownerId} AND attachment.context = ${context}
          AND attachment.state = 'ready' AND attachment.bound_at IS NULL
        FOR UPDATE OF attachment
      )
      UPDATE message_attachments AS attachment
      SET ${sql.ref(messageColumn)} = ${messageId}, attachment_order = candidates.attachment_order,
          bound_at = current_timestamp, updated_at = current_timestamp
      FROM candidates
      WHERE attachment.id = candidates.id
        AND (SELECT count(*) FROM candidates) = (SELECT count(*) FROM requested)
      RETURNING attachment.*`.execute(on(client));
    if (result.rows.length !== attachmentIds.length) {
      throw new Error('One or more attachments cannot be bound');
    }
    return result.rows
      .map((bound) => mapAttachment(bound) as Attachment)
      .sort((left, right) => left.order - right.order);
  }

  async function listForMessage(
    context: string,
    messageId: string,
    { client }: { client?: Client } = {}
  ): Promise<Attachment[]> {
    const column = context === 'room' ? 'room_message_id' : context === 'dm' ? 'direct_message_id' : null;
    if (!column) throw new TypeError('Invalid attachment context');
    return rows(
      on(client)
        .selectFrom('message_attachments')
        .selectAll()
        .where(column, '=', messageId)
        .orderBy('attachment_order', 'asc')
        .execute()
    );
  }

  async function listCleanupCandidates({ limit = 500, client }: { limit?: unknown; client?: Client } = {}): Promise<
    Attachment[]
  > {
    return rows(
      on(client)
        .selectFrom('message_attachments')
        .selectAll()
        .where((eb) =>
          eb.or([
            CLEANUP_CANDIDATE_PREDICATE,
            sql<boolean>`(state = 'deleted' AND updated_at <= current_timestamp - interval '1 hour')`
          ])
        )
        .orderBy('updated_at', 'asc')
        .orderBy('id', 'asc')
        .limit(Math.max(1, Math.min(Number(limit) || 500, 500)))
        .execute()
    );
  }

  // Marks a cleanup candidate deleted; one already deleted over an hour ago
  // counts as done, so a retried cleanup still removes its files.
  async function markCleanupDeleted(id: string, client?: Client): Promise<Attachment | null> {
    const deleted = await row(
      on(client)
        .updateTable('message_attachments')
        .set({ state: 'deleted', deleted_at: now, updated_at: now })
        .where('id', '=', id)
        .where(CLEANUP_CANDIDATE_PREDICATE)
        .returningAll()
        .executeTakeFirst()
    );
    if (deleted) return deleted;
    const current = await findById(id, { client });
    return current?.internalState === 'deleted' && new Date(current.updatedAt).getTime() <= Date.now() - 60 * 60 * 1000
      ? current
      : null;
  }

  async function listStorageKeys({
    afterId = null,
    limit = 500,
    client
  }: { afterId?: string | null; limit?: unknown; client?: Client } = {}): Promise<{ id: string; keys: string[] }[]> {
    let query = on(client)
      .selectFrom('message_attachments')
      .select(['id', 'original_storage_key', 'processed_storage_key', 'preview_storage_key'])
      .orderBy('id', 'asc')
      .limit(Math.max(1, Math.min(Number(limit) || 500, 2_000)));
    if (afterId) query = query.where(sql<boolean>`id > ${afterId}::uuid`);
    const found = await query.execute();
    return found.map((entry) => ({
      id: entry.id,
      keys: [entry.original_storage_key, entry.processed_storage_key, entry.preview_storage_key].filter(
        (key): key is string => Boolean(key)
      )
    }));
  }

  async function listProcessingWithoutActiveJob({
    limit = 500,
    client
  }: { limit?: unknown; client?: Client } = {}): Promise<Attachment[]> {
    return rows(
      on(client)
        .selectFrom('message_attachments as attachment')
        .selectAll('attachment')
        .where('attachment.state', '=', 'processing')
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('media_processing_jobs as job')
                .select('job.id')
                .whereRef('job.attachment_id', '=', 'attachment.id')
                .where('job.kind', '=', 'process')
                .where('job.state', 'in', ['pending', 'processing'])
            )
          )
        )
        .orderBy('attachment.updated_at', 'asc')
        .orderBy('attachment.id', 'asc')
        .limit(Math.max(1, Math.min(Number(limit) || 500, 500)))
        .execute()
    );
  }

  async function markUnavailable(
    id: string,
    failureCode: string = 'media_missing',
    client?: Client
  ): Promise<Attachment | null> {
    return markFailed(id, failureCode, client);
  }

  async function clearPhysicalData(id: string, client?: Client): Promise<Attachment | null> {
    return row(
      on(client)
        .updateTable('message_attachments')
        .set({
          original_storage_key: null,
          processed_storage_key: null,
          preview_storage_key: null,
          original_bytes: null,
          processed_bytes: null,
          preview_bytes: null,
          reserved_bytes: null,
          reservation_expires_at: null,
          updated_at: now
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst()
    );
  }

  // What an owner holds now: drafts still uploading count their reservation,
  // accepted files their original size.
  async function quotaUsage(
    ownerId: string,
    { since = new Date(Date.now() - 10 * 60 * 1000), client }: { since?: Date; client?: Client } = {}
  ): Promise<Readonly<{ pendingCount: number; recentCount: number; usedBytes: number }>> {
    const usage = await on(client)
      .selectFrom('message_attachments')
      .select([
        sql<number>`count(*) FILTER (WHERE state = 'uploading')::integer`.as('pending_count'),
        sql<number>`count(*) FILTER (WHERE created_at >= ${since})::integer`.as('recent_count'),
        sql<string>`COALESCE(sum(CASE
          WHEN state = 'uploading' THEN reserved_bytes
          WHEN state IN ('processing', 'ready') THEN original_bytes
          ELSE 0 END), 0)::bigint`.as('used_bytes')
      ])
      .where('owner_id', '=', ownerId)
      .executeTakeFirst();
    return Object.freeze({
      pendingCount: Number(usage?.pending_count || 0),
      recentCount: Number(usage?.recent_count || 0),
      usedBytes: Number(usage?.used_bytes || 0)
    });
  }

  async function lockOwner(ownerId: string, client: Client): Promise<void> {
    if (!client) throw new TypeError('A transaction client is required');
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`media-quota:${ownerId}`}))`.execute(kyselyOn(client));
  }

  // A session-level lock held on one connection for the whole operation, so
  // two uploads of one attachment never write its files at the same time.
  async function withAttachmentLock<T>(id: string, operation: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    if (!base.connect) throw new TypeError('The PostgreSQL pool cannot acquire attachment locks');
    const client = await base.connect();
    const key = `media-upload:${id}`;
    try {
      await sql`SELECT pg_advisory_lock(hashtext(${key}))`.execute(kyselyOn(client));
      return await operation(client);
    } finally {
      await sql`SELECT pg_advisory_unlock(hashtext(${key}))`.execute(kyselyOn(client)).catch(() => {});
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
