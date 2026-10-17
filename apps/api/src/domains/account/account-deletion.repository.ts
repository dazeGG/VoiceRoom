import crypto from 'node:crypto';
import { sql } from 'kysely';
import type pg from 'pg';
import { kyselyOn, type Database } from '../../platform/db/kysely.ts';
import type { Json } from '../../platform/db/schema.ts';
import { verifyPassword } from '../../lib/password.ts';
import {
  ACCOUNT_DELETION_GRACE_MS,
  DELETED_ACCOUNT_NAME,
  DELETED_LOGIN_PREFIX,
  type AccountDeletionPreview
} from '@voice-room/shared/account-security';

const UNUSABLE_PASSWORD_HASH = '!';

type DeletedProfile = { displayName?: unknown; avatarKey?: string | null; avatarAccent?: string | null };

type UserRow = {
  id: string;
  login: string;
  display_name: string | null;
  password_hash: string;
  avatar_key: string | null;
  avatar_accent: string | null;
  metadata: { deletedProfile?: DeletedProfile; deletionByAdmin?: string } | null;
  deletion_requested_at: Date | string | null;
  deleted_at: Date | string | null;
  blocked_at: Date | string | null;
  blocked_until: Date | string | null;
  block_reason: string;
};

type OwnedRoomRow = {
  id: string;
  name: string | null;
  avatar_key: string | null;
  heir_user_id: string | null;
  heir_display_name: string | null;
  heir_login: string;
};

export type DeletionRequest =
  { status: 'not_found' | 'invalid_password' } | { status: 'already_requested' | 'requested'; scheduledFor: number };

export type AccountRestore =
  | { status: 'invalid' | 'expired'; userId: null }
  | { status: 'blocked'; userId: null; blockedUntil: number | null; blockReason: string }
  | { status: 'restored'; userId: string };

export type OperatorDeletion =
  { status: 'not_found' } | { status: 'already_requested' | 'requested'; scheduledFor: number };

export type DeletionCancel = { status: 'not_found' | 'not_by_admin' } | { status: 'cancelled' };

export type DeletionFinish =
  | { status: 'not_due' }
  | {
      status: 'deleted';
      transferredRooms: { roomId: string; heirUserId: string }[];
      deletedRooms: { roomId: string; avatarKey: string | null }[];
      avatarKey: string | null;
    };

function toDate(ms: number): Date {
  return new Date(ms);
}

function toMillis(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value as string);
  return Number.isFinite(parsed) ? parsed : null;
}

function hashLogin(login: unknown): string {
  return crypto
    .createHash('sha256')
    .update(
      String(login || '')
        .trim()
        .toLowerCase()
    )
    .digest('hex');
}

// Static rooms the account owns, each with the member who would inherit it:
// the longest-standing member who is neither leaving nor banned from the room.
function ownedRoomsWithHeirs(db: Database, userId: string, now: number) {
  return db
    .selectFrom('rooms as r')
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom('room_memberships as m')
          .innerJoin('users as u', 'u.id', 'm.user_id')
          .select('m.user_id')
          .whereRef('m.room_id', '=', 'r.id')
          .where('m.user_id', '<>', userId)
          .where('u.deletion_requested_at', 'is', null)
          .where('u.deleted_at', 'is', null)
          .where((w) =>
            w.not(
              w.exists(
                w
                  .selectFrom('room_bans as b')
                  .select('b.id')
                  .whereRef('b.room_id', '=', 'r.id')
                  .whereRef('b.user_id', '=', 'm.user_id')
                  .where('b.revoked_at', 'is', null)
                  .where((x) => x.or([x('b.expires_at', 'is', null), x('b.expires_at', '>', toDate(now))]))
              )
            )
          )
          .orderBy('m.created_at', 'asc')
          .orderBy('m.user_id', 'asc')
          .limit(1)
          .as('heir'),
      (join) => join.onTrue()
    )
    .leftJoin('users as hu', 'hu.id', 'heir.user_id')
    .select([
      'r.id',
      'r.name',
      'r.avatar_key',
      'heir.user_id as heir_user_id',
      'hu.display_name as heir_display_name',
      'hu.login as heir_login'
    ])
    .where('r.owner_id', '=', userId)
    .where('r.is_static', '=', true)
    .where('r.deleted_at', 'is', null)
    .orderBy('r.created_at', 'asc')
    .orderBy('r.id', 'asc')
    .execute() as Promise<OwnedRoomRow[]>;
}

