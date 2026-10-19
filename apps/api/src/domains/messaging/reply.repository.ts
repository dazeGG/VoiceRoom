import crypto from 'node:crypto';
import { sql, type Selectable } from 'kysely';
import type pg from 'pg';
import { isRecord } from '@voice-room/shared/guards';
import { kyselyOn, type Database } from '../../platform/db/kysely.ts';
import type { DirectMessages, Json, RoomMessages } from '../../platform/db/schema.ts';
import { projectReplyPreview, projectReplyTombstone, type ReplyPreview } from './reply-projector.ts';

type QueryClient = Pick<pg.PoolClient, 'query'>;
type Override = { client?: QueryClient | null };
type Metadata = { kind?: unknown; [key: string]: unknown } | null;

// The quoted message as stored, with its author's current name when the query joined it.
type RoomTargetRow = Selectable<RoomMessages> & { author_name?: string | null };
type DirectTargetRow = Selectable<DirectMessages> & { author_name?: string | null };

export type RoomReplyTarget = {
  id: string;
  roomId: string;
  peerId: string;
  authorUserId: string | null;
  name: string | null | undefined;
  text: string;
  createdAt: unknown;
  expiresAt: unknown;
  deletedAt: unknown;
  metadata: Metadata;
  replyTo: { messageId: string } | undefined;
};

export type DirectReplyTarget = {
  id: string;
  senderId: string;
  recipientId: string;
  name: string | null | undefined;
  body: string;
  createdAt: unknown;
  deletedAt: unknown;
  metadata: Metadata;
  invite: Metadata;
  replyTo: { messageId: string } | undefined;
};

type RoomReplyMessage =
  | {
      id?: string;
      peerId?: string;
      authorUserId?: string | null;
      name?: string;
      text?: string;
      createdAt?: string | number | Date | null;
      expiresAt?: string | number | Date | null;
    }
  | null
  | undefined;

function requireQuery(client: QueryClient | null | undefined): QueryClient {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('Reply repository requires a PostgreSQL query client');
  }
  return client;
}

function metadataOf(value: Json): Metadata {
  return isRecord(value) ? value : null;
}

function mapRoomTarget(row: RoomTargetRow | undefined): RoomReplyTarget | null {
  if (!row) return null;
  return {
    id: row.id,
    roomId: row.room_id,
    peerId: row.peer_id,
    authorUserId: row.author_user_id,
    name: row.author_name || row.name,
    text: row.text,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    deletedAt: row.deleted_at,
    metadata: metadataOf(row.metadata),
    replyTo: row.reply_to_message_id ? { messageId: row.reply_to_message_id } : undefined
  };
}

function mapDirectTarget(row: DirectTargetRow | undefined): DirectReplyTarget | null {
  if (!row) return null;
  const metadata = metadataOf(row.metadata);
  return {
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    name: row.author_name,
    body: row.body,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    metadata,
    invite: metadata?.kind === 'room-invite' ? metadata : null,
    replyTo: row.reply_to_message_id ? { messageId: row.reply_to_message_id } : undefined
  };
}

// A quoted message that is gone, or not this conversation's, shows as a tombstone.
function previewsById(
  ids: string[],
  found: Map<string, RoomReplyTarget | DirectReplyTarget | null>,
  now: number | undefined
): Map<string, ReplyPreview | null> {
  return new Map(
    ids.map((id) => {
      const target = found.get(id);
      return [id, target ? projectReplyPreview(target, { now }) : projectReplyTombstone(id)];
    })
  );
}

// The author's current account name, or the name the guest wrote under.
const roomAuthorName = sql<string | null>`COALESCE(NULLIF(u.display_name, ''), u.login, m.name)`.as('author_name');
const directAuthorName = sql<string | null>`COALESCE(NULLIF(u.display_name, ''), u.login)`.as('author_name');

