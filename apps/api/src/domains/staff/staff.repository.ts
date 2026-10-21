// Staff roles on accounts and the admin app's sessions. A session row hangs
// off the main-site session it came from (staff_sessions.main_session_id), so
// it is found only while that session lives, the account is not blocked and
// still has a role or is named in the settings.

import type pg from 'pg';
import { isStaffRole, type StaffRole } from '@voice-room/shared/contracts/staff';
import { kyselyOn } from '../../platform/db/kysely.ts';

const avatarUrl = (key: string | null) => (key ? `/api/avatars/${encodeURIComponent(key)}` : null);

export interface StaffAccountRow {
  id: string;
  login: string;
  displayName: string;
  avatarUrl: string | null;
  avatarColorKey: string;
  avatarAccent: string | null;
  /** The role stored on the account; null when it has none. */
  storedRole: StaffRole | null;
}

type AccountColumns = {
  id: string;
  login: string;
  display_name: string;
  avatar_key: string | null;
  avatar_color_key: string;
  avatar_accent: string | null;
  staff_role: string | null;
};

function accountOf(row: AccountColumns): StaffAccountRow {
  return {
    id: row.id,
    login: row.login,
    displayName: row.display_name || row.login,
    avatarUrl: avatarUrl(row.avatar_key),
    avatarColorKey: row.avatar_color_key || 'blue',
    avatarAccent: row.avatar_accent,
    storedRole: isStaffRole(row.staff_role) ? row.staff_role : null
  };
}

const ACCOUNT_COLUMNS = [
  'u.id',
  'u.login',
  'u.display_name',
  'u.avatar_key',
  'u.avatar_color_key',
  'u.avatar_accent',
  'u.staff_role'
] as const;

export function createStaffRepository({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);

  /** Accounts that can act: not deleted, and not blocked right now. */
  function activeAccounts() {
    return db
      .selectFrom('users as u')
      .where('u.deleted_at', 'is', null)
      .where((eb) => eb.or([eb('u.blocked_at', 'is', null), eb('u.blocked_until', '<=', new Date())]));
  }

  async function account(userId: string): Promise<StaffAccountRow | null> {
    const row = await activeAccounts().select(ACCOUNT_COLUMNS).where('u.id', '=', userId).executeTakeFirst();
    return row ? accountOf(row) : null;
  }

  /** By login, blocked or not: a blocked account's role can still be taken away. */
  async function accountByLogin(login: string): Promise<StaffAccountRow | null> {
    const row = await db
      .selectFrom('users as u')
      .select(ACCOUNT_COLUMNS)
      .where('u.deleted_at', 'is', null)
      .where('u.login', '=', login)
      .executeTakeFirst();
    return row ? accountOf(row) : null;
  }

  /** Every account with a stored role, and the named ones, by login. */
  async function members(namedIds: readonly string[]): Promise<StaffAccountRow[]> {
    const rows = await activeAccounts()
      .select(ACCOUNT_COLUMNS)
      .where((eb) =>
        namedIds.length > 0
          ? eb.or([eb('u.staff_role', 'is not', null), eb('u.id', 'in', [...namedIds])])
          : eb('u.staff_role', 'is not', null)
      )
      .orderBy('u.login')
      .execute();
    return rows.map(accountOf);
  }

  async function setRole(userId: string, role: StaffRole | null): Promise<void> {
    await db.updateTable('users').set({ staff_role: role }).where('id', '=', userId).execute();
  }

  async function openSession(input: {
    id: string;
    userId: string;
    mainSessionId: string;
    expiresAt: Date;
  }): Promise<boolean> {
    // Only while the main-site session lives: one signed out since the handoff opens nothing.
    const inserted = await db
      .insertInto('staff_sessions')
      .columns(['id', 'user_id', 'main_session_id', 'expires_at'])
      .expression((eb) =>
        eb
          .selectFrom('sessions')
          .select([
            eb.val(input.id).as('id'),
            eb.val(input.userId).as('user_id'),
            'sessions.id as main_session_id',
            eb.val(input.expiresAt).as('expires_at')
          ])
          .where('sessions.id', '=', input.mainSessionId)
      )
      .executeTakeFirst();
    return Number(inserted.numInsertedOrUpdatedRows ?? 0) > 0;
  }

  /** The account behind a live admin-app session whose main-site session lives too. */
  async function sessionAccount(id: string, now: Date): Promise<StaffAccountRow | null> {
    const row = await activeAccounts()
      .innerJoin('staff_sessions as ss', 'ss.user_id', 'u.id')
      .innerJoin('sessions as s', 's.id', 'ss.main_session_id')
      .select(ACCOUNT_COLUMNS)
      .where('ss.id', '=', id)
      .where('ss.expires_at', '>', now)
      .where('s.expires_at', '>', now)
      .executeTakeFirst();
    return row ? accountOf(row) : null;
  }

  async function closeSession(id: string): Promise<void> {
    await db.deleteFrom('staff_sessions').where('id', '=', id).execute();
  }

  async function pruneSessions(now: Date): Promise<number> {
    const result = await db.deleteFrom('staff_sessions').where('expires_at', '<=', now).executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  return Object.freeze({
    account,
    accountByLogin,
    members,
    setRole,
    openSession,
    sessionAccount,
    closeSession,
    pruneSessions
  });
}

export type StaffRepository = ReturnType<typeof createStaffRepository>;
