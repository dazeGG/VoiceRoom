// Room summaries: the lobby card of a room (name, unread count, who is in the
// call) sent to every account that lists the room, coalesced per room.

import type { LobbyRoom, PublicPeer } from '@voice-room/shared/contracts/rooms';
import { SUMMARY_COALESCE_MS } from '@voice-room/shared/realtime';
import { LOG_EVENTS } from '../lib/log-events.ts';
import type { StoredRoom } from '../domains/rooms/room-views.ts';
import { buildServerEnvelope } from './envelope.ts';
import type { ConnectionRegistry } from './registry.ts';
import { buildRoomRealtimeSummaryFromLobbyRoom, createSummaryCoalescer } from './summary.ts';
import type { Peer, PresenceRoom, RuntimeLogger, RuntimeRoomStore } from './runtime-types.ts';

export interface RoomSummaryDeps {
  presenceRooms: Map<string, PresenceRoom>;
  wsRegistry: Pick<ConnectionRegistry, 'sendToUser'>;
  getRoomStore: () => RuntimeRoomStore;
  publicPeer: (peer: Peer) => PublicPeer;
  publicLobbyRoom: (room: StoredRoom) => LobbyRoom;
  avatarColorForPeerId: (peerId: unknown) => string;
  logger: RuntimeLogger;
}

export function createRoomSummaries(deps: RoomSummaryDeps) {
  const { presenceRooms, wsRegistry, getRoomStore, publicPeer, publicLobbyRoom, avatarColorForPeerId, logger } = deps;
  const recipientCache = new Map<string, { userIds: string[]; at: number }>();

  async function resolveSummaryRecipients(roomId: string): Promise<string[]> {
    const cached = recipientCache.get(roomId);
    if (cached && Date.now() - cached.at < 30000) return cached.userIds;

    const userIds = new Set<string>();
    try {
      const stored = await getRoomStore().listSummaryRecipientUserIds(roomId);
      for (const id of stored) userIds.add(id);
    } catch (error) {
      logger.error(
        { evt: LOG_EVENTS.ROOM_SUMMARY_RECIPIENTS_FAILED, roomId, err: error },
        'failed to resolve room summary recipients'
      );
    }

    const presence = presenceRooms.get(roomId);
    if (presence) {
      for (const peer of presence.peers.values()) {
        if (peer.accountUserId) userIds.add(peer.accountUserId);
      }
    }

    const ids = [...userIds];
    recipientCache.set(roomId, { userIds: ids, at: Date.now() });
    return ids;
  }

  function invalidateRecipientCache(roomId: string | null | undefined): void {
    if (roomId) recipientCache.delete(roomId);
  }

  async function resolveRoomUnreadCount(roomId: string, userId: string, fallback = 0): Promise<number> {
    const getUnreadCount = getRoomStore().getRoomUnreadCount;
    if (typeof getUnreadCount !== 'function') return fallback;
    return getUnreadCount.call(getRoomStore(), roomId, userId);
  }

  async function flushSummary(roomId: string): Promise<void> {
    const dbRoom = await getRoomStore().getRoom(roomId);
    if (!dbRoom) return;
    const presence = presenceRooms.get(roomId);
    const peers = presence ? Array.from(presence.peers.values()).map(publicPeer) : [];
    const recipients = await resolveSummaryRecipients(roomId);
    await Promise.all(recipients.map((userId) => sendRoomSummaryToUser(roomId, userId, dbRoom, peers)));
  }

  async function sendRoomSummaryToUser(
    roomId: string,
    userId: string,
    room: StoredRoom | null = null,
    roomPeers: unknown[] | null = null
  ): Promise<boolean> {
    if (!roomId || !userId) return false;
    const dbRoom = room || (await getRoomStore().getRoom(roomId));
    if (!dbRoom) return false;
    const presence = presenceRooms.get(roomId);
    const peers = roomPeers || (presence ? Array.from(presence.peers.values()).map(publicPeer) : []);
    const unreadCount = await resolveRoomUnreadCount(roomId, userId);
    const summary = buildRoomRealtimeSummaryFromLobbyRoom(
      publicLobbyRoom({ ...dbRoom, unreadCount }),
      peers,
      avatarColorForPeerId
    );
    wsRegistry.sendToUser(userId, buildServerEnvelope('room.summary', { room: summary }));
    return true;
  }

  const summaryCoalescer = createSummaryCoalescer({
    delayMs: SUMMARY_COALESCE_MS,
    flush: (roomId) => {
      void flushSummary(roomId);
    }
  });

  function scheduleSummaryBroadcast(roomId: string): void {
    if (!roomId) return;
    summaryCoalescer.schedule(roomId);
  }

  return {
    schedule: scheduleSummaryBroadcast,
    flush: flushSummary,
    sendToUser: sendRoomSummaryToUser,
    invalidateRecipients: invalidateRecipientCache,
    unreadCount: resolveRoomUnreadCount
  };
}
