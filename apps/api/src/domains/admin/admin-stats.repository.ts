// The product numbers of the admin panel, counted from the tables that hold
// them; days are Moscow days, the same as the activity marks. Who was active
// or in voice is kept per person for VOICE_HISTORY_KEEP_DAYS: rollUp turns
// older days into counts (product_days) and freezes each signup week's return
// rates (retention_weeks) before their owners forget the per-person rows, and
// the reads take the counts where the rows are gone. The only writer of both.

import type pg from 'pg';
import { sql } from 'kysely';
import type { ProductDay, RetentionWeek } from '@voice-room/shared/contracts/admin';
import { kyselyOn } from '../../platform/db/kysely.ts';

const MSK = sql.lit('Europe/Moscow');
const mskDay = (column: string) => sql`(${sql.ref(column)} AT TIME ZONE ${MSK})::date`;

export type OverviewCounts = {
  day: string;
  activeToday: number;
  newToday: number;
  messagesToday: number;
  voiceJoinsToday: number;
  voiceMinutesToday: number;
  accounts: number;
  staticRooms: number;
  temporaryRooms: number;
  messages: number;
  weeklyActive: number;
  monthlyActive: number;
  openReports: number;
};

const n = (value: unknown): number => Number(value) || 0;

/** A count as the driver returns it: a number, bigint text, or null where a LEFT JOIN found nothing. */
type Count = number | string | null;

type OverviewRow = {
  day: string;
  active_today: Count;
  new_today: Count;
  messages_today: Count;
  voice_joins_today: Count;
  voice_minutes_today: Count;
  accounts: Count;
  static_rooms: Count;
  temporary_rooms: Count;
  messages: Count;
  weekly_active: Count;
  monthly_active: Count;
  open_reports: Count;
};

type ProductDayRow = {
  day: string;
  active_accounts: Count;
  desktop_app: Count;
  browser: Count;
  mobile: Count;
  new_accounts: Count;
  room_messages: Count;
  direct_messages: Count;
  message_authors: Count;
  static_rooms: Count;
  temporary_rooms: Count;
  account_hours: Count;
  guest_hours: Count;
  joins: Count;
  voice_accounts: Count;
  online: Count;
  guests: Count;
  voice_peers: Count;
  voice_rooms: Count;
};

type RetentionRow = { week: string; accounts: Count; w1: Count; w2: Count; m1: Count };

/** A signup week's return rates are final once its last signup's first month is over. */
const RETENTION_FINAL_DAYS = 7 + 30;

/** Each signup week's accounts and return rates, counted from the per-person activity still kept. */
const liveRetention = sql`
  WITH cohort AS (
    SELECT id AS user_id,
           date_trunc('week', created_at AT TIME ZONE ${MSK})::date AS week,
           ${mskDay('created_at')} AS signup
    FROM users WHERE deleted_at IS NULL
  ),
  returned AS (
    SELECT c.user_id,
           bool_or(a.day - c.signup BETWEEN 1 AND 7) AS w1,
           bool_or(a.day - c.signup BETWEEN 8 AND 14) AS w2,
           bool_or(a.day - c.signup BETWEEN 15 AND 30) AS m1
    FROM cohort c JOIN user_activity_days a USING (user_id)
    GROUP BY c.user_id
  )
  SELECT c.week,
         count(*) AS accounts,
         round(100.0 * count(*) FILTER (WHERE r.w1) / count(*)) AS w1,
         round(100.0 * count(*) FILTER (WHERE r.w2) / count(*)) AS w2,
         round(100.0 * count(*) FILTER (WHERE r.m1) / count(*)) AS m1
  FROM cohort c LEFT JOIN returned r USING (user_id)
  GROUP BY c.week
`;

