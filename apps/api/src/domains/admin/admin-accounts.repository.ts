// The accounts as the admin panel lists them: who registered when, when they
// were last seen, how much they used the product and how often others
// reported them; and one account in full for its card. Read only; never a
// message text, an address or a location.

import type pg from 'pg';
import { sql, type RawBuilder } from 'kysely';
import {
  ACCOUNT_DAYS,
  ACCOUNTS_FILTERS,
  ACCOUNTS_PAGE_SIZE,
  TROUBLE_BAD_PCT,
  type AccountDay,
  type AccountDetail,
  type AccountDevice,
  type AccountsFilter,
  type AccountsSort,
  type VoiceQuality
} from '@voice-room/shared/contracts/admin';
import type { AccountBadge } from '@voice-room/shared/contracts/users';
import { ACCOUNT_DELETION_GRACE_MS, describeUserAgent } from '@voice-room/shared/account-security';
import { kyselyOn } from '../../platform/db/kysely.ts';
import { epochMillis } from '../../platform/epoch-millis.ts';
import { avatarUrl } from '../../lib/avatar-url.ts';
import { escapeLike } from '../../platform/db/like.ts';
import { QUALITY_COLUMNS, RECENT_STAYS_DAYS, qualityOf } from './admin-rooms.repository.ts';

const MSK = sql.lit('Europe/Moscow');
const TODAY = sql`(now() AT TIME ZONE ${MSK})::date`;

/** An account's numbers before the service adds who is online and who is an administrator. */
export interface StoredAccountRow {
  id: string;
  login: string;
  displayName: string;
  avatarUrl: string | null;
  avatarColorKey: string;
  avatarAccent: string | null;
  createdAt: number;
  lastSeenAt: number;
  activeDays: number;
  clients: { desktopApp: boolean; browser: boolean; mobile: boolean };
  voiceMinutes: number;
  messages: number;
  ownedRooms: number;
  reportsAgainst: number;
  badge: AccountBadge | null;
  voiceQuality30d: VoiceQuality | null;
  blocked: { at: number; until: number | null; reason: string } | null;
  deletion: { scheduledFor: number; byAdmin: boolean } | null;
}

export interface AccountsListQuery {
  q: string;
  filter: AccountsFilter;
  sort: AccountsSort;
  order: 'asc' | 'desc';
  page: number;
  onlineIds: string[];
}

export interface StoredAccountDetail {
  account: StoredAccountRow;
  days: AccountDay[];
  ownedRooms: { id: string; name: string; members: number }[];
  memberOf: number;
  devices: AccountDevice[];
  reports: { against: number; againstOpen: number; filed: number };
  voice30d: Exclude<AccountDetail['voice30d'], undefined>;
  cpu30d: Exclude<AccountDetail['cpu30d'], undefined>;
}

const n = (value: unknown): number => Number(value) || 0;

/** A row of the `accounts` CTE; counts arrive as numbers or as bigint text. */
type AccountSqlRow = {
  id: string;
  login: string;
  display_name: string | null;
  avatar_key: string | null;
  avatar_color_key: string | null;
  avatar_accent: string | null;
  created_at: Date;
  badge: string | null;
  blocked_at: Date | null;
  blocked_until: Date | null;
  block_reason: string | null;
  deletion_requested_at: Date | null;
  deletion_by_admin: boolean;
  active_days: number | string;
  desktop_app: boolean;
  browser: boolean;
  mobile: boolean;
  last_seen: Date | null;
  voice_minutes: number | string;
  messages: number | string;
  owned_rooms: number | string;
  reports_against: number | string;
  voice_good: number | string;
  voice_unstable: number | string;
  voice_bad: number | string;
};

type VoiceSummaryRow = Record<
  | 'good'
  | 'unstable'
  | 'bad'
  | 'minutes'
  | 'rtt_sum'
  | 'rtt_polls'
  | 'jitter_sum'
  | 'jitter_polls'
  | 'uplink_lost'
  | 'uplink_packets'
  | 'udp'
  | 'tcp'
  | 'relay'
  | 'app_sum'
  | 'system_sum'
  | 'cpu_polls'
  | 'cpu_calls'
  | 'critical_calls'
  | 'relieved_calls',
  number | string | null
>;

type DayRow = { day: string; active: boolean; messages: number | string; voice_minutes: number | string };
type ReportCountRow = { against: number | string; against_open: number | string; filed: number | string };

