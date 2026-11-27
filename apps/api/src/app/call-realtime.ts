import type { FastifyBaseLogger } from 'fastify';
import type { IncomingMessage } from 'node:http';
import type { RoomSurface } from '../domains/rooms/room-surface.policy.ts';
import { avatarColorForPeerId } from '../domains/rooms/avatar-color.ts';
import { publicLobbyRoom, publicPeer } from '../domains/rooms/room-views.ts';
import { tokensMatch } from '../platform/crypto/tokens-match.ts';
import type { Timer } from '../platform/types.ts';
import type { MeetChat } from '../realtime/meet-chat.ts';
import { createCallSeatCleanup } from '../realtime/call-seat-cleanup.ts';
import { createConnectionRegistry } from '../realtime/registry.ts';
import { createRoomPresence, type OccupancyStore, type RoomPresenceDeps } from '../realtime/room-presence.ts';
import {
  createRoomRealtimeRuntime,
  type RoomRealtimeRuntime,
  type RoomRuntimeDeps,
  type RuntimeCredentialBoundary
} from '../realtime/room-runtime.ts';
import type { CallRoomStore } from '../realtime/runtime-types.ts';
import { createWsHandler } from '../realtime/ws-handler.ts';
import type { readApiConfig } from './config.ts';
import type { LiveKit } from './livekit.ts';

export interface CallRealtimeStartOptions {
  logger: FastifyBaseLogger;
  reconnectLeaseMs: number;
  now: () => number;
  setTimeout(this: void, callback: () => void, ms: number): Timer;
  clearTimeout(this: void, timer: Timer): void;
}

type CallConfig = Pick<
  ReturnType<typeof readApiConfig>,
  | 'KEEPALIVE_MS'
  | 'LIVEKIT_ROSTER_WAIT_MS'
  | 'MAX_GUEST_STREAMS_PER_IP'
  | 'MAX_REALTIME_STREAMS_PER_USER'
  | 'MAX_ROOM_PEERS'
  | 'MAX_ROOM_SCREENS'
  | 'MAX_VOICE_PEERS'
  | 'MEDIA_BUDGET_MBPS'
  | 'MEDIA_BUDGET_VOICE_PEERS'
  | 'ROSTER_POLL_INTERVAL_MS'
>;

