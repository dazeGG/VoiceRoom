// Room chat messages: append (with the caller's unit of work in the same
// transaction), list, read, edit and soft delete. A message shows its author's
// current account name and avatar, or the guest identity it was sent under.

import crypto from 'node:crypto';
import { sql, type Selectable } from 'kysely';
import type pg from 'pg';
import { normalizeLinkPreview } from '@voice-room/shared/link-preview';
import type { MessageContent } from '@voice-room/shared/contracts/messages';
import { transaction } from '../../platform/db/pool.ts';
import { kyselyOn, type Database } from '../../platform/db/kysely.ts';
import type { RoomMessages } from '../../platform/db/schema.ts';
import { avatarColorForPeerId } from '../rooms/avatar-color.ts';
import { normalizePositiveInt, toDate, toMillis } from '../rooms/room.repository.ts';

type MessageRow = Selectable<RoomMessages> & {
  avatar_color_key?: string | null;
  avatar_key?: string | null;
  avatar_accent?: string | null;
};
export type StoredRoomMessage = ReturnType<typeof mapMessage>;

type UnitOfWorkHooks = {
  beforeUnitOfWork?:
    ((client: pg.PoolClient) => Promise<{ replay?: boolean; message?: unknown } | null | undefined>) | null;
  unitOfWork?: ((client: pg.PoolClient, message: StoredRoomMessage) => Promise<unknown>) | null;
};
export type AppendRoomMessageInput = UnitOfWorkHooks & {
  id?: unknown;
  createdAt?: unknown;
  peerId?: unknown;
  name?: unknown;
  text?: unknown;
  authorUserId?: unknown;
  replyToMessageId?: unknown;
  content?: unknown;
};

// Room history is never expired or trimmed: a message leaves only when its
// author or the room owner deletes it, or when its room is deleted.
const DEFAULT_LIST_LIMIT = 500;

function linkPreviewOf(metadata: unknown) {
  const preview = (metadata as { linkPreview?: unknown } | null)?.linkPreview;
  return normalizeLinkPreview(preview);
}

export function mapMessage(row: MessageRow) {
  const linkPreview = linkPreviewOf(row.metadata);
  return {
    avatarAccent: row.avatar_accent || null,
    createdAt: toMillis(row.created_at),
    expiresAt: row.expires_at ? toMillis(row.expires_at) : null,
    id: row.id,
    avatarKey: row.avatar_key || null,
    avatarColorKey: row.avatar_color_key || avatarColorForPeerId(row.peer_id),
    editedAt: row.edited_at ? toMillis(row.edited_at) : null,
    name: row.name || '',
    peerId: row.peer_id || '',
    roomId: row.room_id,
    text: row.text || '',
    // The column holds the content validated when the message was sent.
    ...(row.content ? { content: row.content as MessageContent } : {}),
    ...(linkPreview ? { linkPreview } : {}),
    ...(row.reply_to_message_id ? { replyTo: { messageId: row.reply_to_message_id } } : {}),
    // 2.4.0: author for ownership (nullable for guests/legacy)
    authorUserId: row.author_user_id || null
  };
}

function mapMessageOrNull(row: MessageRow | undefined): StoredRoomMessage | null {
  return row ? mapMessage(row) : null;
}

// The author's current account name and avatar, else the guest identity's
// colour; selected next to `m`, a message joined to `rpi` and `u`.
const authorColumns = [
  sql<string>`COALESCE(NULLIF(u.display_name, ''), u.login, m.name)`.as('name'),
  sql<string | null>`COALESCE(u.avatar_color_key, rpi.avatar_color_key)`.as('avatar_color_key'),
  sql<string | null>`u.avatar_key`.as('avatar_key'),
  sql<string | null>`u.avatar_accent`.as('avatar_accent')
];

