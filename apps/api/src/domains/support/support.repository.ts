// The support inbox's tables: a thread per person who wrote to the official
// account, the team's notes on it, and which staff member sent each answer.
// Every function runs on the database handle it is given, so a send can
// record its thread inside the send's own transaction. Staff actions on a
// thread write their admin_actions entry in the same transaction.

import { sql } from 'kysely';
import { OFFICIAL_ACCOUNT_ID } from '@voiceroom/shared/official-account';
import type { SupportPersonState, SupportStatus } from '@voiceroom/shared/contracts/support';
import type { Database } from '../../platform/db/kysely.ts';
import { epochMillis } from '../../platform/epoch-millis.ts';
import { mapMessage } from '../social/social-records.ts';

const official = OFFICIAL_ACCOUNT_ID;

/** Messages either way between the official account and this person. */
const inPair = (userId: string) =>
  sql<boolean>`((sender_id = ${official} AND recipient_id = ${userId}) OR (sender_id = ${userId} AND recipient_id = ${official}))`;

const staffName = sql<string>`coalesce(nullif(display_name, ''), login)`;

async function logAction(
  db: Database,
  input: {
    staffId: string;
    userId: string;
    action: 'support_reply' | 'support_note' | 'support_resolve';
    subjectId?: string;
  }
): Promise<void> {
  await db
    .insertInto('admin_actions')
    .values({
      admin_user_id: input.staffId,
      target_user_id: input.userId,
      action: input.action,
      details: JSON.stringify(input.subjectId ? { subjectId: input.subjectId } : {})
    })
    .execute();
}

/** The person wrote: their thread is open again (AC-A6) and has something new for staff. */
export async function recordPersonMessage(db: Database, userId: string, at: Date): Promise<void> {
  await db
    .insertInto('support_threads')
    .values({ user_id: userId, status: 'open', last_user_message_at: at })
    .onConflict((oc) =>
      oc.column('user_id').doUpdateSet({
        status: 'open',
        last_user_message_at: at,
        resolved_at: null,
        resolved_by: null
      })
    )
    .execute();
}

/**
 * Staff have seen the person's messages up to the newest one the thread
 * holds. Read under the row lock of this UPDATE, so a person's send that
 * commits meanwhile moves last_user_message_at past it and stays unread;
 * now() would hide such a message.
 */
const readUpToLastMessage = { staff_read_at: sql<Date | null>`last_user_message_at` };

/** Staff answered: who sent the message, and that staff have read the thread up to the person's last message. */
export async function recordReply(
  db: Database,
  input: { messageId: string; staffId: string; userId: string }
): Promise<void> {
  await db.insertInto('support_replies').values({ message_id: input.messageId, staff_id: input.staffId }).execute();
  // The caller holds the pair lock, so no message from the person can commit meanwhile.
  await db.updateTable('support_threads').set(readUpToLastMessage).where('user_id', '=', input.userId).execute();
  await logAction(db, {
    staffId: input.staffId,
    userId: input.userId,
    action: 'support_reply',
    subjectId: input.messageId
  });
}

export interface StoredThread {
  status: SupportStatus;
  resolvedAt: number | null;
  personState: SupportPersonState;
  person: {
    id: string;
    login: string;
    displayName: string;
    avatarKey: string | null;
    avatarColorKey: string;
    avatarAccent: string | null;
  };
}

const personColumns = [
  'u.id',
  'u.login',
  'u.display_name',
  'u.avatar_key',
  'u.avatar_color_key',
  'u.avatar_accent'
] as const;

function person(row: {
  id: string;
  login: string;
  display_name: string;
  avatar_key: string | null;
  avatar_color_key: string;
  avatar_accent: string | null;
}): StoredThread['person'] {
  return {
    id: row.id,
    login: row.login,
    displayName: row.display_name,
    avatarKey: row.avatar_key,
    avatarColorKey: row.avatar_color_key,
    avatarAccent: row.avatar_accent
  };
}

const statusOf = (value: string): SupportStatus => (value === 'resolved' ? 'resolved' : 'open');

// Deleted (or on its way out) before blocked: neither can be answered, and a
// deleted account does not come back.
const personStateSql = sql<SupportPersonState>`CASE
  WHEN u.deleted_at IS NOT NULL OR u.deletion_requested_at IS NOT NULL THEN 'deleted'
  WHEN u.blocked_at IS NOT NULL AND (u.blocked_until IS NULL OR u.blocked_until > clock_timestamp()) THEN 'blocked'
  ELSE 'active' END`;