// Everything personal the finished deletion removes. Messages, reactions, pins
// and mentions stay: other people's conversations keep an anonymous author.
function removePersonalData(trx: Database, userId: string) {
  return Promise.all([
    trx.deleteFrom('room_memberships').where('user_id', '=', userId).execute(),
    trx.deleteFrom('room_bookmarks').where('user_id', '=', userId).execute(),
    trx.deleteFrom('room_chat_reads').where('user_id', '=', userId).execute(),
    trx
      .deleteFrom('friendships')
      .where((eb) => eb.or([eb('user_a_id', '=', userId), eb('user_b_id', '=', userId)]))
      .execute(),
    trx
      .deleteFrom('friend_requests')
      .where((eb) => eb.or([eb('requester_id', '=', userId), eb('addressee_id', '=', userId)]))
      .execute(),
    trx
      .deleteFrom('user_blocks')
      .where((eb) => eb.or([eb('blocker_id', '=', userId), eb('blocked_id', '=', userId)]))
      .execute(),
    trx.deleteFrom('notification_preferences').where('user_id', '=', userId).execute(),
    trx
      .deleteFrom('notification_dm_mutes')
      .where((eb) => eb.or([eb('user_id', '=', userId), eb('peer_user_id', '=', userId)]))
      .execute(),
    trx.deleteFrom('notification_room_mutes').where('user_id', '=', userId).execute(),
    trx.deleteFrom('user_notifications').where('recipient_user_id', '=', userId).execute(),
    trx.deleteFrom('push_subscriptions').where('user_id', '=', userId).execute(),
    trx.deleteFrom('sessions').where('user_id', '=', userId).execute(),
    trx.deleteFrom('account_recovery_codes').where('user_id', '=', userId).execute(),
    trx.deleteFrom('account_login_events').where('user_id', '=', userId).execute(),
    trx.deleteFrom('voice_sessions').where('user_id', '=', userId).execute(),
    trx.deleteFrom('user_activity_days').where('user_id', '=', userId).execute(),
    // Call feedback stays for the numbers but no longer says whose it was.
    trx.updateTable('call_feedback').set({ user_id: null }).where('user_id', '=', userId).execute()
  ]);
}

// Hides the account while it waits: the anonymous name everywhere, the
// profile kept aside for a restore, every session and push subscription gone.
async function hideForDeletion(trx: Database, user: UserRow, now: number, adminUserId: string | null = null) {
  const deletedProfile = {
    displayName: user.display_name || '',
    avatarKey: user.avatar_key || null,
    avatarAccent: user.avatar_accent || null
  };
  const kept = sql<Json>`jsonb_set(metadata, '{deletedProfile}', ${JSON.stringify(deletedProfile)}::jsonb, true)`;
  await trx
    .updateTable('users')
    .set({
      deletion_requested_at: toDate(now),
      display_name: DELETED_ACCOUNT_NAME,
      avatar_key: null,
      avatar_accent: null,
      metadata: adminUserId
        ? sql<Json>`jsonb_set(${kept}, '{deletionByAdmin}', to_jsonb(${adminUserId}::text), true)`
        : kept,
      updated_at: toDate(now)
    })
    .where('id', '=', user.id)
    .execute();
  await trx.deleteFrom('sessions').where('user_id', '=', user.id).execute();
  await trx.deleteFrom('push_subscriptions').where('user_id', '=', user.id).execute();
}

// The profile a waiting account kept aside, back in place.
function restoredProfile(user: UserRow, now: number) {
  const profile: DeletedProfile = user.metadata?.deletedProfile || {};
  return {
    deletion_requested_at: null,
    display_name: typeof profile.displayName === 'string' ? profile.displayName : '',
    avatar_key: profile.avatarKey || null,
    avatar_accent: profile.avatarAccent || null,
    metadata: sql<Json>`metadata - 'deletedProfile' - 'deletionByAdmin'`,
    updated_at: toDate(now)
  };
}

function lockUser(trx: Database, column: 'id' | 'login', value: string) {
  return trx.selectFrom('users').selectAll().where(column, '=', value).forUpdate().executeTakeFirst() as Promise<
    UserRow | undefined
  >;
}