export function createRoomChatRepository({ db, pool }: { db: Database; pool: pg.Pool }) {
  async function appendMessage(
    roomId: string,
    message: AppendRoomMessageInput | null | undefined,
    now: number = Date.now()
  ) {
    const id = typeof message?.id === 'string' && message.id ? message.id : crypto.randomUUID();
    const createdAt = normalizePositiveInt(message?.createdAt, now);

    // A raw pg transaction: the hooks run their own SQL on the same client.
    return transaction(pool, async (client) => {
      const trx = kyselyOn(client);
      const room = await trx
        .selectFrom('rooms')
        .select('id')
        .where('id', '=', roomId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!room) return null;

      if (typeof message?.beforeUnitOfWork === 'function') {
        const prepared = await message.beforeUnitOfWork(client);
        if (prepared?.replay) return { ...(prepared.message as StoredRoomMessage), idempotencyReplay: true };
      }

      const inserted = await trx
        .insertInto('room_messages')
        .values({
          id,
          room_id: roomId,
          peer_id: typeof message?.peerId === 'string' ? message.peerId : '',
          name: typeof message?.authorUserId === 'string' ? '' : typeof message?.name === 'string' ? message.name : '',
          text: typeof message?.text === 'string' ? message.text : '',
          created_at: toDate(createdAt),
          expires_at: null,
          author_user_id: typeof message?.authorUserId === 'string' ? message.authorUserId : null,
          reply_to_message_id: typeof message?.replyToMessageId === 'string' ? message.replyToMessageId : null,
          content: message?.content ? JSON.stringify(message.content) : null
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      if (typeof message?.unitOfWork === 'function') {
        await message.unitOfWork(client, mapMessage(inserted));
      }

      await trx
        .updateTable('rooms')
        .set({ updated_at: toDate(now) })
        .where('id', '=', roomId)
        .execute();

      return mapMessage(inserted);
    });
  }

  async function listMessages(
    roomId: string,
    { limit = DEFAULT_LIST_LIMIT, now = Date.now() }: { limit?: unknown; now?: number } = {}
  ) {
    const boundedLimit = Math.max(0, normalizePositiveInt(limit, DEFAULT_LIST_LIMIT));
    if (boundedLimit === 0) return [];

    const rows = await db
      .with('recent', (qb) =>
        qb
          .selectFrom('room_messages')
          .selectAll()
          .where('room_id', '=', roomId)
          .where('deleted_at', 'is', null)
          .where((w) => w.or([w('expires_at', 'is', null), w('expires_at', '>', toDate(now))]))
          .orderBy('created_at', 'desc')
          .orderBy('id', 'desc')
          .limit(boundedLimit)
      )
      .selectFrom('recent as m')
      .leftJoin('room_peer_identities as rpi', (join) =>
        join.onRef('rpi.room_id', '=', 'm.room_id').onRef('rpi.peer_id', '=', 'm.peer_id')
      )
      .leftJoin('users as u', 'u.id', 'm.author_user_id')
      .selectAll('m')
      .select(authorColumns)
      .orderBy('m.created_at', 'asc')
      .orderBy('m.id', 'asc')
      .execute();
    return rows.map(mapMessage);
  }

  async function getMessage(roomId: string, messageId: string) {
    const row = await db
      .selectFrom('room_messages as m')
      .leftJoin('room_peer_identities as rpi', (join) =>
        join.onRef('rpi.room_id', '=', 'm.room_id').onRef('rpi.peer_id', '=', 'm.peer_id')
      )
      .leftJoin('users as u', 'u.id', 'm.author_user_id')
      .selectAll('m')
      .select(authorColumns)
      .where('m.room_id', '=', roomId)
      .where('m.id', '=', messageId)
      .where('m.deleted_at', 'is', null)
      .limit(1)
      .executeTakeFirst();
    return mapMessageOrNull(row);
  }

  async function softDeleteMessage(roomId: string, messageId: string): Promise<boolean> {
    const result = await db
      .updateTable('room_messages')
      .set({ deleted_at: sql<Date>`now()` })
      .where('room_id', '=', roomId)
      .where('id', '=', messageId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  async function editMessage(roomId: string, messageId: string, text: string) {
    const row = await db
      .with('updated', (qb) =>
        qb
          .updateTable('room_messages')
          .set({ text, edited_at: sql<Date>`current_timestamp` })
          .where('room_id', '=', roomId)
          .where('id', '=', messageId)
          .where('deleted_at', 'is', null)
          .returningAll()
      )
      .selectFrom('updated as m')
      .leftJoin('room_peer_identities as rpi', (join) =>
        join.onRef('rpi.room_id', '=', 'm.room_id').onRef('rpi.peer_id', '=', 'm.peer_id')
      )
      .leftJoin('users as u', 'u.id', 'm.author_user_id')
      .selectAll('m')
      .select(authorColumns)
      .executeTakeFirst();
    return mapMessageOrNull(row);
  }

  return { appendMessage, editMessage, getMessage, listMessages, softDeleteMessage };
}

export type RoomChatRepository = ReturnType<typeof createRoomChatRepository>;
