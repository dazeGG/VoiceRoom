// An account's standing on the service, as the platform administrator sets
// it: a block (every session and push subscription ends with it), signing it
// out everywhere, and the mark next to its name.

import type pg from 'pg';
import type { AccountBadge } from '@voiceroom/shared/contracts/users';
import { kyselyOn } from '../../platform/db/kysely.ts';
import { toDate } from '../../platform/epoch-millis.ts';
import { lockUser } from './user.repository.ts';
import { cleanBadge } from './user-records.ts';

export function createAccountStandingRepository({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);

  /** Locks current standing before changing a live account or ending its sessions. */
  async function block({
    userId,
    until,
    reason,
    canManage,
    now = Date.now()
  }: {
    userId: string;
    until: number | null;
    reason: string;
    canManage: boolean;
    now?: number;
  }): Promise<'updated' | 'not_found' | 'forbidden'> {
    return db.transaction().execute(async (trx) => {
      const user = await lockUser(trx, 'id', userId);
      if (!user || user.deleted_at) return 'not_found';
      if (!canManage && (until === null || (user.blocked_at !== null && user.blocked_until === null)))
        return 'forbidden';
      const result = await trx
        .updateTable('users')
        .set({
          blocked_at: toDate(now),
          blocked_until: until === null ? null : toDate(until),
          block_reason: reason,
          updated_at: toDate(now)
        })
        .where('id', '=', userId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (result.numUpdatedRows !== 1n) return 'not_found';
      await trx.deleteFrom('sessions').where('user_id', '=', userId).execute();
      await trx.deleteFrom('push_subscriptions').where('user_id', '=', userId).execute();
      return 'updated';
    });
  }

  async function unblock({
    userId,
    canManage,
    now = Date.now()
  }: {
    userId: string;
    canManage: boolean;
    now?: number;
  }): Promise<'updated' | 'not_found' | 'forbidden'> {
    return db.transaction().execute(async (trx) => {
      const user = await lockUser(trx, 'id', userId);
      if (!user || user.deleted_at) return 'not_found';
      if (!canManage && user.blocked_at !== null && user.blocked_until === null) return 'forbidden';
      await trx
        .updateTable('users')
        .set({ blocked_at: null, blocked_until: null, block_reason: '', updated_at: toDate(now) })
        .where('id', '=', userId)
        .execute();
      return 'updated';
    });
  }

  /** Ends every session of the account; the number ended. */
  async function endAllSessions(userId: string): Promise<number> {
    const result = await db.deleteFrom('sessions').where('user_id', '=', userId).executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  async function setBadge({
    userId,
    badge,
    now = Date.now()
  }: {
    userId: string;
    badge: AccountBadge | null;
    now?: number;
  }): Promise<boolean> {
    const result = await db
      .updateTable('users')
      .set({ badge, updated_at: toDate(now) })
      .where('id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return result.numUpdatedRows === 1n;
  }

  /** Every live account that carries a mark. */
  async function listBadges(): Promise<{ userId: string; badge: AccountBadge }[]> {
    const rows = await db
      .selectFrom('users')
      .select(['id', 'badge'])
      .where('badge', 'is not', null)
      .where('deleted_at', 'is', null)
      .orderBy('id')
      .execute();
    return rows.flatMap((row) => {
      const badge = cleanBadge(row.badge);
      return badge ? [{ userId: row.id, badge }] : [];
    });
  }

  return Object.freeze({ block, unblock, endAllSessions, setBadge, listBadges });
}

export type AccountStandingRepository = ReturnType<typeof createAccountStandingRepository>;