// Owns the account deletion lifecycle, which spans tables owned by several
// stores: a request hides the account and keeps its profile aside for a restore
// during the grace period; the finish hands its rooms over, removes its personal
// data and anonymizes the row others' messages still point at.
function createAccountDeletionRepository({
  pool,
  now: clock = Date.now
}: { pool?: pg.Pool | null; now?: () => number } = {}) {
  if (!pool) throw new TypeError('pool is required');
  const db = kyselyOn(pool);

  async function previewDeletion({
    userId,
    now = clock()
  }: {
    userId: string;
    now?: number;
  }): Promise<AccountDeletionPreview> {
    const rooms = await ownedRoomsWithHeirs(db, userId, now);
    return {
      graceDays: Math.round(ACCOUNT_DELETION_GRACE_MS / (24 * 60 * 60 * 1000)),
      rooms: rooms.map((row) => ({
        roomId: row.id,
        name: row.name || '',
        heir: row.heir_user_id ? { displayName: row.heir_display_name || '', login: row.heir_login } : null
      }))
    };
  }

  async function requestDeletion({
    userId,
    currentPassword,
    now = clock()
  }: {
    userId: string;
    currentPassword: unknown;
    now?: number;
  }): Promise<DeletionRequest> {
    return db.transaction().execute(async (trx): Promise<DeletionRequest> => {
      const user = await lockUser(trx, 'id', userId);
      if (!user || user.deleted_at) return { status: 'not_found' };
      if (user.deletion_requested_at) {
        return {
          status: 'already_requested',
          scheduledFor: (toMillis(user.deletion_requested_at) as number) + ACCOUNT_DELETION_GRACE_MS
        };
      }
      if (!(await verifyPassword(currentPassword, user.password_hash))) return { status: 'invalid_password' };
      await hideForDeletion(trx, user, now);
      return { status: 'requested', scheduledFor: now + ACCOUNT_DELETION_GRACE_MS };
    });
  }

  // The platform administrator's deletion: the same grace period, but the
  // account is blocked for good with the reason, so its owner cannot restore
  // it; only an administrator can call it off.
  async function requestDeletionByOperator({
    userId,
    adminUserId,
    reason,
    now = clock()
  }: {
    userId: string;
    adminUserId: string;
    reason: string;
    now?: number;
  }): Promise<OperatorDeletion> {
    return db.transaction().execute(async (trx): Promise<OperatorDeletion> => {
      const user = await lockUser(trx, 'id', userId);
      if (!user || user.deleted_at) return { status: 'not_found' };
      if (user.deletion_requested_at) {
        return {
          status: 'already_requested',
          scheduledFor: (toMillis(user.deletion_requested_at) as number) + ACCOUNT_DELETION_GRACE_MS
        };
      }
      await hideForDeletion(trx, user, now, adminUserId);
      await trx
        .updateTable('users')
        .set({ blocked_at: toDate(now), blocked_until: null, block_reason: reason })
        .where('id', '=', userId)
        .execute();
      return { status: 'requested', scheduledFor: now + ACCOUNT_DELETION_GRACE_MS };
    });
  }

  // Calls off an administrator's deletion: the profile comes back and the
  // block the deletion set is lifted. A deletion its owner asked for stays theirs.
  async function cancelOperatorDeletion({
    userId,
    now = clock()
  }: {
    userId: string;
    now?: number;
  }): Promise<DeletionCancel> {
    return db.transaction().execute(async (trx): Promise<DeletionCancel> => {
      const user = await lockUser(trx, 'id', userId);
      if (!user || user.deleted_at || !user.deletion_requested_at) return { status: 'not_found' };
      if (!user.metadata?.deletionByAdmin) return { status: 'not_by_admin' };
      await trx
        .updateTable('users')
        .set({ ...restoredProfile(user, now), blocked_at: null, blocked_until: null, block_reason: '' })
        .where('id', '=', user.id)
        .execute();
      return { status: 'cancelled' };
    });
  }

  // Same answer for an unknown login and a wrong password; a password is
  // checked either way so neither is observably faster.
  async function restoreAccount({
    login,
    password,
    now = clock()
  }: {
    login: string;
    password: unknown;
    now?: number;
  }): Promise<AccountRestore> {
    return db.transaction().execute(async (trx): Promise<AccountRestore> => {
      const user = await lockUser(trx, 'login', login);
      const pending = user && !user.deleted_at && user.deletion_requested_at;
      const passwordMatches = await verifyPassword(password, pending ? user.password_hash : UNUSABLE_PASSWORD_HASH);
      if (!pending || !passwordMatches) return { status: 'invalid', userId: null };
      if ((toMillis(user.deletion_requested_at) as number) + ACCOUNT_DELETION_GRACE_MS <= now)
        return { status: 'expired', userId: null };
      const blockedUntil = user.blocked_until ? (toMillis(user.blocked_until) as number) : null;
      if (user.blocked_at && (blockedUntil === null || blockedUntil > now))
        return { status: 'blocked', userId: null, blockedUntil, blockReason: user.block_reason || '' };

      await trx.updateTable('users').set(restoredProfile(user, now)).where('id', '=', user.id).execute();
      return { status: 'restored', userId: user.id };
    });
  }

  async function listDueDeletions({ now = clock(), limit = 20 }: { now?: number; limit?: number } = {}): Promise<
    string[]
  > {
    const rows = await db
      .selectFrom('users')
      .select('id')
      .where('deleted_at', 'is', null)
      .where('deletion_requested_at', 'is not', null)
      .where('deletion_requested_at', '<=', toDate(now - ACCOUNT_DELETION_GRACE_MS))
      .orderBy('deletion_requested_at', 'asc')
      .limit(limit)
      .execute();
    return rows.map((row) => row.id);
  }

  // Hands each owned room to its heir (or deletes it when nobody can take it),
  // removes the personal data, reserves the login and anonymizes the row.
  async function finalizeDeletion({
    userId,
    now = clock()
  }: {
    userId: string;
    now?: number;
  }): Promise<DeletionFinish> {
    return db.transaction().execute(async (trx): Promise<DeletionFinish> => {
      const user = await lockUser(trx, 'id', userId);
      if (
        !user ||
        user.deleted_at ||
        !user.deletion_requested_at ||
        (toMillis(user.deletion_requested_at) as number) + ACCOUNT_DELETION_GRACE_MS > now
      ) {
        return { status: 'not_due' };
      }

      const at = toDate(now);
      const transferredRooms: { roomId: string; heirUserId: string }[] = [];
      const deletedRooms: { roomId: string; avatarKey: string | null }[] = [];
      for (const room of await ownedRoomsWithHeirs(trx, userId, now)) {
        if (room.heir_user_id) {
          await trx
            .updateTable('rooms')
            .set({ owner_id: room.heir_user_id, updated_at: at })
            .where('id', '=', room.id)
            .execute();
          await trx
            .updateTable('room_memberships')
            .set({ role: 'owner', updated_at: at })
            .where('room_id', '=', room.id)
            .where('user_id', '=', room.heir_user_id)
            .execute();
          transferredRooms.push({ roomId: room.id, heirUserId: room.heir_user_id });
        } else {
          await trx
            .updateTable('rooms')
            .set((eb) => ({ deleted_at: eb.fn.coalesce('deleted_at', eb.val(at)), updated_at: at }))
            .where('id', '=', room.id)
            .execute();
          deletedRooms.push({ roomId: room.id, avatarKey: room.avatar_key || null });
        }
      }

      await removePersonalData(trx, userId);

      await trx
        .insertInto('reserved_logins')
        .values({ login_hash: hashLogin(user.login), reserved_at: at })
        .onConflict((oc) => oc.column('login_hash').doNothing())
        .execute();
      const avatarKey = user.metadata?.deletedProfile?.avatarKey || user.avatar_key || null;
      await trx
        .updateTable('users')
        .set({
          login: `${DELETED_LOGIN_PREFIX}${user.id.replace(/-/g, '').slice(0, 24)}`,
          display_name: DELETED_ACCOUNT_NAME,
          password_hash: UNUSABLE_PASSWORD_HASH,
          avatar_key: null,
          avatar_accent: null,
          presence_status: 'offline',
          metadata: '{}',
          deleted_at: at,
          updated_at: at
        })
        .where('id', '=', userId)
        .execute();
      return { status: 'deleted', transferredRooms, deletedRooms, avatarKey };
    });
  }

  async function isLoginReserved(login: unknown): Promise<boolean> {
    const row = await db
      .selectFrom('reserved_logins')
      .select('login_hash')
      .where('login_hash', '=', hashLogin(login))
      .executeTakeFirst();
    return Boolean(row);
  }

  return Object.freeze({
    cancelOperatorDeletion,
    finalizeDeletion,
    isLoginReserved,
    listDueDeletions,
    previewDeletion,
    requestDeletion,
    requestDeletionByOperator,
    restoreAccount
  });
}

export type AccountDeletionRepository = ReturnType<typeof createAccountDeletionRepository>;

export { createAccountDeletionRepository };