export function createAdminStatsRepository({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);

  async function overview(): Promise<OverviewCounts> {
    const today = sql`(now() AT TIME ZONE ${MSK})::date`;
    const result = await sql<OverviewRow>`
      SELECT
        to_char(${today}, 'YYYY-MM-DD') AS day,
        (SELECT count(*) FROM user_activity_days WHERE day = ${today}) AS active_today,
        (SELECT count(*) FROM users WHERE ${mskDay('created_at')} = ${today}) AS new_today,
        (SELECT count(*) FROM room_messages WHERE ${mskDay('created_at')} = ${today})
          + (SELECT count(*) FROM direct_messages WHERE ${mskDay('created_at')} = ${today}) AS messages_today,
        (SELECT count(*) FROM voice_sessions WHERE ${mskDay('joined_at')} = ${today}) AS voice_joins_today,
        (SELECT coalesce(sum(extract(epoch FROM left_at - joined_at)), 0) / 60.0
           FROM voice_sessions WHERE ${mskDay('joined_at')} = ${today}) AS voice_minutes_today,
        (SELECT count(*) FROM users WHERE deleted_at IS NULL) AS accounts,
        (SELECT count(*) FROM rooms WHERE is_static AND deleted_at IS NULL) AS static_rooms,
        (SELECT count(*) FROM rooms WHERE NOT is_static AND deleted_at IS NULL) AS temporary_rooms,
        (SELECT count(*) FROM room_messages) + (SELECT count(*) FROM direct_messages) AS messages,
        (SELECT count(DISTINCT user_id) FROM user_activity_days WHERE day > ${today} - 7) AS weekly_active,
        (SELECT count(DISTINCT user_id) FROM user_activity_days WHERE day > ${today} - 30) AS monthly_active,
        (SELECT count(*) FROM content_reports WHERE status = 'open') AS open_reports
    `.execute(db);
    const row = result.rows[0];
    return {
      day: row?.day ?? '',
      activeToday: n(row?.active_today),
      newToday: n(row?.new_today),
      messagesToday: n(row?.messages_today),
      voiceJoinsToday: n(row?.voice_joins_today),
      voiceMinutesToday: Math.round(n(row?.voice_minutes_today)),
      accounts: n(row?.accounts),
      staticRooms: n(row?.static_rooms),
      temporaryRooms: n(row?.temporary_rooms),
      messages: n(row?.messages),
      weeklyActive: n(row?.weekly_active),
      monthlyActive: n(row?.monthly_active),
      openReports: n(row?.open_reports)
    };
  }

  /** Every Moscow day from `from` to `to` (both included, oldest first), with zeros where nothing happened. */
  async function productDays(from: string, to: string): Promise<{ days: ProductDay[]; accountsBefore: number }> {
    const first = sql`${from}::date`;
    const last = sql`${to}::date`;
    const since = sql`(${first})::timestamp AT TIME ZONE ${MSK}`;
    const until = sql`(${last} + 1)::timestamp AT TIME ZONE ${MSK}`;
    const result = await sql<ProductDayRow>`
      WITH span AS (
        SELECT generate_series(${first}, ${last}, interval '1 day')::date AS day
      ),
      activity AS (
        SELECT day,
               count(*) AS active_accounts,
               count(*) FILTER (WHERE desktop_app) AS desktop_app,
               count(*) FILTER (WHERE browser) AS browser,
               count(*) FILTER (WHERE mobile) AS mobile
        FROM user_activity_days WHERE day BETWEEN ${first} AND ${last} GROUP BY day
        UNION ALL
        SELECT day, active_accounts, desktop_app, browser, mobile
        FROM product_days WHERE day BETWEEN ${first} AND ${last}
      ),
      accounts AS (
        SELECT ${mskDay('created_at')} AS day, count(*) AS new_accounts
        FROM users WHERE created_at >= ${since} AND created_at < ${until} GROUP BY 1
      ),
      messages AS (
        SELECT day, count(*) FILTER (WHERE kind = 'room') AS room_messages,
               count(*) FILTER (WHERE kind = 'dm') AS direct_messages,
               count(DISTINCT author) AS message_authors
        FROM (
          SELECT ${mskDay('created_at')} AS day, 'room' AS kind, author_user_id AS author
          FROM room_messages WHERE created_at >= ${since} AND created_at < ${until}
          UNION ALL
          SELECT ${mskDay('created_at')}, 'dm', sender_id FROM direct_messages WHERE created_at >= ${since} AND created_at < ${until}
        ) sent
        GROUP BY day
      ),
      rooms_created AS (
        SELECT ${mskDay('created_at')} AS day,
               count(*) FILTER (WHERE is_static) AS static_rooms,
               count(*) FILTER (WHERE NOT is_static) AS temporary_rooms
        FROM rooms WHERE created_at >= ${since} AND created_at < ${until} GROUP BY 1
      ),
      voice AS (
        SELECT ${mskDay('joined_at')} AS day,
               sum(extract(epoch FROM left_at - joined_at)) FILTER (WHERE user_id IS NOT NULL) / 3600.0 AS account_hours,
               sum(extract(epoch FROM left_at - joined_at)) FILTER (WHERE user_id IS NULL) / 3600.0 AS guest_hours,
               count(*) AS joins,
               count(DISTINCT user_id) AS accounts
        FROM voice_sessions WHERE joined_at >= ${since} AND joined_at < ${until}
          -- A rolled-up day's stays no longer say whose they were: its counts stand in.
          AND ${mskDay('joined_at')} NOT IN (SELECT day FROM product_days)
        GROUP BY 1
        UNION ALL
        SELECT day, voice_account_hours, voice_guest_hours, voice_joins, voice_accounts
        FROM product_days WHERE day BETWEEN ${first} AND ${last}
      ),
      peaks AS (
        SELECT ${mskDay('at')} AS day,
               max(online_accounts) AS online, max(guest_connections) AS guests,
               max(voice_peers) AS voice_peers, max(voice_rooms) AS voice_rooms
        FROM product_snapshots WHERE at >= ${since} AND at < ${until} GROUP BY 1
      )
      SELECT to_char(span.day, 'YYYY-MM-DD') AS day,
             activity.active_accounts, activity.desktop_app, activity.browser, activity.mobile,
             accounts.new_accounts,
             messages.room_messages, messages.direct_messages, messages.message_authors,
             rooms_created.static_rooms, rooms_created.temporary_rooms,
             voice.account_hours, voice.guest_hours, voice.joins, voice.accounts AS voice_accounts,
             peaks.online, peaks.guests, peaks.voice_peers, peaks.voice_rooms
      FROM span
      LEFT JOIN activity USING (day)
      LEFT JOIN accounts USING (day)
      LEFT JOIN messages USING (day)
      LEFT JOIN rooms_created USING (day)
      LEFT JOIN voice USING (day)
      LEFT JOIN peaks USING (day)
      ORDER BY span.day
    `.execute(db);
    const before = await sql<{ count: string }>`SELECT count(*) FROM users WHERE created_at < ${since}`.execute(db);
    const hours = (value: unknown) => Math.round(n(value) * 100) / 100;
    return {
      accountsBefore: n(before.rows[0]?.count),
      days: result.rows.map((row) => ({
        day: row.day,
        activeAccounts: n(row.active_accounts),
        desktopApp: n(row.desktop_app),
        browser: n(row.browser),
        mobile: n(row.mobile),
        newAccounts: n(row.new_accounts),
        roomMessages: n(row.room_messages),
        directMessages: n(row.direct_messages),
        messageAuthors: n(row.message_authors),
        staticRoomsCreated: n(row.static_rooms),
        temporaryRoomsCreated: n(row.temporary_rooms),
        voiceAccountHours: hours(row.account_hours),
        voiceGuestHours: hours(row.guest_hours),
        voiceJoins: n(row.joins),
        voiceAccounts: n(row.voice_accounts),
        peakOnline: n(row.online),
        peakGuests: n(row.guests),
        peakVoicePeers: n(row.voice_peers),
        peakVoiceRooms: n(row.voice_rooms)
      }))
    };
  }

  /**
   * The accounts of each registration week (newest first, the last `weeks`)
   * and the share that was active again 1–7, 8–14 and 15–30 days after signing up.
   */
  async function retention(weeks: number): Promise<RetentionWeek[]> {
    const result = await sql<RetentionRow>`
      WITH live AS (${liveRetention}),
      weeks AS (
        SELECT week, accounts, week1_pct AS w1, week2_pct AS w2, month1_pct AS m1 FROM retention_weeks
        UNION ALL
        SELECT week, accounts, w1, w2, m1 FROM live WHERE week NOT IN (SELECT week FROM retention_weeks)
      )
      SELECT to_char(week, 'YYYY-MM-DD') AS week, accounts, w1, w2, m1
      FROM weeks ORDER BY week DESC
      LIMIT ${weeks}
    `.execute(db);
    return result.rows.map((row) => ({
      week: row.week,
      accounts: n(row.accounts),
      returnedWeek1Pct: n(row.w1),
      returnedWeek2Pct: n(row.w2),
      returnedMonth1Pct: n(row.m1)
    }));
  }

  async function openReports(): Promise<number> {
    const result = await sql<{ count: string }>`SELECT count(*) FROM content_reports WHERE status = 'open'`.execute(db);
    return n(result.rows[0]?.count);
  }

  /** The Moscow day of the first account, or null without one. */
  async function firstAccountDay(): Promise<string | null> {
    const result = await sql<{ day: string | null }>`
      SELECT to_char(min(${mskDay('created_at')}), 'YYYY-MM-DD') AS day FROM users`.execute(db);
    return result.rows[0]?.day ?? null;
  }

  /**
   * Writes the counts of every Moscow day before `cutoffDay` to product_days
   * and freezes the signup weeks whose first month is over by `today` (both
   * YYYY-MM-DD). Run before the per-person rows of those days go (the activity
   * and voice-session repositories forget them); a day already counted stays as
   * it was. Answers how many days it counted.
   */
  async function rollUp(cutoffDay: string, today: string): Promise<number> {
    const cutoff = sql`${cutoffDay}::date`;
    const cutoffAt = sql`(${cutoff})::timestamp AT TIME ZONE ${MSK}`;
    return db.transaction().execute(async (trx) => {
      await sql`
        INSERT INTO retention_weeks (week, accounts, week1_pct, week2_pct, month1_pct)
        SELECT week, accounts, w1, w2, m1 FROM (${liveRetention}) live
        WHERE week + ${sql.lit(RETENTION_FINAL_DAYS)} <= ${today}::date
        ON CONFLICT (week) DO NOTHING
      `.execute(trx);
      const rolled = await sql`
        WITH activity AS (
          SELECT day, count(*) AS active_accounts,
                 count(*) FILTER (WHERE desktop_app) AS desktop_app,
                 count(*) FILTER (WHERE browser) AS browser,
                 count(*) FILTER (WHERE mobile) AS mobile
          FROM user_activity_days WHERE day < ${cutoff} GROUP BY day
        ),
        voice AS (
          SELECT ${mskDay('joined_at')} AS day,
                 coalesce(sum(extract(epoch FROM left_at - joined_at)) FILTER (WHERE user_id IS NOT NULL), 0) / 3600.0 AS account_hours,
                 coalesce(sum(extract(epoch FROM left_at - joined_at)) FILTER (WHERE user_id IS NULL), 0) / 3600.0 AS guest_hours,
                 count(*) AS joins,
                 count(DISTINCT user_id) AS accounts
          FROM voice_sessions WHERE joined_at < ${cutoffAt} GROUP BY 1
        )
        INSERT INTO product_days (day, active_accounts, desktop_app, browser, mobile,
                                  voice_account_hours, voice_guest_hours, voice_joins, voice_accounts)
        SELECT day, coalesce(a.active_accounts, 0), coalesce(a.desktop_app, 0), coalesce(a.browser, 0),
               coalesce(a.mobile, 0), coalesce(v.account_hours, 0), coalesce(v.guest_hours, 0),
               coalesce(v.joins, 0), coalesce(v.accounts, 0)
        FROM activity a FULL JOIN voice v USING (day)
        ON CONFLICT (day) DO NOTHING
      `.execute(trx);
      return Number(rolled.numAffectedRows ?? 0);
    });
  }

  return Object.freeze({ overview, productDays, retention, rollUp, openReports, firstAccountDay });
}

export type AdminStatsRepository = ReturnType<typeof createAdminStatsRepository>;