const personStateOf = (value: string): SupportPersonState =>
  value === 'deleted' ? 'deleted' : value === 'blocked' ? 'blocked' : 'active';

/** One thread with its person. Reading changes nothing; markThreadRead does. */
export async function getThread(db: Database, userId: string): Promise<StoredThread | null> {
  const row = await db
    .selectFrom('support_threads as t')
    .innerJoin('users as u', 'u.id', 't.user_id')
    .select(['t.status', 't.resolved_at', ...personColumns])
    .select(personStateSql.as('person_state'))
    .where('t.user_id', '=', userId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    status: statusOf(row.status),
    resolvedAt: epochMillis(row.resolved_at),
    personState: personStateOf(row.person_state),
    person: person(row)
  };
}

/** Staff opened the thread: read up to the person's last message (never for the person). False without a thread. */
export async function markThreadRead(db: Database, userId: string): Promise<boolean> {
  const row = await db
    .updateTable('support_threads')
    .set(readUpToLastMessage)
    .where('user_id', '=', userId)
    .returning('user_id')
    .executeTakeFirst();
  return Boolean(row);
}

export interface StoredOfficial {
  displayName: string;
  avatarKey: string | null;
  avatarColorKey: string;
  avatarAccent: string | null;
}

/** The official account's name and avatar, as staff see them next to its answers. */
export async function officialProfile(db: Database): Promise<StoredOfficial | null> {
  const row = await db
    .selectFrom('users')
    .select(['display_name', 'avatar_key', 'avatar_color_key', 'avatar_accent'])
    .where('id', '=', official)
    .executeTakeFirst();
  return row
    ? {
        displayName: row.display_name,
        avatarKey: row.avatar_key,
        avatarColorKey: row.avatar_color_key,
        avatarAccent: row.avatar_accent
      }
    : null;
}

export async function threadExists(db: Database, userId: string): Promise<boolean> {
  return Boolean(
    await db.selectFrom('support_threads').select('user_id').where('user_id', '=', userId).executeTakeFirst()
  );
}

export interface StoredThreadSummary extends Omit<StoredThread, 'personState'> {
  unread: boolean;
  lastUserMessageAt: number | null;
  lastMessage: { text: string; at: number | null; fromStaff: boolean; hasAttachments: boolean } | null;
}

/** The threads of one status, the most recent message from the person first. */
export async function listThreads(db: Database, status: SupportStatus, limit = 200): Promise<StoredThreadSummary[]> {
  const rows = await db
    .selectFrom('support_threads as t')
    .innerJoin('users as u', 'u.id', 't.user_id')
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom('direct_messages as m')
          .select((inner) => [
            'm.id',
            'm.body',
            'm.created_at',
            'm.sender_id',
            inner
              .exists(
                inner
                  .selectFrom('message_attachments as a')
                  .select('a.id')
                  .whereRef('a.direct_message_id', '=', 'm.id')
                  .where('a.deleted_at', 'is', null)
              )
              .as('has_attachments')
          ])
          .where(
            sql<boolean>`((m.sender_id = ${official} AND m.recipient_id = t.user_id) OR (m.sender_id = t.user_id AND m.recipient_id = ${official}))`
          )
          .where('m.deleted_at', 'is', null)
          .orderBy('m.created_at', 'desc')
          .orderBy('m.id', 'desc')
          .limit(1)
          .as('last'),
      (join) => join.onTrue()
    )
    .select([
      't.status',
      't.resolved_at',
      't.last_user_message_at',
      ...personColumns,
      'last.id as last_id',
      'last.body as last_body',
      'last.created_at as last_at',
      'last.sender_id as last_sender_id',
      'last.has_attachments as last_has_attachments'
    ])
    .select(
      sql<boolean>`t.last_user_message_at IS NOT NULL AND (t.staff_read_at IS NULL OR t.last_user_message_at > t.staff_read_at)`.as(
        'unread'
      )
    )
    .where('t.status', '=', status)
    .orderBy(sql`t.last_user_message_at DESC NULLS LAST`)
    .orderBy('t.user_id')
    .limit(limit)
    .execute();
  return rows.map((row) => ({
    status: statusOf(row.status),
    resolvedAt: epochMillis(row.resolved_at),
    person: person(row),
    unread: Boolean(row.unread),
    lastUserMessageAt: epochMillis(row.last_user_message_at),
    lastMessage: row.last_id
      ? {
          text: row.last_body ?? '',
          at: epochMillis(row.last_at),
          fromStaff: row.last_sender_id === official,
          hasAttachments: Boolean(row.last_has_attachments)
        }
      : null
  }));
}

