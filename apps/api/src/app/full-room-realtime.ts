import { buildRoomRealtimeSummary } from '@voiceroom/shared/realtime';
import type { UserRepository } from '../domains/account/user.repository.ts';
import { publicChatMessage } from '../domains/messaging/room-chat-views.ts';
import { LOG_EVENTS } from '../lib/log-events.ts';
import { buildServerEnvelope } from '../realtime/envelope.ts';
import { createMediaMinute } from '../realtime/media-minute.ts';
import type { WsConnection } from '../realtime/registry.ts';
import { createRoomFanout } from '../realtime/room-fanout.ts';
import { roomMediaLimits, type RoomRealtimeRuntime, type RoomRuntimeDeps } from '../realtime/room-runtime.ts';
import { createRoomSummaries, type RoomSummaryDeps } from '../realtime/room-summaries.ts';
import type { RuntimeRoomStore } from '../realtime/runtime-types.ts';
import { noteStayEvent } from '../realtime/voice-track.ts';

export function createFullRoomRealtime(
  deps: Omit<RoomSummaryDeps, 'wsRegistry'> & {
    wsRegistry: RoomRuntimeDeps['wsRegistry'];
    limits: Parameters<typeof roomMediaLimits>[0];
    getUserStore?: (() => Pick<UserRepository, 'getUserById'>) | undefined;
    now: () => number;
  }
) {
  const { getRoomStore, presenceRooms, wsRegistry, now, logger } = deps;
  const summaries = createRoomSummaries(deps);
  const fanout = createRoomFanout({ ...deps, publicChatMessage, scheduleSummary: summaries.schedule });
  const mediaMinute = createMediaMinute({
    rooms: () => presenceRooms.values(),
    limits: roomMediaLimits(deps.limits),
    now
  });

  // Send even empty rooms so the lobby can discard its old roster on reconnect.
  async function sendAccountSummaries(connection: WsConnection, userId: string): Promise<void> {
    if (!userId) return;
    let rooms: Awaited<ReturnType<RuntimeRoomStore['listVisibleRoomsForUser']>>;
    try {
      rooms = await getRoomStore().listVisibleRoomsForUser(userId);
    } catch (error) {
      logger.error(
        { evt: LOG_EVENTS.WS_SUMMARY_LOAD_FAILED, userId, err: error },
        'failed to list rooms for the ws ready summaries'
      );
      return;
    }
    for (const room of rooms) {
      if (room.kind === 'call') continue;
      const presence = presenceRooms.get(room.id);
      const peers = presence ? Array.from(presence.peers.values()).map(deps.publicPeer) : [];
      const unreadCount = Number.isFinite(room.unreadCount)
        ? room.unreadCount
        : await summaries.unreadCount(room.id, userId);
      const summary = buildRoomRealtimeSummary(
        deps.publicLobbyRoom({ ...room, unreadCount }),
        peers,
        deps.avatarColorForPeerId
      );
      wsRegistry.sendToConnection(connection, buildServerEnvelope('room.summary', { room: summary }));
    }
  }

  return {
    callEffects: {
      summaries,
      mediaMinute,
      stayEvent: noteStayEvent,
      readHistory: async (room: Parameters<RoomRuntimeDeps['publicLobbyRoom']>[0]) =>
        (await getRoomStore().listMessages(room.id, { limit: 100 })).map(publicChatMessage)
    },
    handlers: {
      ...fanout,
      invalidateRecipientCache: summaries.invalidateRecipients,
      scheduleSummaryBroadcast: summaries.schedule,
      sendRoomSummaryToUser: summaries.sendToUser,
      sendAccountSummaries,
      takeMediaMinute: mediaMinute.take
    }
  };
}

export type FullRoomRealtimeRuntime = RoomRealtimeRuntime & ReturnType<typeof createFullRoomRealtime>['handlers'];