const SORT_COLUMNS: Record<AccountsSort, RawBuilder<unknown>> = {
  created: sql`created_at`,
  lastSeen: sql`last_seen`,
  activeDays: sql`active_days`,
  voice: sql`voice_minutes`,
  messages: sql`messages`,
  reports: sql`reports_against`,
  quality: sql`CASE WHEN voice_good + voice_unstable + voice_bad > 0
    THEN voice_bad::float / (voice_good + voice_unstable + voice_bad) END`,
  name: sql`lower(coalesce(nullif(display_name, ''), login))`
};

// One row per live account with every number the list shows. Each aggregate
// is grouped once over its table, so the cost grows with the tables, not with
// accounts times tables.
function accountsWith(where: RawBuilder<unknown>) {
  return sql`
    WITH activity AS (
      SELECT user_id, count(*) AS active_days, max(day) AS last_day,
        coalesce(bool_or(desktop_app) FILTER (WHERE day > ${TODAY} - 30), false) AS desktop_app,
        coalesce(bool_or(browser) FILTER (WHERE day > ${TODAY} - 30), false) AS browser,
        coalesce(bool_or(mobile) FILTER (WHERE day > ${TODAY} - 30), false) AS mobile
      FROM user_activity_days GROUP BY user_id
    ),
    seen AS (SELECT user_id, max(last_seen_at) AS last_seen FROM sessions GROUP BY user_id),
    voice AS (
      SELECT user_id, sum(extract(epoch FROM left_at - joined_at)) / 60.0 AS minutes
      FROM voice_sessions WHERE user_id IS NOT NULL GROUP BY user_id
    ),
    room_sent AS (
      SELECT author_user_id AS user_id, count(*) AS sent
      FROM room_messages WHERE author_user_id IS NOT NULL GROUP BY author_user_id
    ),
    direct_sent AS (SELECT sender_id AS user_id, count(*) AS sent FROM direct_messages GROUP BY sender_id),
    owned AS (
      SELECT owner_id AS user_id, count(*) AS rooms
      FROM rooms WHERE is_static AND deleted_at IS NULL AND owner_id IS NOT NULL GROUP BY owner_id
    ),
    reported AS (
      SELECT coalesce(m.author_user_id, d.sender_id) AS user_id, count(*) AS reports
      FROM content_reports c
      LEFT JOIN room_messages m ON c.target_kind = 'room_message' AND m.id = c.message_id
      LEFT JOIN direct_messages d ON c.target_kind = 'direct_message' AND d.id = c.message_id
      GROUP BY 1
    ),
    voice_quality AS (
      SELECT s.user_id, ${QUALITY_COLUMNS}
      FROM voice_session_samples m JOIN voice_sessions s ON s.id = m.stay_id
      WHERE s.user_id IS NOT NULL AND s.joined_at > now() - interval '${RECENT_STAYS_DAYS} days'
        AND m.at > now() - interval '30 days'
      GROUP BY s.user_id
    ),
    accounts AS (
      SELECT u.id, u.login, u.display_name, u.avatar_key, u.avatar_color_key, u.avatar_accent, u.created_at,
        u.badge, u.blocked_at, u.blocked_until, u.block_reason, u.deletion_requested_at,
        u.metadata ? 'deletionByAdmin' AS deletion_by_admin,
        a.last_day,
        coalesce(a.active_days, 0) AS active_days,
        coalesce(a.desktop_app, false) AS desktop_app,
        coalesce(a.browser, false) AS browser,
        coalesce(a.mobile, false) AS mobile,
        greatest(u.created_at, s.last_seen, a.last_day::timestamp AT TIME ZONE ${MSK}) AS last_seen,
        coalesce(v.minutes, 0) AS voice_minutes,
        coalesce(rs.sent, 0) + coalesce(ds.sent, 0) AS messages,
        coalesce(o.rooms, 0) AS owned_rooms,
        coalesce(r.reports, 0) AS reports_against,
        coalesce(q.good, 0) AS voice_good,
        coalesce(q.unstable, 0) AS voice_unstable,
        coalesce(q.bad, 0) AS voice_bad
      FROM users u
      LEFT JOIN activity a ON a.user_id = u.id
      LEFT JOIN seen s ON s.user_id = u.id
      LEFT JOIN voice v ON v.user_id = u.id
      LEFT JOIN room_sent rs ON rs.user_id = u.id
      LEFT JOIN direct_sent ds ON ds.user_id = u.id
      LEFT JOIN owned o ON o.user_id = u.id
      LEFT JOIN reported r ON r.user_id = u.id
      LEFT JOIN voice_quality q ON q.user_id = u.id
      WHERE u.deleted_at IS NULL
    )
    SELECT * FROM accounts WHERE ${where}`;
}