/** How many threads each status holds, and how many open ones staff have not read. */
export async function countThreads(db: Database): Promise<{ open: number; resolved: number; openUnread: number }> {
  const row = await db
    .selectFrom('support_threads')
    .select([
      sql<number>`count(*) FILTER (WHERE status = 'open')::int`.as('open'),
      sql<number>`count(*) FILTER (WHERE status = 'resolved')::int`.as('resolved'),
      sql<number>`count(*) FILTER (WHERE status = 'open' AND last_user_message_at IS NOT NULL
        AND (staff_read_at IS NULL OR last_user_message_at > staff_read_at))::int`.as('open_unread')
    ])
    .executeTakeFirstOrThrow();
  return { open: row.open, resolved: row.resolved, openUnread: row.open_unread };
}

/** Which staff member sent each of these answers, by message id. */
export async function replyAuthors(db: Database, messageIds: readonly string[]): Promise<Map<string, string>> {
  if (messageIds.length === 0) return new Map();
  const rows = await db
    .selectFrom('support_replies as r')
    .innerJoin('users', 'users.id', 'r.staff_id')
    .select(['r.message_id', staffName.as('name')])
    .where('r.message_id', 'in', [...messageIds])
    .execute();
  return new Map(rows.map((row) => [row.message_id, row.name]));
}

export interface StoredNote {
  id: string;
  body: string;
  createdAt: number;
  authorName: string;
}

export async function listNotes(db: Database, userId: string): Promise<StoredNote[]> {
  const rows = await db
    .selectFrom('support_notes as n')
    .leftJoin('users', 'users.id', 'n.author_id')
    .select(['n.id', 'n.body', 'n.created_at', sql<string>`coalesce(${staffName}, 'команда')`.as('author_name')])
    .where('n.user_id', '=', userId)
    .orderBy('n.created_at')
    .orderBy('n.id')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.created_at.getTime(),
    authorName: row.author_name
  }));
}

/** A note on an existing thread; null when the person never wrote. */
export async function addNote(
  db: Database,
  input: { userId: string; staffId: string; body: string }
): Promise<StoredNote | null> {
  if (!(await threadExists(db, input.userId))) return null;
  const inserted = await db
    .insertInto('support_notes')
    .values({ user_id: input.userId, author_id: input.staffId, body: input.body })
    .returning(['id', 'body', 'created_at'])
    .executeTakeFirstOrThrow();
  const author = await db
    .selectFrom('users')
    .select(staffName.as('name'))
    .where('id', '=', input.staffId)
    .executeTakeFirst();
  await logAction(db, { staffId: input.staffId, userId: input.userId, action: 'support_note', subjectId: inserted.id });
  return {
    id: inserted.id,
    body: inserted.body,
    createdAt: inserted.created_at.getTime(),
    authorName: author?.name ?? 'команда'
  };
}

/**
 * Moves the thread to «Решённые», only while staff have read every message of
 * the person: a message nobody saw must keep the thread open (AC-A6).
 * `changed` when there is such a message, null when there is no thread.
 */
export async function resolveThread(
  db: Database,
  input: { userId: string; staffId: string }
): Promise<{ resolvedAt: number } | 'changed' | null> {
  const row = await db
    .updateTable('support_threads')
    .set({ status: 'resolved', resolved_at: sql<Date>`now()`, resolved_by: input.staffId })
    .where('user_id', '=', input.userId)
    .where((eb) =>
      eb.or([eb('last_user_message_at', 'is', null), eb('last_user_message_at', '<=', eb.ref('staff_read_at'))])
    )
    .returning('resolved_at')
    .executeTakeFirst();
  if (!row?.resolved_at) return (await threadExists(db, input.userId)) ? 'changed' : null;
  await logAction(db, { staffId: input.staffId, userId: input.userId, action: 'support_resolve' });
  return { resolvedAt: row.resolved_at.getTime() };
}

/** The latest messages either way, oldest first, as messaging stores them. */
export async function listPairMessages(db: Database, userId: string, limit = 200) {
  const rows = await db
    .selectFrom('direct_messages')
    .selectAll()
    .where(inPair(userId))
    .where('deleted_at', 'is', null)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit)
    .execute();
  return rows.reverse().map((row) => mapMessage(row));
}