function createReplyRepository({ client }: { client?: QueryClient | null } = {}) {
  const defaultClient = client ? requireQuery(client) : null;

  function on(override?: QueryClient | null): Database {
    return kyselyOn(requireQuery(override || defaultClient));
  }

  // One message id, or several for a page of quotes. A missing room or user
  // matches no row, so the quote shows as a tombstone.
  function roomTarget(db: Database, roomId: string | undefined, messageId: string | string[]) {
    const query = db
      .selectFrom('room_messages as m')
      .leftJoin('users as u', 'u.id', 'm.author_user_id')
      .selectAll('m')
      .select(roomAuthorName)
      .where('m.room_id', '=', roomId ?? '');
    return Array.isArray(messageId) ? query.where('m.id', 'in', messageId) : query.where('m.id', '=', messageId);
  }

  function directTarget(
    db: Database,
    userId: string | undefined,
    peerId: string | undefined,
    messageId: string | string[]
  ) {
    const query = db
      .selectFrom('direct_messages as m')
      .leftJoin('users as u', 'u.id', 'm.sender_id')
      .selectAll('m')
      .select(directAuthorName);
    return (
      (Array.isArray(messageId) ? query.where('m.id', 'in', messageId) : query.where('m.id', '=', messageId))
        // Between these two users, either direction.
        .where((eb) =>
          eb.or([
            eb.and([eb('m.sender_id', '=', userId ?? ''), eb('m.recipient_id', '=', peerId ?? '')]),
            eb.and([eb('m.sender_id', '=', peerId ?? ''), eb('m.recipient_id', '=', userId ?? '')])
          ])
        )
    );
  }

  async function lockRoomTarget({
    roomId,
    messageId,
    client: override
  }: { roomId: string; messageId: string } & Override): Promise<RoomReplyTarget | null> {
    const row = await roomTarget(on(override), roomId, messageId).forUpdate('m').executeTakeFirst();
    return mapRoomTarget(row);
  }

  async function lockDirectTarget({
    userId,
    peerId,
    messageId,
    client: override
  }: { userId: string; peerId: string; messageId: string } & Override): Promise<DirectReplyTarget | null> {
    const row = await directTarget(on(override), userId, peerId, messageId).forUpdate('m').executeTakeFirst();
    return mapDirectTarget(row);
  }

  async function getRoomPreview({
    roomId,
    messageId,
    client: override,
    now
  }: { roomId?: string; messageId: string; now?: number } & Override): Promise<ReplyPreview | null> {
    const row = await roomTarget(on(override), roomId, messageId).executeTakeFirst();
    const target = mapRoomTarget(row);
    return target ? projectReplyPreview(target, { now }) : projectReplyTombstone(messageId);
  }

  async function getDirectPreview({
    userId,
    peerId,
    messageId,
    client: override,
    now
  }: {
    userId?: string;
    peerId?: string;
    messageId: string;
    now?: number;
  } & Override): Promise<ReplyPreview | null> {
    const row = await directTarget(on(override), userId, peerId, messageId).executeTakeFirst();
    const target = mapDirectTarget(row);
    return target ? projectReplyPreview(target, { now }) : projectReplyTombstone(messageId);
  }

  /** Previews of several quoted room messages in one query, by quoted message id. */
  async function getRoomPreviews({
    roomId,
    messageIds,
    client: override,
    now
  }: { roomId?: string; messageIds: string[]; now?: number } & Override): Promise<Map<string, ReplyPreview | null>> {
    const ids = [...new Set(messageIds)];
    if (ids.length === 0) return new Map();
    const rows = await roomTarget(on(override), roomId, ids).execute();
    return previewsById(ids, new Map(rows.map((row) => [row.id, mapRoomTarget(row)])), now);
  }

  /** Previews of several quoted direct messages in one query, by quoted message id. */
  async function getDirectPreviews({
    userId,
    peerId,
    messageIds,
    client: override,
    now
  }: {
    userId?: string;
    peerId?: string;
    messageIds: string[];
    now?: number;
  } & Override): Promise<Map<string, ReplyPreview | null>> {
    const ids = [...new Set(messageIds)];
    if (ids.length === 0) return new Map();
    const rows = await directTarget(on(override), userId, peerId, ids).execute();
    return previewsById(ids, new Map(rows.map((row) => [row.id, mapDirectTarget(row)])), now);
  }

  async function insertRoomReply({
    roomId,
    targetMessageId,
    message,
    client: override
  }: {
    roomId: string;
    targetMessageId: string;
    message?: RoomReplyMessage;
  } & Override): Promise<RoomReplyTarget | null> {
    const row = await on(override)
      .insertInto('room_messages')
      .values({
        id: message?.id || crypto.randomUUID(),
        room_id: roomId,
        peer_id: message?.peerId || '',
        name: message?.authorUserId ? '' : message?.name || '',
        text: message?.text || '',
        created_at: message?.createdAt ? new Date(message.createdAt) : sql<Date>`current_timestamp`,
        expires_at: message?.expiresAt ? new Date(message.expiresAt) : null,
        author_user_id: message?.authorUserId || null,
        reply_to_message_id: targetMessageId
      })
      .returningAll()
      .executeTakeFirst();
    return mapRoomTarget(row);
  }

  async function insertDirectReply({
    senderId,
    recipientId,
    targetMessageId,
    body,
    id,
    client: override
  }: {
    senderId: string;
    recipientId: string;
    targetMessageId: string;
    body: string;
    id?: string;
  } & Override): Promise<DirectReplyTarget | null> {
    const row = await on(override)
      .insertInto('direct_messages')
      .values({
        id: id || crypto.randomUUID(),
        sender_id: senderId,
        recipient_id: recipientId,
        body,
        created_at: sql<Date>`current_timestamp`,
        metadata: '{}',
        reply_to_message_id: targetMessageId
      })
      .returningAll()
      .executeTakeFirst();
    return mapDirectTarget(row);
  }

  return Object.freeze({
    getDirectPreview,
    getDirectPreviews,
    getRoomPreview,
    getRoomPreviews,
    insertDirectReply,
    insertRoomReply,
    lockDirectTarget,
    lockRoomTarget
  });
}

export { createReplyRepository };