const BLOCKED = sql`blocked_at IS NOT NULL AND (blocked_until IS NULL OR blocked_until > now())`;

function filterClause(filter: AccountsFilter, onlineIds: string[]): RawBuilder<unknown> {
  switch (filter) {
    case 'online':
      return onlineIds.length ? sql`id = ANY(${onlineIds}::varchar[])` : sql`false`;
    case 'new':
      return sql`created_at > now() - interval '7 days'`;
    case 'active':
      return sql`last_day > ${TODAY} - 7`;
    case 'gone':
      return sql`last_seen < now() - interval '14 days'`;
    case 'blocked':
      return BLOCKED;
    case 'deleting':
      return sql`deletion_requested_at IS NOT NULL`;
    case 'badged':
      return sql`badge IS NOT NULL`;
    case 'trouble':
      return sql`voice_bad > 0 AND voice_bad * 100 >= ${TROUBLE_BAD_PCT} * (voice_good + voice_unstable + voice_bad)`;
    default:
      return sql`true`;
  }
}

function searchClause(q: string): RawBuilder<unknown> {
  if (!q) return sql`true`;
  const pattern = `%${escapeLike(q)}%`;
  return sql`(login ILIKE ${pattern} OR display_name ILIKE ${pattern} OR id = ${q})`;
}

function mapRow(row: AccountSqlRow, now: number): StoredAccountRow {
  const blockedAt = epochMillis(row.blocked_at);
  const blockedUntil = epochMillis(row.blocked_until);
  const deletionAt = epochMillis(row.deletion_requested_at);
  const badge = row.badge === 'official' || row.badge === 'verified' ? row.badge : null;
  return {
    id: row.id,
    login: row.login,
    displayName: row.display_name ?? '',
    avatarUrl: avatarUrl(row.avatar_key),
    avatarColorKey: row.avatar_color_key ?? 'blurple',
    avatarAccent: row.avatar_accent || null,
    createdAt: epochMillis(row.created_at) ?? 0,
    lastSeenAt: epochMillis(row.last_seen) ?? epochMillis(row.created_at) ?? 0,
    activeDays: n(row.active_days),
    clients: { desktopApp: row.desktop_app, browser: row.browser, mobile: row.mobile },
    voiceMinutes: Math.round(n(row.voice_minutes)),
    messages: n(row.messages),
    ownedRooms: n(row.owned_rooms),
    reportsAgainst: n(row.reports_against),
    badge,
    voiceQuality30d: qualityOf({ good: row.voice_good, unstable: row.voice_unstable, bad: row.voice_bad }),
    blocked:
      blockedAt !== null && (blockedUntil === null || blockedUntil > now)
        ? { at: blockedAt, until: blockedUntil, reason: row.block_reason ?? '' }
        : null,
    deletion:
      deletionAt !== null
        ? { scheduledFor: deletionAt + ACCOUNT_DELETION_GRACE_MS, byAdmin: row.deletion_by_admin }
        : null
  };
}

/** The voice and the computer of one account over the last 30 days; each null without a minute of it. */
function voiceSummary(row: VoiceSummaryRow | undefined): Pick<StoredAccountDetail, 'voice30d' | 'cpu30d'> {
  const quality = row ? qualityOf(row) : null;
  if (!row || !quality) return { voice30d: null, cpu30d: null };
  const average = (sum: unknown, polls: unknown) => (n(polls) > 0 ? Math.round(n(sum) / n(polls)) : null);
  const transports = n(row.udp) + n(row.tcp) + n(row.relay);
  const share = (minutes: unknown) => (transports > 0 ? Math.round((n(minutes) * 100) / transports) : 0);
  return {
    voice30d: {
      minutes: n(row.minutes),
      quality,
      rttAvgMs: average(row.rtt_sum, row.rtt_polls),
      uplinkLossPct:
        n(row.uplink_packets) > 0 ? Math.round((n(row.uplink_lost) / n(row.uplink_packets)) * 1000) / 10 : null,
      jitterBufferAvgMs: average(row.jitter_sum, row.jitter_polls),
      transport: { udp: share(row.udp), tcp: share(row.tcp), relay: share(row.relay) }
    },
    cpu30d:
      n(row.cpu_calls) > 0
        ? {
            appAvgPct: average(row.app_sum, row.cpu_polls),
            systemAvgPct: average(row.system_sum, row.cpu_polls),
            calls: n(row.cpu_calls),
            criticalCalls: n(row.critical_calls),
            relievedCalls: n(row.relieved_calls)
          }
        : null
  };
}

