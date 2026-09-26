// The records the social repositories share: public profiles, direct
// messages and invitations as stored, and the SQL helpers for user pairs.

import { sql, type ExpressionBuilder, type Selectable } from 'kysely';
import { type Database } from '../../platform/db/kysely.ts';
import { cleanAvatarColorKey, cleanPresenceStatus } from '@voice-room/shared/validation';
import { normalizeLinkPreview, type LinkPreview } from '@voice-room/shared/link-preview';
import type { DB, DirectMessages, Users } from '../../platform/db/schema.ts';

export type Metadata = Record<string, unknown>;
export type UserRow = Pick<
  Selectable<Users>,
  | 'avatar_accent'
  | 'avatar_color_key'
  | 'avatar_key'
  | 'created_at'
  | 'display_name'
  | 'dnd'
  | 'id'
  | 'login'
  | 'presence_status'
>;
export type PublicUser = ReturnType<typeof mapPublicUser> & object;

export type DirectMessageInvite = {
  roomId: string;
  roomName: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  expiresAt: number | null;
};

/** A direct message as stored; deletedAt stays internal, callers filter on it. */
export interface DirectMessage {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  createdAt: number | null;
  editedAt: number | null;
  readAt: number | null;
  invite: DirectMessageInvite | null;
  linkPreview: LinkPreview | undefined;
  replyTo: { messageId: string } | undefined;
  deletedAt: number | null;
}

export function toMillis(value: unknown): number | null {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value as string);
  return Number.isFinite(parsed) ? parsed : null;
}

// Public shape for a user row joined from the `users` table (snake_case). Never
// leaks the password hash; mirrors user-store's publicUser fields.
export function mapPublicUser(row: UserRow) {
  const presenceStatus = cleanPresenceStatus(row.presence_status) || (row.dnd ? 'dnd' : 'online');
  return {
    avatarAccent: row.avatar_accent || null,
    avatarColorKey: cleanAvatarColorKey(row.avatar_color_key) || 'blurple',
    avatarUrl: row.avatar_key ? `/api/avatars/${encodeURIComponent(row.avatar_key)}` : null,
    createdAt: toMillis(row.created_at),
    displayName: row.display_name || '',
    doNotDisturb: presenceStatus === 'dnd',
    id: row.id,
    login: row.login,
    presenceStatus
  };
}

// Room invitations ride inside a regular direct message's metadata so they
// live in the shared thread history without any schema change.
export function mapInvite(metadata: Metadata | null | undefined): DirectMessageInvite | null {
  if (!metadata || metadata.kind !== 'room-invite') return null;
  const status = metadata.status;
  return {
    roomId: typeof metadata.roomId === 'string' ? metadata.roomId : '',
    roomName: typeof metadata.roomName === 'string' ? metadata.roomName : '',
    status: status === 'accepted' || status === 'declined' || status === 'expired' ? status : 'pending',
    expiresAt: Number(metadata.expiresAt) || null
  };
}

export function mapMessage(row: Selectable<DirectMessages>): DirectMessage;
export function mapMessage(row: Selectable<DirectMessages> | null | undefined): DirectMessage | null;
export function mapMessage(row: Selectable<DirectMessages> | null | undefined): DirectMessage | null {
  if (!row) return null;
  const metadata = row.metadata as Metadata | null;
  return {
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    body: row.body,
    createdAt: toMillis(row.created_at),
    editedAt: toMillis(row.edited_at),
    readAt: toMillis(row.read_at),
    invite: mapInvite(metadata),
    linkPreview: normalizeLinkPreview(metadata?.linkPreview) || undefined,
    replyTo: row.reply_to_message_id ? { messageId: row.reply_to_message_id } : undefined,
    // deletedAt kept internal; callers filter before map
    deletedAt: row.deleted_at ? toMillis(row.deleted_at) : null
  };
}

// friendships store the pair ordered so a single row is canonical.
export function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export async function lockUserPair(q: Database, a: string, b: string): Promise<void> {
  const [low, high] = orderedPair(a, b);
  await sql`SELECT pg_advisory_xact_lock(hashtext(${`voice-room:user-pair:${low}:${high}`}))`.execute(q);
}

// Escape LIKE wildcards in user-supplied search terms (we use ESCAPE '\').
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export const now = sql<Date>`current_timestamp`;

// The other side of a friendship row, seen from `userId`.
export function friendOf(userId: string) {
  return sql<string>`CASE WHEN user_a_id = ${userId} THEN user_b_id ELSE user_a_id END`;
}

// Messages between two users, either direction.
export function between(a: string, b: string) {
  return (eb: ExpressionBuilder<DB, 'direct_messages'>) =>
    eb.or([
      eb.and([eb('sender_id', '=', a), eb('recipient_id', '=', b)]),
      eb.and([eb('sender_id', '=', b), eb('recipient_id', '=', a)])
    ]);
}

// Invitation state lives in the message's metadata JSON.
export const inviteKind = sql<string>`metadata->>'kind'`;
export const inviteStatus = sql<string>`metadata->>'status'`;
