import crypto from 'node:crypto';
import type pg from 'pg';
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

function createReplyRepository({ client }: { client?: QueryClient | null } = {}) {
  const defaultClient = client ? requireQuery(client) : null;

  function queryClient(override?: QueryClient | null): QueryClient {
    return requireQuery(override || defaultClient);
  }

  async function lockRoomTarget({
    roomId,
    messageId,
    client: override
  }: { roomId?: string; messageId?: string } & Override = {}): Promise<RoomReplyTarget | null> {
    const result = await queryClient(override).query<RoomTargetRow>(
      `SELECT m.*,
              COALESCE(NULLIF(u.display_name, ''), u.login, m.name) AS author_name
       FROM room_messages m
       LEFT JOIN users u ON u.id = m.author_user_id
       WHERE m.room_id = $1 AND m.id = $2
       FOR UPDATE OF m`,
      [roomId, messageId]
    );
    return mapRoomTarget(result.rows[0] || null);
  }

  async function lockDirectTarget({
    userId,
    peerId,
    messageId,
    client: override
  }: { userId?: string; peerId?: string; messageId?: string } & Override = {}): Promise<DirectReplyTarget | null> {
    const result = await queryClient(override).query<DirectTargetRow>(
      `SELECT m.*, COALESCE(NULLIF(u.display_name, ''), u.login) AS author_name
       FROM direct_messages m
       LEFT JOIN users u ON u.id = m.sender_id
       WHERE m.id = $1
         AND ((m.sender_id = $2 AND m.recipient_id = $3)
           OR (m.sender_id = $3 AND m.recipient_id = $2))
       FOR UPDATE OF m`,
      [messageId, userId, peerId]
    );
    return mapDirectTarget(result.rows[0] || null);
  }

  async function getRoomPreview({
    roomId,
    messageId,
    client: override,
    now
  }: { roomId?: string; messageId?: string; now?: number } & Override = {}): Promise<ReplyPreview | null> {
    const result = await queryClient(override).query<RoomTargetRow>(
      `SELECT m.*,
              COALESCE(NULLIF(u.display_name, ''), u.login, m.name) AS author_name
       FROM room_messages m
       LEFT JOIN users u ON u.id = m.author_user_id
       WHERE m.room_id = $1 AND m.id = $2`,
      [roomId, messageId]
    );
    const target = mapRoomTarget(result.rows[0] || null);
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
    const target = await locklessDirectTarget({ userId, peerId, messageId, client: override });
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
    const db = queryClient(override);
    const id = message?.id || crypto.randomUUID();
    const result = await db.query<RoomTargetRow>(
      `INSERT INTO room_messages (
         id, room_id, peer_id, name, text, created_at, expires_at, author_user_id, reply_to_message_id
       )
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, current_timestamp), $7, $8, $9)
       RETURNING *`,
      [
        id,
        roomId,
        message?.peerId || '',
        message?.authorUserId ? '' : message?.name || '',
        message?.text || '',
        message?.createdAt ? new Date(message.createdAt) : null,
        message?.expiresAt ? new Date(message.expiresAt) : null,
        message?.authorUserId || null,
        targetMessageId
      ]
    );
    return mapRoomTarget(result.rows[0] || null);
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
    const db = queryClient(override);
    const result = await db.query<DirectTargetRow>(
      `INSERT INTO direct_messages (
         id, sender_id, recipient_id, body, created_at, metadata, reply_to_message_id
       )
       VALUES ($1, $2, $3, $4, current_timestamp, '{}'::jsonb, $5)
       RETURNING *`,
      [id || crypto.randomUUID(), senderId, recipientId, body, targetMessageId]
    );
    return mapDirectTarget(result.rows[0] || null);
  }

  async function locklessDirectTarget({
    userId,
    peerId,
    messageId,
    client: override
  }: { userId?: string; peerId?: string; messageId?: string } & Override = {}): Promise<DirectReplyTarget | null> {
    const result = await queryClient(override).query<DirectTargetRow>(
      `SELECT m.*, COALESCE(NULLIF(u.display_name, ''), u.login) AS author_name
       FROM direct_messages m
       LEFT JOIN users u ON u.id = m.sender_id
       WHERE m.id = $1
         AND ((m.sender_id = $2 AND m.recipient_id = $3)
           OR (m.sender_id = $3 AND m.recipient_id = $2))`,
      [messageId, userId, peerId]
    );
    return mapDirectTarget(result.rows[0] || null);
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
