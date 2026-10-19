// The log of what platform administrators did to accounts: who, what, when
// and why. Written after each action; read on the account's card.

import type pg from 'pg';
import { sql } from 'kysely';
import type { AdminActionEntry, AdminActionKind } from '@voice-room/shared/contracts/admin';
import type { AccountBadge } from '@voice-room/shared/contracts/users';
import { kyselyOn } from '../../platform/db/kysely.ts';

const ACTIONS = new Set<string>([
  'block',
  'unblock',
  'logout',
  'delete',
  'cancel_deletion',
  'badge'
] satisfies AdminActionKind[]);
const isAction = (value: string): value is AdminActionKind => ACTIONS.has(value);

export interface AdminActionInput {
  adminUserId: string;
  targetUserId: string;
  action: AdminActionKind;
  reason?: string;
  /** A block's end (null: for good). */
  until?: number | null;
  badge?: AccountBadge | null;
}

export function createAdminActionRepository({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);

  async function record(input: AdminActionInput, now: number = Date.now()): Promise<void> {
    const details: Record<string, unknown> = {};
    if (input.until !== undefined) details.until = input.until;
    if (input.badge !== undefined) details.badge = input.badge;
    await db
      .insertInto('admin_actions')
      .values({
        admin_user_id: input.adminUserId,
        target_user_id: input.targetUserId,
        action: input.action,
        reason: input.reason ?? '',
        details: JSON.stringify(details),
        created_at: new Date(now)
      })
      .execute();
  }

  /** The account's log, newest first. */
  async function listFor(targetUserId: string, limit = 100): Promise<AdminActionEntry[]> {
    const rows = await db
      .selectFrom('admin_actions as a')
      .leftJoin('users as u', 'u.id', 'a.admin_user_id')
      .select([
        'a.id',
        'a.action',
        'a.reason',
        'a.created_at',
        sql<unknown>`a.details->'until'`.as('until'),
        sql<unknown>`a.details->>'badge'`.as('badge'),
        sql<string>`coalesce(nullif(u.display_name, ''), u.login, 'администратор')`.as('admin_name')
      ])
      .where('a.target_user_id', '=', targetUserId)
      .orderBy('a.created_at', 'desc')
      .orderBy('a.id', 'desc')
      .limit(limit)
      .execute();
    return rows.flatMap((row) => {
      const { action } = row;
      if (!isAction(action)) return [];
      const until = Number(row.until);
      return [
        {
          id: row.id,
          at: row.created_at.getTime(),
          action,
          reason: row.reason,
          adminName: row.admin_name,
          until: row.until !== null && Number.isFinite(until) ? until : null,
          badge: row.badge === 'official' || row.badge === 'verified' ? row.badge : null
        }
      ];
    });
  }

  return Object.freeze({ record, listFor });
}

export type AdminActionRepository = ReturnType<typeof createAdminActionRepository>;
