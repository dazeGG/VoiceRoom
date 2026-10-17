// The admin panel's rooms section: who is in which room's voice right now,
// read from the live presence roster, and the finished stays the database
// still ties to a room. Names, accounts and times only; nothing said in a
// room. A non-admin gets null from every read, which the route answers with 403.

import {
  VOICE_HISTORY_KEEP_DAYS,
  type LiveRoom,
  type LiveRoomPeer,
  type RoomAccount,
  type RoomHistory,
  type RoomHistoryQuery
} from '@voice-room/shared/contracts/admin';
import type { PresencePeer } from '../rooms/room-views.ts';
import { avatarColorForPeerId } from '../rooms/avatar-color.ts';
import type { AdminRoomsRepository } from './admin-rooms.repository.ts';
import { isPlatformAdmin } from './admin.policy.ts';

export interface AdminRoomsServiceDeps {
  adminUserIds: readonly string[];
  /** The live presence roster: every room the API holds, empty ones too. */
  presenceRooms(): Iterable<{ id: string; peers: Map<string, PresencePeer> }>;
  repository(): Pick<AdminRoomsRepository, 'rooms' | 'accounts' | 'history'>;
}

type Payload<T> = Omit<T, 'ok'>;

function parseCursor(cursor: string | undefined): { leftAt: number; id: string } | undefined {
  if (!cursor) return undefined;
  const [leftAt, id] = cursor.split('_');
  return { leftAt: Number(leftAt), id: id ?? '' };
}

export function createAdminRoomsService(deps: AdminRoomsServiceDeps) {
  const admin = (userId: string) => isPlatformAdmin(deps.adminUserIds, userId);

  async function live(userId: string): Promise<Payload<{ rooms: LiveRoom[] }> | null> {
    if (!admin(userId)) return null;
    const occupied = [...deps.presenceRooms()].filter((room) => room.peers.size > 0);
    const accountIds = new Set<string>();
    for (const room of occupied) {
      for (const peer of room.peers.values()) if (peer.accountUserId) accountIds.add(peer.accountUserId);
    }
    const [rows, accounts] = await Promise.all([
      deps.repository().rooms(occupied.map((room) => room.id)),
      deps.repository().accounts([...accountIds])
    ]);
    const roomById = new Map(rows.map((row) => [row.id, row]));
    const accountById = new Map<string, RoomAccount>(accounts.map((account) => [account.id, account]));

    const rooms = occupied.map((room): LiveRoom => {
      const peers = [...room.peers.values()]
        .map((peer): LiveRoomPeer => ({
          peerId: peer.id,
          name: peer.name || 'Гость',
          account: (peer.accountUserId && accountById.get(peer.accountUserId)) || null,
          avatarColorKey: peer.avatarColorKey || avatarColorForPeerId(peer.id),
          joinedAt: peer.joinedAt ?? null,
          muted: Boolean(peer.muted),
          deafened: Boolean(peer.deafened),
          screen: Boolean(peer.screen)
        }))
        .sort((a, b) => (a.joinedAt ?? Infinity) - (b.joinedAt ?? Infinity));
      const row = roomById.get(room.id);
      const joined = peers.map((peer) => peer.joinedAt).filter((at): at is number => at !== null);
      return {
        roomId: room.id,
        name: row?.name || room.id,
        isStatic: row?.isStatic ?? false,
        avatarUrl: row?.avatarUrl ?? null,
        owner: row?.owner ?? null,
        since: joined.length ? Math.min(...joined) : null,
        peers
      };
    });
    rooms.sort((a, b) => b.peers.length - a.peers.length || (a.since ?? Infinity) - (b.since ?? Infinity));
    return { rooms };
  }

  async function history(userId: string, query: RoomHistoryQuery): Promise<Payload<RoomHistory> | null> {
    if (!admin(userId)) return null;
    const { stays, more } = await deps.repository().history({
      roomId: query.roomId,
      after: parseCursor(query.after)
    });
    const last = stays[stays.length - 1];
    return {
      stays,
      next: more && last ? `${last.leftAt}_${last.id}` : null,
      keepDays: VOICE_HISTORY_KEEP_DAYS
    };
  }

  return Object.freeze({ live, history });
}

export type AdminRoomsService = ReturnType<typeof createAdminRoomsService>;
