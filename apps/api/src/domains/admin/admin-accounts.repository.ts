// The accounts as the admin panel lists them: who registered when, when they
// were last seen, how much they used the product and how often others
// reported them; and one account in full for its card. Read only; never a
// message text, an address or a location.

import type pg from 'pg';
import { sql, type RawBuilder } from 'kysely';
import {
  ACCOUNT_DAYS,
  ACCOUNTS_PAGE_SIZE,
  type AccountDay,
  type AccountDevice,
  type AccountsFilter,
  type AccountsSort
} from '@voice-room/shared/contracts/admin';
import type { AccountBadge } from '@voice-room/shared/contracts/users';
import { ACCOUNT_DELETION_GRACE_MS, describeUserAgent } from '@voice-room/shared/account-security';
import { kyselyOn } from '../../platform/db/kysely.ts';
import { epochMillis } from '../../platform/epoch-millis.ts';

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
}

const n = (value: unknown): number => Number(value) || 0;

const SORT_COLUMNS: Record<AccountsSort, RawBuilder<unknown>> = {
  created: sql`created_at`,
  lastSeen: sql`last_seen`,
  activeDays: sql`active_days`,
  voice: sql`voice_minutes`,
  messages: sql`messages`,
  reports: sql`reports_against`,
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
        coalesce(r.reports, 0) AS reports_against
      FROM users u
      LEFT JOIN activity a ON a.user_id = u.id
      LEFT JOIN seen s ON s.user_id = u.id
      LEFT JOIN voice v ON v.user_id = u.id
      LEFT JOIN room_sent rs ON rs.user_id = u.id
      LEFT JOIN direct_sent ds ON ds.user_id = u.id
      LEFT JOIN owned o ON o.user_id = u.id
      LEFT JOIN reported r ON r.user_id = u.id
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
    default:
      return sql`true`;
  }
}

function searchClause(q: string): RawBuilder<unknown> {
  if (!q) return sql`true`;
  const pattern = `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  return sql`(login ILIKE ${pattern} OR display_name ILIKE ${pattern} OR id = ${q})`;
}

function mapRow(row: Record<string, unknown>, now: number): StoredAccountRow {
  const avatarKey = typeof row.avatar_key === 'string' && row.avatar_key ? row.avatar_key : null;
  const blockedAt = epochMillis(row.blocked_at);
  const blockedUntil = epochMillis(row.blocked_until);
  const deletionAt = epochMillis(row.deletion_requested_at);
  const badge = row.badge === 'official' || row.badge === 'verified' ? row.badge : null;
  return {
    id: String(row.id),
    login: String(row.login),
    displayName: typeof row.display_name === 'string' ? row.display_name : '',
    avatarUrl: avatarKey ? `/api/avatars/${encodeURIComponent(avatarKey)}` : null,
    avatarColorKey: typeof row.avatar_color_key === 'string' ? row.avatar_color_key : 'blurple',
    avatarAccent: typeof row.avatar_accent === 'string' && row.avatar_accent ? row.avatar_accent : null,
    createdAt: epochMillis(row.created_at) ?? 0,
    lastSeenAt: epochMillis(row.last_seen) ?? epochMillis(row.created_at) ?? 0,
    activeDays: n(row.active_days),
    clients: { desktopApp: row.desktop_app === true, browser: row.browser === true, mobile: row.mobile === true },
    voiceMinutes: Math.round(n(row.voice_minutes)),
    messages: n(row.messages),
    ownedRooms: n(row.owned_rooms),
    reportsAgainst: n(row.reports_against),
    badge,
    blocked:
      blockedAt !== null && (blockedUntil === null || blockedUntil > now)
        ? { at: blockedAt, until: blockedUntil, reason: typeof row.block_reason === 'string' ? row.block_reason : '' }
        : null,
    deletion:
      deletionAt !== null
        ? { scheduledFor: deletionAt + ACCOUNT_DELETION_GRACE_MS, byAdmin: row.deletion_by_admin === true }
        : null
  };
}

export function createAdminAccountsRepository({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);

  async function list(query: AccountsListQuery, now: number = Date.now()) {
    const where = sql`${filterClause(query.filter, query.onlineIds)} AND ${searchClause(query.q)}`;
    const order = query.order === 'asc' ? sql`ASC` : sql`DESC`;
    const offset = (query.page - 1) * ACCOUNTS_PAGE_SIZE;
    const [rows, count] = await Promise.all([
      sql<Record<string, unknown>>`${accountsWith(where)}
        ORDER BY ${SORT_COLUMNS[query.sort]} ${order} NULLS LAST, id ASC
        LIMIT ${ACCOUNTS_PAGE_SIZE} OFFSET ${offset}`.execute(db),
      sql<{ total: unknown }>`SELECT count(*) AS total FROM (${accountsWith(where)}) AS listed`.execute(db)
    ]);
    return { accounts: rows.rows.map((row) => mapRow(row, now)), total: n(count.rows[0]?.total) };
  }

  async function detail(userId: string, now: number = Date.now()): Promise<StoredAccountDetail | null> {
    const found = await sql<Record<string, unknown>>`${accountsWith(sql`id = ${userId}`)}`.execute(db);
    const row = found.rows[0];
    if (!row) return null;
    const since = sql`${TODAY} - ${sql.lit(ACCOUNT_DAYS - 1)}`;
    const [days, rooms, memberOf, devices, reports] = await Promise.all([
      sql<Record<string, unknown>>`
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
      sql<Record<string, unknown>>`
        SELECT
          count(*) FILTER (WHERE coalesce(m.author_user_id, d.sender_id) = ${userId}) AS against,
          count(*) FILTER (WHERE coalesce(m.author_user_id, d.sender_id) = ${userId} AND c.status = 'open') AS against_open,
          count(*) FILTER (WHERE c.reporter_user_id = ${userId}) AS filed
        FROM content_reports c
        LEFT JOIN room_messages m ON c.target_kind = 'room_message' AND m.id = c.message_id
        LEFT JOIN direct_messages d ON c.target_kind = 'direct_message' AND d.id = c.message_id`.execute(db)
    ]);
    const counted = reports.rows[0] ?? {};
    return {
      account: mapRow(row, now),
      days: days.rows.map((day) => ({
        day: String(day.day),
        active: day.active === true,
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
      reports: { against: n(counted.against), againstOpen: n(counted.against_open), filed: n(counted.filed) }
    };
  }

  return Object.freeze({ list, detail });
}

export type AdminAccountsRepository = ReturnType<typeof createAdminAccountsRepository>;
