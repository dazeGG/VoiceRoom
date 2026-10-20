// What the admin panel's rooms section reads from the tables: the rooms and
// accounts behind the live presence roster, and the finished stays in voice
// that still carry their room. Read only; never a message or an address.

import type pg from 'pg';
import type { ClientKind } from '@voice-room/shared/account-security';
import { ROOM_HISTORY_PAGE_SIZE, type RoomAccount } from '@voice-room/shared/contracts/admin';
import { kyselyOn } from '../../platform/db/kysely.ts';

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

// The column only ever holds these three (voice_sessions_client_check).
function clientOf(value: string | null): ClientKind | null {
  return value === 'desktop_app' || value === 'mobile' || value === 'browser' ? value : null;
}

const avatarUrl = (key: string | null) => (key ? `/api/avatars/${encodeURIComponent(key)}` : null);

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
    avatarColorKey: row.avatar_color_key || 'blue',
    avatarAccent: row.avatar_accent
  };
}

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

  /**
   * Finished stays that still carry their room, the latest end first, a page
   * at a time: `after` is the end and id of the last stay already shown.
   */
  async function history(query: {
    roomId?: string;
    after?: { leftAt: number; id: string };
  }): Promise<{ stays: StoredStay[]; more: boolean }> {
    let select = db
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
      stays: rows.slice(0, ROOM_HISTORY_PAGE_SIZE).map((row) => ({
        id: row.stay_id,
        roomId: row.room_id ?? '',
        // A temporary room has no name, so only a missing or deleted row means the room is gone.
        roomName: row.room_deleted_at === null ? row.room_name : null,
        isStatic: row.is_static,
        account: account(row),
        guestName: row.guest_name,
        guestId: row.guest_id,
        client: clientOf(row.client),
        os: row.os,
        browser: row.browser,
        ipKey: row.ip_key,
        location: row.location,
        joinedAt: new Date(row.joined_at).getTime(),
        leftAt: new Date(row.left_at).getTime()
      })),
      more: rows.length > ROOM_HISTORY_PAGE_SIZE
    };
  }

  return Object.freeze({ rooms, accounts, history });
}

export type AdminRoomsRepository = ReturnType<typeof createAdminRoomsRepository>;