export function createCallRealtime(deps: {
  config: CallConfig;
  getRoomStore(this: void): CallRoomStore & OccupancyStore;
  getCredentialBoundary(): RuntimeCredentialBoundary | null;
  liveKit: Pick<LiveKit, 'removeParticipant' | 'removeCallParticipant'>;
  logger(this: void): FastifyBaseLogger;
  findRoomBan?: RoomRuntimeDeps['findRoomBan'];
  maxGuestConnections?: number;
  onCallDeparture?(roomId: string, userId: string): void;
  accountPresence?: Pick<Parameters<typeof createConnectionRegistry>[0], 'getFriendIds' | 'onPresenceChange'>;
  presenceEffects?: Pick<RoomPresenceDeps, 'previewSubscribers' | 'onPeerLeft' | 'onRosterChange'>;
}) {
  const { config, getRoomStore } = deps;
  let roomRuntime: RoomRealtimeRuntime | null = null;
  const seatCleanup = createCallSeatCleanup({
    revoke: (roomId, userId, peerId) => runtime().revokeCallSeat(roomId, userId, peerId),
    remove: deps.liveKit.removeCallParticipant,
    reportFailure: () => deps.logger().warn('call seat cleanup failed')
  });

  const registry = createConnectionRegistry({
    ...deps.accountPresence,
    maxConnectionsPerUser: config.MAX_REALTIME_STREAMS_PER_USER,
    maxGuestConnectionsPerIp: deps.maxGuestConnections ?? config.MAX_GUEST_STREAMS_PER_IP,
    keepaliveMs: config.KEEPALIVE_MS,
    onConnectionClose: (connection) => roomRuntime?.cleanupConnection(connection),
    logger: { error: (fields, message) => deps.logger().error(fields, message) }
  });
  const presence = createRoomPresence({
    ...deps.presenceEffects,
    onPeerLeft(room, peer) {
      if (room.kind !== 'call') {
        deps.presenceEffects?.onPeerLeft?.(room, peer);
      } else if (peer.accountUserId && !seatCleanup.has(room.id, peer.id)) {
        seatCleanup.schedule(room.id, peer.accountUserId, peer.id, true);
        deps.onCallDeparture?.(room.id, peer.accountUserId);
      }
    },
    store: getRoomStore,
    sockets: registry,
    logger: deps.logger,
    occupancyRetry: { baseMs: 1000, maxMs: 30000 },
    roster: { waitMs: config.LIVEKIT_ROSTER_WAIT_MS, pollMs: config.ROSTER_POLL_INTERVAL_MS }
  });

  async function getRoom(roomId: string) {
    const room = await getRoomStore().getRoom(roomId);
    return room && presence.attach(Object.assign(room, { updatedAt: Date.now() }));
  }

  function start(
    options: CallRealtimeStartOptions,
    effects?: Pick<
      RoomRuntimeDeps,
      'summaries' | 'readHistory' | 'mediaMinute' | 'stayEvent' | 'sessionAvatarColorKey' | 'nativeVoice'
    >,
    callReconnecting?: (roomId: string, userId: string) => void
  ): RoomRealtimeRuntime {
    roomRuntime = createRoomRealtimeRuntime(
      {
        ...effects,
        presenceRooms: presence.rooms,
        wsRegistry: registry,
        getRoomStore,
        getRoom,
        publicPeer,
        publicLobbyRoom: (room) => publicLobbyRoom(room, presence.rooms.get(room.id)?.peers.size ?? 0),
        publishRoomEvent: presence.publish,
        closePeer: presence.closePeer,
        avatarColorForPeerId,
        MAX_ROOM_PEERS: config.MAX_ROOM_PEERS,
        MAX_VOICE_PEERS: config.MAX_VOICE_PEERS,
        MEDIA_BUDGET_MBPS: config.MEDIA_BUDGET_MBPS,
        MEDIA_BUDGET_VOICE_PEERS: config.MEDIA_BUDGET_VOICE_PEERS,
        MAX_ROOM_SCREENS: config.MAX_ROOM_SCREENS,
        tokensMatch,
        queueRoomOccupancyTransition: presence.queueOccupancy,
        findRoomBan: deps.findRoomBan ?? (async () => null),
        credentialBoundary: deps.getCredentialBoundary(),
        removeLiveKitParticipant: deps.liveKit.removeParticipant,
        logger: options.logger,
        reconnectLeaseMs: options.reconnectLeaseMs,
        now: options.now,
        setTimeout: options.setTimeout,
        clearTimeout: options.clearTimeout
      },
      {
        reconnecting: (roomId, userId) => callReconnecting?.(roomId, userId),
        scheduleRemoval: (roomId, userId, peerId, liveSeat) => seatCleanup.schedule(roomId, userId, peerId, liveSeat)
      }
    );
    return roomRuntime;
  }

  function runtime(): RoomRealtimeRuntime {
    if (!roomRuntime) throw new Error('The realtime room runtime starts with the app');
    return roomRuntime;
  }

  function guestHandler(
    surface: Exclude<RoomSurface, 'main'>,
    {
      logger,
      clientIp,
      meetChat,
      widgetAdmissionEnabled,
      widgetLocalAllowed
    }: {
      logger: FastifyBaseLogger;
      clientIp?: (req: IncomingMessage) => string;
      meetChat?: MeetChat;
      widgetAdmissionEnabled?: () => Promise<boolean>;
      widgetLocalAllowed?: () => boolean;
    }
  ) {
    return createWsHandler({
      registry,
      roomRuntime: runtime(),
      surface,
      getBoundary: (roomId) => getRoomStore().getRoom(roomId),
      getClientIp: clientIp,
      ...(meetChat && { meetChat }),
      ...(widgetAdmissionEnabled && { widgetAdmissionEnabled }),
      ...(widgetLocalAllowed && { widgetLocalAllowed }),
      logger
    });
  }

  return { registry, presence, presenceRooms: presence.rooms, getRoom, runtime, start, guestHandler, seatCleanup };
}