export function createAdminAccountsRepository({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);

  async function list(query: AccountsListQuery, now: number = Date.now()) {
    const where = sql`${filterClause(query.filter, query.onlineIds)} AND ${searchClause(query.q)}`;
    const order = query.order === 'asc' ? sql`ASC` : sql`DESC`;
    const offset = (query.page - 1) * ACCOUNTS_PAGE_SIZE;
    // Every filter's count is over all the accounts: it names how many it holds,
    // whatever the search; `total` is how many this search and filter found.
    const filterCounts = ACCOUNTS_FILTERS.map(
      (filter) => sql`count(*) FILTER (WHERE ${filterClause(filter, query.onlineIds)}) AS ${sql.ref(filter)}`
    );
    const [rows, count, overloaded] = await Promise.all([
      sql<AccountSqlRow>`${accountsWith(where)}
        ORDER BY ${SORT_COLUMNS[query.sort]} ${order} NULLS LAST, id ASC
        LIMIT ${ACCOUNTS_PAGE_SIZE} OFFSET ${offset}`.execute(db),
      sql<Record<string, unknown>>`
        SELECT count(*) FILTER (WHERE ${where}) AS listed_total, ${sql.join(filterCounts)}
        FROM (${accountsWith(sql`true`)}) AS listed`.execute(db),
      sql<{ accounts: unknown }>`
        WITH stays AS (
          SELECT s.user_id, s.id, bool_or(m.cpu_pressure_max = 'critical') AS critical
          FROM voice_session_samples m JOIN voice_sessions s ON s.id = m.stay_id
          WHERE s.user_id IS NOT NULL AND s.joined_at > now() - interval '${RECENT_STAYS_DAYS} days'
            AND m.at > now() - interval '30 days'
            AND (m.cpu_polls > 0 OR m.cpu_pressure_max IS NOT NULL)
          GROUP BY s.user_id, s.id
        ),
        people AS (
          SELECT user_id, count(*) FILTER (WHERE critical) AS critical, count(*) AS stays
          FROM stays GROUP BY user_id
        )
        SELECT count(*) AS accounts FROM people WHERE critical > 0 AND critical * 2 >= stays`.execute(db)
    ]);
    const counted = count.rows[0] ?? {};
    return {
      accounts: rows.rows.map((row) => mapRow(row, now)),
      total: n(counted.listed_total),
      counts: Object.fromEntries(ACCOUNTS_FILTERS.map((filter) => [filter, n(counted[filter])])),
      cpuOverloaded: n(overloaded.rows[0]?.accounts)
    };
  }

  async function detail(userId: string, now: number = Date.now()): Promise<StoredAccountDetail | null> {
    const found = await sql<AccountSqlRow>`${accountsWith(sql`id = ${userId}`)}`.execute(db);
    const row = found.rows[0];
    if (!row) return null;
    const since = sql`${TODAY} - ${sql.lit(ACCOUNT_DAYS - 1)}`;
    const [days, rooms, memberOf, devices, reports, voice] = await Promise.all([
      sql<DayRow>`
        WITH span AS (SELECT generate_series(${since}, ${TODAY}, interval '1 day')::date AS day),
        sent AS (
          SELECT (created_at AT TIME ZONE ${MSK})::date AS day, count(*) AS n FROM room_messages
          WHERE author_user_id = ${userId} AND created_at >= (${since})::timestamp AT TIME ZONE ${MSK} GROUP BY 1
          UNION ALL
          SELECT (created_at AT TIME ZONE ${MSK})::date, count(*) FROM direct_messages
          WHERE sender_id = ${userId} AND created_at >= (${since})::timestamp AT TIME ZONE ${MSK} GROUP BY 1
        ),
        voice AS (
          SELECT (joined_at AT TIME ZONE ${MSK})::date AS day, sum(extract(epoch FROM left_at - joined_at)) / 60.0 AS minutes
          FROM voice_sessions
          WHERE user_id = ${userId} AND joined_at >= (${since})::timestamp AT TIME ZONE ${MSK} GROUP BY 1
        )
        SELECT to_char(span.day, 'YYYY-MM-DD') AS day,
          EXISTS (SELECT 1 FROM user_activity_days a WHERE a.user_id = ${userId} AND a.day = span.day) AS active,
          coalesce((SELECT sum(n) FROM sent WHERE sent.day = span.day), 0) AS messages,
          coalesce((SELECT minutes FROM voice WHERE voice.day = span.day), 0) AS voice_minutes
        FROM span ORDER BY span.day`.execute(db),
      db
        .selectFrom('rooms as r')
        .select([
          'r.id',
          'r.name',
          (eb) =>
            eb
              .selectFrom('room_memberships as m')
              .select((m) => m.fn.countAll<string>().as('members'))
              .whereRef('m.room_id', '=', 'r.id')
              .as('members')
        ])
        .where('r.owner_id', '=', userId)
        .where('r.is_static', '=', true)
        .where('r.deleted_at', 'is', null)
        .orderBy('r.created_at')
        .execute(),
      db
        .selectFrom('room_memberships')
        .select((eb) => eb.fn.countAll<string>().as('rooms'))
        .where('user_id', '=', userId)
        .executeTakeFirst(),
      db
        .selectFrom('sessions')
        .select(['user_agent', 'created_at', 'last_seen_at'])
        .where('user_id', '=', userId)
        .where('expires_at', '>', new Date(now))
        .orderBy('last_seen_at', 'desc')
        .execute(),
      sql<ReportCountRow>`
        SELECT
          count(*) FILTER (WHERE coalesce(m.author_user_id, d.sender_id) = ${userId}) AS against,
          count(*) FILTER (WHERE coalesce(m.author_user_id, d.sender_id) = ${userId} AND c.status = 'open') AS against_open,
          count(*) FILTER (WHERE c.reporter_user_id = ${userId}) AS filed
        FROM content_reports c
        LEFT JOIN room_messages m ON c.target_kind = 'room_message' AND m.id = c.message_id
        LEFT JOIN direct_messages d ON c.target_kind = 'direct_message' AND d.id = c.message_id`.execute(db),
      sql<VoiceSummaryRow>`
        SELECT ${QUALITY_COLUMNS},
          count(*) AS minutes,
          sum(m.rtt_ms_sum) AS rtt_sum, sum(m.rtt_polls) AS rtt_polls,
          sum(m.jitter_buffer_ms_sum) AS jitter_sum, sum(m.jitter_buffer_polls) AS jitter_polls,
          sum(m.uplink_lost) AS uplink_lost, sum(m.uplink_packets) AS uplink_packets,
          count(*) FILTER (WHERE m.transport = 'udp') AS udp,
          count(*) FILTER (WHERE m.transport = 'tcp') AS tcp,
          count(*) FILTER (WHERE m.transport = 'relay') AS relay,
          sum(m.cpu_app_pct_sum) AS app_sum, sum(m.cpu_system_pct_sum) AS system_sum, sum(m.cpu_polls) AS cpu_polls,
          count(DISTINCT m.stay_id) FILTER (WHERE m.cpu_polls > 0 OR m.cpu_pressure_max IS NOT NULL) AS cpu_calls,
          count(DISTINCT m.stay_id) FILTER (WHERE m.cpu_pressure_max = 'critical') AS critical_calls,
          count(DISTINCT m.stay_id) FILTER (WHERE m.cpu_relieved) AS relieved_calls
        FROM voice_session_samples m JOIN voice_sessions s ON s.id = m.stay_id
        WHERE s.user_id = ${userId} AND s.joined_at > now() - interval '${RECENT_STAYS_DAYS} days'
          AND m.at > now() - interval '30 days'`.execute(db)
    ]);
    const counted = reports.rows[0];
    return {
      account: mapRow(row, now),
      days: days.rows.map((day) => ({
        day: day.day,
        active: day.active,
        messages: n(day.messages),
        voiceMinutes: Math.round(n(day.voice_minutes))
      })),
      ownedRooms: rooms.map((room) => ({ id: room.id, name: room.name || '', members: n(room.members) })),
      memberOf: n(memberOf?.rooms),
      devices: devices.map((session) => {
        const device = describeUserAgent(session.user_agent);
        return {
          client: device.client,
          os: device.os,
          createdAt: epochMillis(session.created_at) ?? 0,
          lastSeenAt: epochMillis(session.last_seen_at) ?? 0
        };
      }),
      reports: { against: n(counted?.against), againstOpen: n(counted?.against_open), filed: n(counted?.filed) },
      ...voiceSummary(voice.rows[0])
    };
  }

  return Object.freeze({ list, detail });
}

export type AdminAccountsRepository = ReturnType<typeof createAdminAccountsRepository>;
