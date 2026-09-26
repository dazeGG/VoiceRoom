import { sql } from 'kysely';
import type pg from 'pg';
import type { LinkPreview } from '@voice-room/shared/link-preview';
import { kyselyOn } from '../../platform/db/kysely.ts';
import type { Json } from '../../platform/db/schema.ts';

type QueryClient = Pick<pg.Pool, 'query'>;

export type CachedPreview = { status: 'ready' | 'failed'; preview: unknown; failureCode: string | null };

// The JSON paths an image key is kept at, in the cache and on messages.
const cachedImageKey = sql<string | null>`preview -> 'image' ->> 'key'`;
const messageImageKey = sql<string | null>`metadata -> 'linkPreview' -> 'image' ->> 'key'`;

function createLinkPreviewRepository({ pool }: { pool: QueryClient }) {
  if (!pool) throw new TypeError('A database pool is required');
  const db = kyselyOn(pool);

  async function getCached(urlHash: string, now: number): Promise<CachedPreview | null> {
    const row = await db
      .selectFrom('link_previews')
      .select(['status', 'preview', 'failure_code'])
      .where('url_hash', '=', urlHash)
      .where('expires_at', '>', new Date(now))
      .executeTakeFirst();
    return row
      ? { status: row.status as CachedPreview['status'], preview: row.preview, failureCode: row.failure_code }
      : null;
  }

  async function saveCached({
    urlHash,
    url,
    preview,
    failureCode = null,
    now,
    ttlMs
  }: {
    urlHash: string;
    url: string;
    preview: LinkPreview | null;
    failureCode?: string | null;
    now: number;
    ttlMs: number;
  }): Promise<void> {
    await db
      .insertInto('link_previews')
      .values({
        url_hash: urlHash,
        url,
        status: preview ? 'ready' : 'failed',
        preview: preview ? JSON.stringify(preview) : null,
        failure_code: preview ? null : failureCode,
        fetched_at: new Date(now),
        expires_at: new Date(now + ttlMs)
      })
      .onConflict((oc) =>
        oc.column('url_hash').doUpdateSet((eb) => ({
          url: eb.ref('excluded.url'),
          status: eb.ref('excluded.status'),
          preview: eb.ref('excluded.preview'),
          failure_code: eb.ref('excluded.failure_code'),
          fetched_at: eb.ref('excluded.fetched_at'),
          expires_at: eb.ref('excluded.expires_at')
        }))
      )
      .execute();
  }

  // The preview is written only while the message still has the text it was
  // built from, and only when it actually changes, so an edit that raced the
  // fetch is never overwritten and nobody is told about a no-op.
  function previewChange(preview: LinkPreview | null) {
    const value = preview ? JSON.stringify(preview) : null;
    return {
      assignment: sql<Json>`CASE
        WHEN ${value}::jsonb IS NULL THEN metadata - 'linkPreview'
        ELSE jsonb_set(metadata, '{linkPreview}', ${value}::jsonb)
      END`,
      changes: sql<boolean>`(metadata -> 'linkPreview') IS DISTINCT FROM ${value}::jsonb`
    };
  }

  async function setRoomMessagePreview({
    roomId,
    messageId,
    text,
    preview
  }: {
    roomId: string;
    messageId: string;
    text: string;
    preview: LinkPreview | null;
  }): Promise<boolean> {
    const change = previewChange(preview);
    const result = await db
      .updateTable('room_messages')
      .set({ metadata: change.assignment })
      .where('room_id', '=', roomId)
      .where('id', '=', messageId)
      .where('text', '=', text)
      .where('deleted_at', 'is', null)
      .where(change.changes)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  async function setDirectMessagePreview({
    messageId,
    senderId,
    text,
    preview
  }: {
    messageId: string;
    senderId: string;
    text: string;
    preview: LinkPreview | null;
  }): Promise<boolean> {
    const change = previewChange(preview);
    const result = await db
      .updateTable('direct_messages')
      .set({ metadata: change.assignment })
      .where('id', '=', messageId)
      .where('sender_id', '=', senderId)
      .where('body', '=', text)
      .where('deleted_at', 'is', null)
      .where(change.changes)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  // Every image a cached preview or a message still refers to.
  async function listReferencedImageKeys(): Promise<string[]> {
    const rows = await db
      .selectFrom('link_previews')
      .select(cachedImageKey.as('key'))
      .where(cachedImageKey, 'is not', null)
      .union(db.selectFrom('room_messages').select(messageImageKey.as('key')).where(messageImageKey, 'is not', null))
      .union(db.selectFrom('direct_messages').select(messageImageKey.as('key')).where(messageImageKey, 'is not', null))
      .execute();
    return rows.map((row) => row.key).filter((key): key is string => Boolean(key));
  }

  async function pruneExpired(now: number): Promise<number | null> {
    const result = await db.deleteFrom('link_previews').where('expires_at', '<=', new Date(now)).executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  return {
    getCached,
    listReferencedImageKeys,
    pruneExpired,
    saveCached,
    setDirectMessagePreview,
    setRoomMessagePreview
  };
}

export type LinkPreviewRepository = ReturnType<typeof createLinkPreviewRepository>;

export { createLinkPreviewRepository };
