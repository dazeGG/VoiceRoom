// The log of what platform administrators did to accounts: who, what, when
// and why. Written after each action; read on the account's card.

import type pg from 'pg';
import { sql } from 'kysely';
import type { AdminActionEntry, AdminActionKind } from '@voice-room/shared/contracts/admin';
import type { AccountBadge } from '@voice-room/shared/contracts/users';
import { isStaffRole, type StaffRole } from '@voice-room/shared/contracts/staff';
import { kyselyOn } from '../../platform/db/kysely.ts';

const ACTIONS = new Set<string>(['block', 'unblock', 'logout', 'delete', 'cancel_deletion', 'badge', 'staff_role']);

export interface AdminActionInput {
  adminUserId: string;
  targetUserId: string;
  action: AdminActionKind;
  reason?: string;
  /** A block's end (null: for good). */
  until?: number | null;
  badge?: AccountBadge | null;
  /** The role a staff_role action gave (null: taken away). */
  role?: StaffRole | null | undefined;
}

const millis = (value: unknown): number => (value instanceof Date ? value.getTime() : Date.parse(String(value)));

export function createAdminActionRepository({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);

  async function record(input: AdminActionInput, now: number = Date.now()): Promise<void> {
    const details: Record<string, unknown> = {};
    if (input.until !== undefined) details.until = input.until;
    if (input.badge !== undefined) details.badge = input.badge;
    if (input.role !== undefined) details.role = input.role;
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
        sql<unknown>`a.details->>'role'`.as('role'),
        sql<string>`coalesce(nullif(u.display_name, ''), u.login, 'администратор')`.as('admin_name')
      ])
      .where('a.target_user_id', '=', targetUserId)
      .orderBy('a.created_at', 'desc')
      .orderBy('a.id', 'desc')
      .limit(limit)
      .execute();
    return rows.flatMap((row) => {
      if (!ACTIONS.has(row.action)) return [];
      const until = Number(row.until);
      return [
        {
          id: row.id,
          at: millis(row.created_at),
          action: row.action as AdminActionKind,
          reason: row.reason,
          adminName: row.admin_name,
          until: row.until !== null && Number.isFinite(until) ? until : null,
          badge: row.badge === 'official' || row.badge === 'verified' ? row.badge : null,
          role: isStaffRole(row.role) ? row.role : null
        }
      ];
    });
  }

  return Object.freeze({ record, listFor });
}

export type AdminActionRepository = ReturnType<typeof createAdminActionRepository>;
