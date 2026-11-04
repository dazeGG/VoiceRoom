// The admin panel's rooms section: who is in which room's voice right now,
// read from the live presence roster, and the finished stays the database
// still ties to a room, one by one or gathered into calls. Names, accounts and times only; nothing said in a
// room. A non-admin gets null from every read, which the route answers with 403.

import {
  STATIC_ROOMS_PAGE_SIZE,
  VOICE_HISTORY_KEEP_DAYS,
  type LiveRoom,
  type LiveRoomPeer,
  type RoomAccount,
  type RoomCall,
  type RoomCalls,
  type RoomCallsQuery,
  type RoomHistory,
  type RoomHistoryQuery,
  type RoomStay,
  type StaticRooms,
  type StaticRoomsQuery
} from '@voice-room/shared/contracts/admin';
import type { AdminCallFeedbackEntry, RoomCallDetail } from '@voice-room/shared/contracts/feedback';
import type { PresencePeer } from '../rooms/room-views.ts';
import type { DescribeAddress } from '../rooms/voice-session.repository.ts';
import { avatarColorForPeerId } from '../rooms/avatar-color.ts';
import { currentVoice, VOICE_REPORT_STALE_MS } from '../../realtime/voice-track.ts';
import type { StayEvent } from '../rooms/voice-session.repository.ts';
import { FEEDBACK_AFTER_CALL_MS, minuteOfSample, type AdminRoomsRepository } from './admin-rooms.repository.ts';
import { callEvents } from './call-events.ts';
import type { StaffCheck } from '../staff/staff-check.ts';

export interface AdminRoomsServiceDeps {
  staff: StaffCheck;
  /** The live presence roster: every room the API holds, empty ones too. */
  presenceRooms(): Iterable<PresenceRoom>;
  repository(): Pick<
    AdminRoomsRepository,
    'rooms' | 'accounts' | 'history' | 'calls' | 'staysSince' | 'stayEvents' | 'staticRooms'
  >;
  /** The answers about a call: those given in its room over a span, without whose they were. */
  feedbackInRoom?(roomId: string, from: number, until: number): Promise<AdminCallFeedbackEntry[]>;
  now?: () => number;
  /** Where a peer came from without its address: the keyed hash and the city. */
  describeAddress: DescribeAddress;
}

type Payload<T> = Omit<T, 'ok'>;

interface PresenceRoom {
  id: string;
  peers: Map<string, PresencePeer>;
  /** The call clock the room screen counts from (RoomSnapshot.voiceActiveSince). */
  voiceActiveSince?: number | null;
}

/**
 * When the room's current call began: the call clock, which outlives everyone
 * who rejoined since. A peer that joined earlier still wins, so a clock missing
 * or reset never makes the call look younger than its oldest seat.
 */
export function callSince(room: PresenceRoom): number | null {
  const starts = [...room.peers.values()].map((peer) => peer.joinedAt);
  if (room.voiceActiveSince) starts.push(room.voiceActiveSince);
  const known = starts.filter((at): at is number => typeof at === 'number' && at > 0);
  return known.length ? Math.min(...known) : null;
}

// Where a stay came from is for those who may see it; the rest see who and when.
const withoutOrigin = (stay: RoomStay): RoomStay => ({ ...stay, guestId: null, ipKey: null, location: null });

function parseCursor(cursor: string | undefined): { leftAt: number; id: string } | undefined {
  if (!cursor) return undefined;
  const [leftAt, id] = cursor.split('_');
  return { leftAt: Number(leftAt), id: id ?? '' };
}

