import crypto from 'node:crypto';
import { sql } from 'kysely';
import type pg from 'pg';
import { kyselyOn, type Database } from '../../platform/db/kysely.ts';
import { projectReplyPreview, projectReplyTombstone, type ReplyPreview } from './reply-projector.ts';

type QueryClient = Pick<pg.PoolClient, 'query'>;
type Override = { client?: QueryClient | null };
type Metadata = { kind?: unknown; [key: string]: unknown } | null;

type RoomTargetRow = {
  id: string;
  room_id: string;
  peer_id: string;
  author_user_id: string | null;
  author_name?: string | null;
  name: string;
  text: string;
  created_at: unknown;
  expires_at: unknown;
  deleted_at: unknown;
  metadata: Metadata;
  reply_to_message_id: string | null;
};

type DirectTargetRow = {
  id: string;
  sender_id: string;
  recipient_id: string;
  author_name?: string | null;
  body: string;
  created_at: unknown;
  deleted_at: unknown;
  metadata: Metadata;
  reply_to_message_id: string | null;
};

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

function mapRoomTarget(row: RoomTargetRow | null): RoomReplyTarget | null {
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
    metadata: row.metadata,
    replyTo: row.reply_to_message_id ? { messageId: row.reply_to_message_id } : undefined
  };
}

function mapDirectTarget(row: DirectTargetRow | null): DirectReplyTarget | null {
  if (!row) return null;
  return {
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    name: row.author_name,
    body: row.body,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    metadata: row.metadata,
    invite: row.metadata?.kind === 'room-invite' ? row.metadata : null,
    replyTo: row.reply_to_message_id ? { messageId: row.reply_to_message_id } : undefined
  };
}

// The author's current account name, or the name the guest wrote under.
const roomAuthorName = sql<string | null>`COALESCE(NULLIF(u.display_name, ''), u.login, m.name)`.as('author_name');
const directAuthorName = sql<string | null>`COALESCE(NULLIF(u.display_name, ''), u.login)`.as('author_name');

function createReplyRepository({ client }: { client?: QueryClient | null } = {}) {
  const defaultClient = client ? requireQuery(client) : null;

  function on(override?: QueryClient | null): Database {
    return kyselyOn(requireQuery(override || defaultClient));
  }

  function roomTarget(db: Database, roomId: string | undefined, messageId: string | undefined) {
    return db
      .selectFrom('room_messages as m')
      .leftJoin('users as u', 'u.id', 'm.author_user_id')
      .selectAll('m')
      .select(roomAuthorName)
      .where('m.room_id', '=', roomId as string)
      .where('m.id', '=', messageId as string);
  }

  function directTarget(db: Database, userId?: string, peerId?: string, messageId?: string) {
    return (
      db
        .selectFrom('direct_messages as m')
        .leftJoin('users as u', 'u.id', 'm.sender_id')
        .selectAll('m')
        .select(directAuthorName)
        .where('m.id', '=', messageId as string)
        // Between these two users, either direction.
        .where((eb) =>
          eb.or([
            eb.and([eb('m.sender_id', '=', userId as string), eb('m.recipient_id', '=', peerId as string)]),
            eb.and([eb('m.sender_id', '=', peerId as string), eb('m.recipient_id', '=', userId as string)])
          ])
        )
    );
  }

  async function lockRoomTarget({
    roomId,
    messageId,
    client: override
  }: { roomId?: string; messageId?: string } & Override = {}): Promise<RoomReplyTarget | null> {
    const row = await roomTarget(on(override), roomId, messageId).forUpdate('m').executeTakeFirst();
    return mapRoomTarget((row as RoomTargetRow | undefined) || null);
  }

  async function lockDirectTarget({
    userId,
    peerId,
    messageId,
    client: override
  }: { userId?: string; peerId?: string; messageId?: string } & Override = {}): Promise<DirectReplyTarget | null> {
    const row = await directTarget(on(override), userId, peerId, messageId).forUpdate('m').executeTakeFirst();
    return mapDirectTarget((row as DirectTargetRow | undefined) || null);
  }

  async function getRoomPreview({
    roomId,
    messageId,
    client: override,
    now
  }: { roomId?: string; messageId?: string; now?: number } & Override = {}): Promise<ReplyPreview | null> {
    const row = await roomTarget(on(override), roomId, messageId).executeTakeFirst();
    const target = mapRoomTarget((row as RoomTargetRow | undefined) || null);
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
    messageId?: string;
    now?: number;
  } & Override = {}): Promise<ReplyPreview | null> {
    const row = await directTarget(on(override), userId, peerId, messageId).executeTakeFirst();
    const target = mapDirectTarget((row as DirectTargetRow | undefined) || null);
    return target ? projectReplyPreview(target, { now }) : projectReplyTombstone(messageId);
  }

  async function insertRoomReply({
    roomId,
    targetMessageId,
    message,
    client: override
  }: {
    roomId?: string;
    targetMessageId?: string;
    message?: RoomReplyMessage;
  } & Override = {}): Promise<RoomReplyTarget | null> {
    const row = await on(override)
      .insertInto('room_messages')
      .values({
        id: message?.id || crypto.randomUUID(),
        room_id: roomId as string,
        peer_id: message?.peerId || '',
        name: message?.authorUserId ? '' : message?.name || '',
        text: message?.text || '',
        created_at: message?.createdAt ? new Date(message.createdAt) : sql<Date>`current_timestamp`,
        expires_at: message?.expiresAt ? new Date(message.expiresAt) : null,
        author_user_id: message?.authorUserId || null,
        reply_to_message_id: targetMessageId as string
      })
      .returningAll()
      .executeTakeFirst();
    return mapRoomTarget((row as RoomTargetRow | undefined) || null);
  }

  async function insertDirectReply({
    senderId,
    recipientId,
    targetMessageId,
    body,
    id,
    client: override
  }: {
    senderId?: string;
    recipientId?: string;
    targetMessageId?: string;
    body?: string;
    id?: string;
  } & Override = {}): Promise<DirectReplyTarget | null> {
    const row = await on(override)
      .insertInto('direct_messages')
      .values({
        id: id || crypto.randomUUID(),
        sender_id: senderId as string,
        recipient_id: recipientId as string,
        body: body as string,
        created_at: sql<Date>`current_timestamp`,
        metadata: '{}',
        reply_to_message_id: targetMessageId as string
      })
      .returningAll()
      .executeTakeFirst();
    return mapDirectTarget((row as DirectTargetRow | undefined) || null);
  }

  return Object.freeze({
    getDirectPreview,
    getRoomPreview,
    insertDirectReply,
    insertRoomReply,
    lockDirectTarget,
    lockRoomTarget
  });
}

export { createReplyRepository };
