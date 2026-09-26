// Accounts: sign-up, sign-in credentials, profile and avatar, password
// changes, and the one-off notices an account has seen.

import crypto from 'node:crypto';
import { sql } from 'kysely';
import type pg from 'pg';
import { kyselyOn, type Database } from '../../platform/db/kysely.ts';
import { hashPassword, verifyPassword } from '../../lib/password.ts';
import { cleanAvatarColorKey } from '@voice-room/shared/validation';
import {
  RECOVERY_CODES_REMINDER_SNOOZE_MS,
  WHATS_NEW_VERSION,
  normalizeReleaseVersion
} from '@voice-room/shared/account-security';
import { UNIQUE_VIOLATION, mapUser, randomAvatarColorKey, toDate } from './user-records.ts';

// Every way of replacing a password ends the same: the old credential stops
// working everywhere, so all sessions and push subscriptions go with it.
export async function replacePassword(
  trx: Database,
  { userId, newPassword, now }: { userId: string; newPassword: string; now: number }
): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  await trx
    .updateTable('users')
    .set({ password_hash: passwordHash, updated_at: toDate(now) })
    .where('id', '=', userId)
    .execute();
  await trx.deleteFrom('sessions').where('user_id', '=', userId).execute();
  await trx.deleteFrom('push_subscriptions').where('user_id', '=', userId).execute();
}

export function lockUser(trx: Database, column: 'id' | 'login', value: string) {
  return trx.selectFrom('users').selectAll().where(column, '=', value).forUpdate().executeTakeFirst();
}