export function createAdminRoomsService(deps: AdminRoomsServiceDeps) {
  const now = deps.now ?? Date.now;
  const reportsNow = (peer: PresencePeer) => {
    const reportedAt = peer.voice?.reportedAt ?? null;
    return reportedAt !== null && now() - reportedAt <= VOICE_REPORT_STALE_MS;
  };
  const allowed = (userId: string) => deps.staff.can(userId, 'rooms.view');
  const seesOrigin = (userId: string) => deps.staff.can(userId, 'origin.view');

  async function live(userId: string): Promise<Payload<{ rooms: LiveRoom[] }> | null> {
    if (!(await allowed(userId))) return null;
    const origin = await seesOrigin(userId);
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

    // Where each peer came from is worked out only for those who may see it.
    const origins = new Map(
      origin
        ? await Promise.all(
            occupied.flatMap((room) =>
              [...room.peers.values()].map(async (peer) => [peer, await deps.describeAddress(peer.ip ?? '')] as const)
            )
          )
        : []
    );

    const rooms = occupied.map((room): LiveRoom => {
      const peers = [...room.peers.values()]
        .map((peer): LiveRoomPeer => ({
          peerId: peer.id,
          name: peer.name || 'Гость',
          account: (peer.accountUserId && accountById.get(peer.accountUserId)) || null,
          avatarColorKey: peer.avatarColorKey || avatarColorForPeerId(peer.id),
          joinedAt: peer.joinedAt ?? null,
          screen: Boolean(peer.screen),
          camera: Boolean(peer.camera),
          client: peer.client ?? null,
          os: peer.os ?? '',
          browser: peer.browser ?? '',
          guestId: (origin && !peer.accountUserId && peer.guestId) || null,
          ipKey: origins.get(peer)?.ipKey ?? null,
          location: origins.get(peer)?.location || null,
          network: currentVoice(peer)?.level ?? null,
          cause: currentVoice(peer)?.cause ?? null,
          cpuPressure: reportsNow(peer) ? (peer.voice?.cpuPressure ?? null) : null,
          relieved: peer.voice?.relieved ?? false
        }))
        .sort((a, b) => (a.joinedAt ?? Infinity) - (b.joinedAt ?? Infinity));
      const row = roomById.get(room.id);
      return {
        roomId: room.id,
        name: row?.name || room.id,
        isStatic: row?.isStatic ?? false,
        avatarUrl: row?.avatarUrl ?? null,
        owner: row?.owner ?? null,
        since: callSince(room),
        peers
      };
    });
    rooms.sort((a, b) => b.peers.length - a.peers.length || (a.since ?? Infinity) - (b.since ?? Infinity));
    return { rooms };
  }

  async function history(userId: string, query: RoomHistoryQuery): Promise<Payload<RoomHistory> | null> {
    if (!(await allowed(userId))) return null;
    const origin = await seesOrigin(userId);
    const { stays, more } = await deps.repository().history({
      roomId: query.roomId,
      after: parseCursor(query.after)
    });
    const last = stays[stays.length - 1];
    return {
      stays: origin ? stays : stays.map(withoutOrigin),
      next: more && last ? `${last.leftAt}_${last.id}` : null,
      keepDays: VOICE_HISTORY_KEEP_DAYS
    };
  }

  /**
   * The finished calls. A call someone is still in (its room's voice has had
   * people since before it ended) is left to the live rooms; the page goes on
   * from the last call read, shown or not.
   */
  async function calls(userId: string, query: RoomCallsQuery): Promise<Payload<RoomCalls> | null> {
    if (!(await allowed(userId))) return null;
    const [origin, readsFeedback] = await Promise.all([seesOrigin(userId), deps.staff.can(userId, 'stats.view')]);
    const liveSince = new Map<string, number>();
    for (const room of deps.presenceRooms()) {
      const since = room.peers.size > 0 ? callSince(room) : null;
      if (since !== null) liveSince.set(room.id, since);
    }
    const { calls: page, more } = await deps.repository().calls({
      roomId: query.roomId,
      accountId: query.accountId,
      after: parseCursor(query.after),
      from: query.from === undefined ? undefined : Number(query.from),
      to: query.to === undefined ? undefined : Number(query.to)
    });
    const last = page.at(-1);
    const finished = page.filter((call) => {
      const since = liveSince.get(call.roomId);
      return since === undefined || since > call.endedAt;
    });
    const shown = finished.map(({ feedbackUntil: _until, badFeedback, ...call }) =>
      readsFeedback ? { ...call, ...(badFeedback === undefined ? {} : { badFeedback }) } : call
    );
    return {
      calls: origin ? shown : shown.map((call) => ({ ...call, stays: call.stays.map(withoutOrigin) })),
      next: more && last ? `${last.endedAt}_${last.id}` : null,
      keepDays: VOICE_HISTORY_KEEP_DAYS
    };
  }

  /** The persistent rooms with their numbers of the last 30 days. */
  async function staticRooms(userId: string, query: StaticRoomsQuery = {}): Promise<Payload<StaticRooms> | null> {
    if (!(await allowed(userId))) return null;
    const page = Number(query.page) || 1;
    const filter = query.filter ?? 'all';
    const { rooms, total, counts } = await deps.repository().staticRooms({
      q: (query.q ?? '').trim(),
      filter,
      sort: query.sort ?? 'lastCall',
      order: query.order ?? 'desc',
      page,
      liveIds: [...deps.presenceRooms()].filter((room) => room.peers.size > 0).map((room) => room.id)
    });
    return { rooms, total, page, pageSize: STATIC_ROOMS_PAGE_SIZE, counts };
  }

  /** What a call's page shows beyond the call: what went on, and the answers for those who may read them. */
  async function detailOf(
    userId: string,
    call: RoomCall,
    kept: ReadonlyMap<string, readonly StayEvent[]>,
    live: ReadonlySet<string>,
    feedbackUntil: number
  ): Promise<Payload<RoomCallDetail>> {
    const [origin, readsFeedback, rooms] = await Promise.all([
      seesOrigin(userId),
      deps.staff.can(userId, 'stats.view'),
      deps.repository().rooms([call.roomId])
    ]);
    const events = callEvents(
      call.stays.map((stay) => ({
        id: stay.id,
        joinedAt: stay.joinedAt,
        leftAt: live.has(stay.id) ? null : stay.leftAt,
        minutes: stay.minutes ?? [],
        network: stay.network ?? []
      })),
      kept
    );
    const feedback =
      readsFeedback && deps.feedbackInRoom
        ? await deps.feedbackInRoom(call.roomId, call.startedAt, feedbackUntil)
        : undefined;
    const { badFeedback, ...plain } = call;
    const allowedCall: RoomCall = readsFeedback && badFeedback !== undefined ? { ...plain, badFeedback } : plain;
    return {
      call: origin ? allowedCall : { ...allowedCall, stays: allowedCall.stays.map(withoutOrigin) },
      owner: rooms[0]?.owner ?? null,
      events,
      ...(feedback ? { feedback } : {})
    };
  }

  /** A finished call by its first stay's id; undefined when no call goes by it. */
  async function call(userId: string, callId: string): Promise<Payload<RoomCallDetail> | null | undefined> {
    if (!(await allowed(userId))) return null;
    const stored = (await deps.repository().calls({ callId })).calls[0];
    if (!stored) return undefined;
    const { feedbackUntil, ...found } = stored;
    const kept = await deps.repository().stayEvents(found.stays.map((stay) => stay.id));
    return detailOf(userId, found, kept, new Set(), feedbackUntil ?? found.endedAt + FEEDBACK_AFTER_CALL_MS);
  }

  /** The call going on in a room, its ends being now; undefined when nobody is in its voice. */
  async function liveCall(userId: string, roomId: string): Promise<Payload<RoomCallDetail> | null | undefined> {
    if (!(await allowed(userId))) return null;
    const room = [...deps.presenceRooms()].find((candidate) => candidate.id === roomId);
    const since = room && room.peers.size > 0 ? callSince(room) : null;
    if (!room || since === null) return undefined;
    const at = now();
    const peers = [...room.peers.values()];
    const accountIds = peers.flatMap((peer) => (peer.accountUserId ? [peer.accountUserId] : []));
    const [rows, accounts, gone] = await Promise.all([
      deps.repository().rooms([roomId]),
      deps.repository().accounts(accountIds),
      deps.repository().staysSince(roomId, since)
    ]);
    const row = rows[0];
    const accountById = new Map<string, RoomAccount>(accounts.map((account) => [account.id, account]));
    const held = await Promise.all(
      peers.map(async (peer): Promise<RoomStay> => {
        const origin = await deps.describeAddress(peer.ip ?? '');
        return {
          id: peer.id,
          roomId,
          roomName: row?.name ?? null,
          isStatic: row?.isStatic ?? null,
          account: (peer.accountUserId && accountById.get(peer.accountUserId)) || null,
          guestName: peer.accountUserId ? null : peer.name || null,
          guestId: (!peer.accountUserId && peer.guestId) || null,
          client: peer.client ?? null,
          os: peer.os ?? null,
          browser: peer.browser ?? null,
          ipKey: origin.ipKey,
          location: origin.location || null,
          joinedAt: peer.joinedAt ?? since,
          leftAt: at,
          network: [],
          minutes: (peer.voice?.minutes ?? []).map(minuteOfSample)
        };
      })
    );
    const stays = [...gone, ...held].sort((a, b) => a.joinedAt - b.joinedAt);
    const kept = new Map<string, readonly StayEvent[]>(await deps.repository().stayEvents(gone.map((stay) => stay.id)));
    for (const peer of peers) kept.set(peer.id, peer.voice?.events ?? []);
    const liveCallRow: RoomCall = {
      id: `live-${roomId}`,
      roomId,
      roomName: row?.name ?? null,
      isStatic: row?.isStatic ?? null,
      avatarUrl: row?.avatarUrl ?? null,
      startedAt: since,
      endedAt: at,
      stays
    };
    return detailOf(userId, liveCallRow, kept, new Set(peers.map((peer) => peer.id)), at + 1);
  }

  return Object.freeze({ live, history, calls, staticRooms, call, liveCall });
}

export type AdminRoomsService = ReturnType<typeof createAdminRoomsService>;
