// Which accounts were active on which day, and from which kind of client. The
// only writer of user_activity_days (the account deletion purge aside).

import type pg from 'pg';
import { sql } from 'kysely';
import type { ClientKind } from '@voice-room/shared/contracts/admin';
import { kyselyOn } from '../../platform/db/kysely.ts';

export type ActivityMark = {
  userId: string;
  /** The calendar day, YYYY-MM-DD. */
  day: string;
  /** Null when the client is unknown (a socket still open from an earlier day). */
  client: ClientKind | null;
};

export function createActivityRepository({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);

  /** Marks each account active on its day; a client seen once that day stays marked. */
  async function recordActivity(marks: ActivityMark[]): Promise<void> {
    if (marks.length === 0) return;
    await db
      .insertInto('user_activity_days')
      .values(
        marks.map((mark) => ({
          user_id: mark.userId,
          day: mark.day,
          desktop_app: mark.client === 'desktop_app',
          mobile: mark.client === 'mobile' || mark.client === 'mobile_app',
          browser: mark.client === 'browser'
        }))
      )
      .onConflict((conflict) =>
        conflict.columns(['user_id', 'day']).doUpdateSet({
          desktop_app: sql<boolean>`user_activity_days.desktop_app OR excluded.desktop_app`,
          mobile: sql<boolean>`user_activity_days.mobile OR excluded.mobile`,
          browser: sql<boolean>`user_activity_days.browser OR excluded.browser`
        })
      )
      .execute();
  }

  /** Forgets every mark of a day before `cutoffDay` (YYYY-MM-DD); answers how many went. Counted first by admin-stats rollUp. */
  async function forgetBefore(cutoffDay: string): Promise<number> {
    const result = await db
      .deleteFrom('user_activity_days')
      .where('day', '<', sql<Date>`${cutoffDay}::date`)
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  return Object.freeze({ recordActivity, forgetBefore });
}

export type ActivityRepository = ReturnType<typeof createActivityRepository>;