export function createUserRepository({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);

  async function createUser({
    login,
    avatarColorKey = '',
    displayName = '',
    password,
    now = Date.now()
  }: {
    login: string;
    avatarColorKey?: string;
    displayName?: string;
    password: string;
    now?: number;
  }) {
    if (!login) throw new Error('Login is required');
    const passwordHash = await hashPassword(password);
    const id = crypto.randomUUID();
    const assignedAvatarColorKey = cleanAvatarColorKey(avatarColorKey) || randomAvatarColorKey();

    try {
      // "What's new" is for people who used an earlier release; a new account
      // starts at the current announcement.
      const row = await db
        .insertInto('users')
        .values({
          id,
          login,
          display_name: displayName,
          password_hash: passwordHash,
          avatar_color_key: assignedAvatarColorKey,
          created_at: toDate(now),
          updated_at: toDate(now),
          metadata: sql`jsonb_build_object('whatsNewSeen', ${WHATS_NEW_VERSION}::text)`
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return { status: 'created', user: mapUser(row)! };
    } catch (error) {
      if (error && (error as { code?: unknown }).code === UNIQUE_VIOLATION) {
        return { status: 'login_taken', user: null };
      }
      throw error;
    }
  }

  async function getUserByLogin(login: string) {
    return mapUser(await db.selectFrom('users').selectAll().where('login', '=', login).executeTakeFirst());
  }

  async function getUserById(id: string) {
    return mapUser(await db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst());
  }

  // Rename: the display name is the only mutable identity field. An empty value
  // is allowed (the room then falls back to the login). Returns the updated
  // public-shaped user, or null when the account no longer exists.
  async function updateDisplayName({
    userId,
    displayName = '',
    now = Date.now()
  }: {
    userId: string;
    displayName?: string;
    now?: number;
  }) {
    const row = await db
      .updateTable('users')
      .set({ display_name: displayName, updated_at: toDate(now) })
      .where('id', '=', userId)
      .returningAll()
      .executeTakeFirst();
    return mapUser(row);
  }

  function setAvatar(q: Database, userId: string, avatarKey: string | null, avatarAccent: string | null, now: number) {
    return q
      .updateTable('users')
      .set({ avatar_key: avatarKey || null, avatar_accent: avatarAccent || null, updated_at: toDate(now) })
      .where('id', '=', userId)
      .returningAll()
      .executeTakeFirst();
  }

  async function updateAvatar({
    userId,
    avatarKey = null,
    avatarAccent = null,
    now = Date.now()
  }: {
    userId: string;
    avatarKey?: string | null;
    avatarAccent?: string | null;
    now?: number;
  }) {
    return mapUser(await setAvatar(db, userId, avatarKey, avatarAccent, now));
  }

  async function swapAvatar({
    userId,
    avatarKey = null,
    avatarAccent = null,
    now = Date.now()
  }: {
    userId: string;
    avatarKey?: string | null;
    avatarAccent?: string | null;
    now?: number;
  }) {
    return db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom('users')
        .select('avatar_key')
        .where('id', '=', userId)
        .forUpdate()
        .executeTakeFirst();
      if (!current) return { previousAvatarKey: null, user: null };
      const row = await setAvatar(trx, userId, avatarKey, avatarAccent, now);
      return { previousAvatarKey: current.avatar_key || null, user: mapUser(row) };
    });
  }

  async function listAvatarKeys(): Promise<string[]> {
    // An account waiting to be deleted keeps its avatar aside for a restore, so
    // avatar reconciliation must not treat that file as unused.
    const keptForRestore = sql<string | null>`metadata->'deletedProfile'->>'avatarKey'`;
    const rows = await db
      .selectFrom('users')
      .select('avatar_key')
      .where('avatar_key', 'is not', null)
      .union(db.selectFrom('users').select(keptForRestore.as('avatar_key')).where(keptForRestore, 'is not', null))
      .execute();
    return rows.map((row) => row.avatar_key).filter((key): key is string => Boolean(key));
  }

  // Password change always re-verifies the current password first so a leaked
  // session alone can't rotate the credential. Status mirrors the createUser
  // shape so the route layer can branch without inspecting errors.
  async function changePassword({
    userId,
    currentPassword,
    newPassword,
    now = Date.now()
  }: {
    userId: string;
    currentPassword: string;
    newPassword: string;
    now?: number;
  }) {
    return db.transaction().execute(async (trx) => {
      const user = mapUser(await lockUser(trx, 'id', userId));
      if (!user) return { status: 'not_found' };

      const ok = await verifyPassword(currentPassword, user.passwordHash);
      if (!ok) return { status: 'invalid_password' };

      await replacePassword(trx, { userId, newPassword, now });
      return { status: 'updated' };
    });
  }

  async function verifyCredentials(login: string, password: string) {
    const user = await getUserByLogin(login);
    if (!user) {
      // Spend a comparable amount of time so a missing login isn't observably
      // faster than a wrong password.
      await verifyPassword(password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAA==');
      return null;
    }
    const ok = await verifyPassword(password, user.passwordHash);
    return ok ? user : null;
  }

  // The first sign-in from the desktop app is remembered on the account.

  // Per-account state of the nudges the lobby shows: the last "what's new"
  // announcement seen and how long the recovery codes reminder stays hidden.
  async function getAccountNotices(userId: string) {
    const row = await db
      .selectFrom('users')
      .select([
        sql<string | null>`metadata->>'whatsNewSeen'`.as('whats_new_seen'),
        sql<unknown>`metadata->'recoveryCodesReminderSnoozedUntil'`.as('reminder_snoozed_until')
      ])
      .where('id', '=', userId)
      .executeTakeFirst();
    const snoozedUntil = Number(row?.reminder_snoozed_until);
    return {
      whatsNewSeen: normalizeReleaseVersion(row?.whats_new_seen) || null,
      recoveryCodesReminderSnoozedUntil: Number.isSafeInteger(snoozedUntil) && snoozedUntil > 0 ? snoozedUntil : null
    };
  }

  // Only the current announcement can be recorded, so a stale client cannot
  // pin an account to an older release.
  async function markWhatsNewSeen({ userId, now = Date.now() }: { userId: string; now?: number }) {
    const result = await db
      .updateTable('users')
      .set({
        metadata: sql`jsonb_set(metadata, '{whatsNewSeen}', to_jsonb(${WHATS_NEW_VERSION}::text), true)`,
        updated_at: toDate(now)
      })
      .where('id', '=', userId)
      .executeTakeFirst();
    return result.numUpdatedRows === 1n
      ? { status: 'seen', whatsNewSeen: WHATS_NEW_VERSION }
      : { status: 'not_found', whatsNewSeen: null };
  }

  // The one-time post-registration app prompt: the first time it is shown or
  // dismissed wins, so repeated calls from several tabs keep that moment.
  async function markAppPromptSeen({ userId, now = Date.now() }: { userId: string; now?: number }) {
    const seenAtMs = Math.trunc(Number(now) || Date.now());
    const rows = await db
      .updateTable('users')
      .set({
        metadata: sql`CASE
          WHEN metadata ? 'appPromptSeenAt' THEN metadata
          ELSE jsonb_set(metadata, '{appPromptSeenAt}', to_jsonb(${seenAtMs}::bigint), true)
        END`
      })
      .where('id', '=', userId)
      .returning(sql<unknown>`metadata->'appPromptSeenAt'`.as('seen_at'))
      .execute();
    const seenAt = Number(rows[0]?.seen_at);
    return rows.length === 1
      ? { status: 'seen', appPromptSeenAt: Number.isSafeInteger(seenAt) ? seenAt : null }
      : { status: 'not_found', appPromptSeenAt: null };
  }

  async function snoozeRecoveryCodesReminder({ userId, now = Date.now() }: { userId: string; now?: number }) {
    const snoozedUntil = now + RECOVERY_CODES_REMINDER_SNOOZE_MS;
    const result = await db
      .updateTable('users')
      .set({
        metadata: sql`jsonb_set(metadata, '{recoveryCodesReminderSnoozedUntil}', to_jsonb(${snoozedUntil}::bigint), true)`,
        updated_at: toDate(now)
      })
      .where('id', '=', userId)
      .executeTakeFirst();
    return result.numUpdatedRows === 1n
      ? { status: 'snoozed', snoozedUntil }
      : { status: 'not_found', snoozedUntil: null };
  }

  return {
    createUser,
    getUserByLogin,
    getUserById,
    updateDisplayName,
    updateAvatar,
    swapAvatar,
    listAvatarKeys,
    changePassword,
    verifyCredentials,
    getAccountNotices,
    markWhatsNewSeen,
    markAppPromptSeen,
    snoozeRecoveryCodesReminder
  };
}
