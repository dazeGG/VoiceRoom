// What the admin panel's rooms section reads from the tables: the rooms and
// accounts behind the live presence roster, and the finished stays in voice
// that still carry their room, one by one or gathered into calls. Read only;
// never a message or an address.

import { sql } from 'kysely';
import type pg from 'pg';
import {
  ROOM_CALLS_PAGE_SIZE,
  ROOM_HISTORY_PAGE_SIZE,
  type ClientKind,
  type RoomAccount
} from '@voice-room/shared/contracts/admin';
import { kyselyOn } from '../../platform/db/kysely.ts';
import { toMillis } from '../../platform/epoch-millis.ts';
import { avatarUrl } from '../../lib/avatar-url.ts';

export interface AdminRoomRow {
  id: string;
  name: string;
  isStatic: boolean;
  avatarUrl: string | null;
  owner: RoomAccount | null;
}

export interface StoredStay {
  id: string;
  roomId: string;
  roomName: string | null;
  isStatic: boolean | null;
  account: RoomAccount | null;
  guestName: string | null;
  guestId: string | null;
  client: ClientKind | null;
  os: string | null;
  browser: string | null;
  ipKey: string | null;
  location: string | null;
  joinedAt: number;
  leftAt: number;
}

export interface StoredCall {
  id: string;
  roomId: string;
  roomName: string | null;
  isStatic: boolean | null;
  startedAt: number;
  endedAt: number;
  stays: StoredStay[];
}

/** Where a page of history continues: the end and id of the last stay (or call) already shown. */
export interface HistoryAfter {
  leftAt: number;
  id: string;
}

// The column only ever holds these three (voice_sessions_client_check).
function clientOf(value: string | null): ClientKind | null {
  return value === 'desktop_app' || value === 'mobile' || value === 'browser' ? value : null;
}

type AccountColumns = {
  id: string | null;
  login: string | null;
  display_name: string | null;
  avatar_key: string | null;
  avatar_color_key: string | null;
  avatar_accent: string | null;
};

function account(row: AccountColumns): RoomAccount | null {
  if (!row.id || !row.login) return null;
  return {
    id: row.id,
    login: row.login,
    displayName: row.display_name || row.login,
    avatarUrl: avatarUrl(row.avatar_key),
    avatarColorKey: row.avatar_color_key || 'blurple',
    avatarAccent: row.avatar_accent
  };
}

/** A temporary room has no name, so only a missing or deleted row means the room is gone. */
const roomNameOf = (row: { room_name: string | null; room_deleted_at: Date | string | null }) =>
  row.room_deleted_at === null ? row.room_name : null;

export function createAdminRoomsRepository({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);

  /** The rooms by id, deleted ones too: a room can go while someone is still in its voice. */
  async function rooms(ids: readonly string[]): Promise<AdminRoomRow[]> {
    if (ids.length === 0) return [];
    const rows = await db
      .selectFrom('rooms as r')
      .leftJoin('users as u', 'u.id', 'r.owner_id')
      .select([
        'r.id as room_id',
        'r.name',
        'r.is_static',
        'r.avatar_key as room_avatar_key',
        'u.id',
        'u.login',
        'u.display_name',
        'u.avatar_key',
        'u.avatar_color_key',
        'u.avatar_accent'
      ])
      .where('r.id', 'in', [...ids])
      .execute();
    return rows.map((row) => ({
      id: row.room_id,
      name: row.name,
      isStatic: row.is_static,
      avatarUrl: avatarUrl(row.room_avatar_key),
      owner: account(row)
    }));
  }

  async function accounts(ids: readonly string[]): Promise<RoomAccount[]> {
    if (ids.length === 0) return [];
    const rows = await db
      .selectFrom('users')
      .select(['id', 'login', 'display_name', 'avatar_key', 'avatar_color_key', 'avatar_accent'])
      .where('id', 'in', [...ids])
      .execute();
    return rows.map(account).filter((value): value is RoomAccount => value !== null);
  }

  /** Finished stays that still carry their room, with the room and the account behind each. */
  function stays() {
    return db
      .selectFrom('voice_sessions as s')
      .leftJoin('rooms as r', 'r.id', 's.room_id')
      .leftJoin('users as u', 'u.id', 's.user_id')
      .select([
        's.id as stay_id',
        's.room_id',
        's.joined_at',
        's.left_at',
        's.guest_name',
        's.guest_id',
        's.client',
        's.os',
        's.browser',
        's.ip_key',
        's.location',
        'r.name as room_name',
        'r.deleted_at as room_deleted_at',
        'r.is_static',
        'u.id',
        'u.login',
        'u.display_name',
        'u.avatar_key',
        'u.avatar_color_key',
        'u.avatar_accent'
      ])
      .where('s.room_id', 'is not', null)
      .where('s.room_id', '!=', '');
  }

  type StayRow = Awaited<ReturnType<ReturnType<typeof stays>['execute']>>[number];

  function toStay(row: StayRow): StoredStay {
    return {
      id: row.stay_id,
      roomId: row.room_id ?? '',
      roomName: roomNameOf(row),
      isStatic: row.is_static,
      account: account(row),
      guestName: row.guest_name,
      guestId: row.guest_id,
      client: clientOf(row.client),
      os: row.os,
      browser: row.browser,
      ipKey: row.ip_key,
      location: row.location,
      joinedAt: toMillis(row.joined_at),
      leftAt: toMillis(row.left_at)
    };
  }

  /**
   * Finished stays that still carry their room, the latest end first, a page
   * at a time: `after` is the end and id of the last stay already shown.
   */
  async function history(query: {
    roomId?: string | undefined;
    after?: HistoryAfter | undefined;
  }): Promise<{ stays: StoredStay[]; more: boolean }> {
    let select = stays();
    if (query.roomId) select = select.where('s.room_id', '=', query.roomId);
    const after = query.after;
    if (after) {
      const at = new Date(after.leftAt);
      select = select.where((eb) =>
        eb.or([eb('s.left_at', '<', at), eb.and([eb('s.left_at', '=', at), eb('s.id', '<', after.id)])])
      );
    }
    const rows = await select
      .orderBy('s.left_at', 'desc')
      .orderBy('s.id', 'desc')
      .limit(ROOM_HISTORY_PAGE_SIZE + 1)
      .execute();
    return {
      stays: rows.slice(0, ROOM_HISTORY_PAGE_SIZE).map(toStay),
      more: rows.length > ROOM_HISTORY_PAGE_SIZE
    };
  }

  /**
   * Finished stays gathered into calls, the latest end first, a page at a time.
   * Within a room, taken in the order people joined, a stay starts a new call
   * when it begins after every earlier stay has ended: the voice stood empty in
   * between. A call's id is its first stay's. `from`/`to` keep the calls that
   * overlap the span; `after` is the end and id of the last call already shown.
   */
  async function calls(query: {
    roomId?: string | undefined;
    after?: HistoryAfter | undefined;
    from?: number | undefined;
    to?: number | undefined;
  }): Promise<{ calls: StoredCall[]; more: boolean }> {
    let pageQuery = db
      .with('ordered', (qb) => {
        let base = qb
          .selectFrom('voice_sessions')
          .select([
            'id',
            'room_id',
            'joined_at',
            'left_at',
            sql<Date | null>`max(left_at) over (
              partition by room_id order by joined_at, id
              rows between unbounded preceding and 1 preceding
            )`.as('earlier_end')
          ])
          .where('room_id', 'is not', null)
          .where('room_id', '!=', '');
        if (query.roomId) base = base.where('room_id', '=', query.roomId);
        return base;
      })
      .with('numbered', (qb) =>
        qb.selectFrom('ordered').select([
          'id',
          'room_id',
          'joined_at',
          'left_at',
          sql<string>`sum(case when earlier_end is null or joined_at > earlier_end then 1 else 0 end) over (
              partition by room_id order by joined_at, id
            )`.as('call_no')
        ])
      )
      .with('gathered', (qb) =>
        qb
          .selectFrom('numbered')
          .select([
            'room_id',
            'call_no',
            sql<string>`(array_agg(id order by joined_at, id))[1]`.as('call_id'),
            sql<Date>`min(joined_at)`.as('started_at'),
            sql<Date>`max(left_at)`.as('ended_at')
          ])
          .groupBy(['room_id', 'call_no'])
      )
      .selectFrom('gathered as c')
      .leftJoin('rooms as r', 'r.id', 'c.room_id')
      .select([
        'c.call_id',
        'c.room_id',
        'c.started_at',
        'c.ended_at',
        'r.name as room_name',
        'r.deleted_at as room_deleted_at',
        'r.is_static'
      ]);
    if (query.from !== undefined) pageQuery = pageQuery.where('c.ended_at', '>', new Date(query.from));
    if (query.to !== undefined) pageQuery = pageQuery.where('c.started_at', '<', new Date(query.to));
    const after = query.after;
    if (after) {
      const at = new Date(after.leftAt);
      pageQuery = pageQuery.where((eb) =>
        eb.or([eb('c.ended_at', '<', at), eb.and([eb('c.ended_at', '=', at), eb('c.call_id', '<', after.id)])])
      );
    }
    const rows = await pageQuery
      .orderBy('c.ended_at', 'desc')
      .orderBy('c.call_id', 'desc')
      .limit(ROOM_CALLS_PAGE_SIZE + 1)
      .execute();
    const page = rows.slice(0, ROOM_CALLS_PAGE_SIZE).map((row) => ({
      id: row.call_id,
      roomId: row.room_id ?? '',
      roomName: roomNameOf(row),
      isStatic: row.is_static,
      startedAt: toMillis(row.started_at),
      endedAt: toMillis(row.ended_at)
    }));
    if (page.length === 0) return { calls: [], more: false };

    // A room's calls never overlap, so a call's stays are the room's stays inside its span.
    const members = await stays()
      .where((eb) =>
        eb.or(
          page.map((call) =>
            eb.and([
              eb('s.room_id', '=', call.roomId),
              eb('s.joined_at', '>=', new Date(call.startedAt)),
              eb('s.left_at', '<=', new Date(call.endedAt))
            ])
          )
        )
      )
      .orderBy('s.joined_at')
      .orderBy('s.id')
      .execute();
    const byCall = new Map<string, StoredStay[]>(page.map((call) => [call.id, []]));
    for (const row of members) {
      const stay = toStay(row);
      const call = page.find(
        (candidate) =>
          candidate.roomId === stay.roomId && stay.joinedAt >= candidate.startedAt && stay.leftAt <= candidate.endedAt
      );
      if (call) byCall.get(call.id)?.push(stay);
    }
    return {
      calls: page.map((call) => ({ ...call, stays: byCall.get(call.id) ?? [] })),
      more: rows.length > ROOM_CALLS_PAGE_SIZE
    };
  }

  return Object.freeze({ rooms, accounts, history, calls });
}

export type AdminRoomsRepository = ReturnType<typeof createAdminRoomsRepository>;
