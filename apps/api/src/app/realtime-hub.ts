// The realtime side of one API app: the socket registry and room runtime
// (built when the app starts), the in-memory presence roster, and the event
// fan-out that domain services call (account events, room broadcasts, link
// previews, delivery relay, room and account lifecycles).

import type { Logger } from 'pino';
import type { FastifyBaseLogger } from 'fastify';
import type { IncomingMessage } from 'node:http';
import { buildRoomMembershipPresenceSnapshot, createConnectionRegistry } from '../realtime/registry.ts';
import type { ConnectionRegistry } from '../realtime/registry.ts';
import type { AccountMessage } from '../realtime/account-events.ts';
import { createWsHandler } from '../realtime/ws-handler.ts';
import { createRoomRealtimeRuntime } from '../realtime/room-runtime.ts';
import type { RoomRealtimeRuntime } from '../realtime/room-runtime.ts';
import { buildServerEnvelope } from '../realtime/envelope.ts';
import { createRoomPresence } from '../realtime/room-presence.ts';
import { createLinkPreviewEvents } from '../domains/link-previews/link-preview-events.ts';
import { createMessageDeliveryRelay } from '../domains/messaging/message-delivery-relay.ts';
import { createMessageProjection } from '../domains/messaging/message-projection.ts';
import { createReplyRepository } from '../domains/messaging/reply.repository.ts';
import { publicChatMessage } from '../domains/messaging/room-chat-views.ts';
import { createNotificationDispatch } from '../domains/notifications/notification-dispatch.ts';
import { createAccountLifecycle } from '../domains/account/account-lifecycle.ts';
import { gatePrincipalForPeer, type GatePrincipalPeer } from '../domains/admission/gate-principal.ts';
import { avatarColorForPeerId } from '../domains/rooms/avatar-color.ts';
import { createRoomLifecycle } from '../domains/rooms/room-lifecycle.ts';
import { publicPeer } from '../domains/rooms/room-views.ts';
import { tokensMatch } from '../platform/crypto/tokens-match.ts';
import type { ResolvedSession } from './context.ts';
import type { readApiConfig } from './config.ts';
import type { LiveKit } from './livekit.ts';
import type { createServiceRegistry } from './service-registry.ts';
import { sessionAvatarColorKey, sessionDisplayName } from './session.ts';

type Timer = ReturnType<typeof globalThis.setTimeout> | number;

export interface RealtimeHubDeps {
  config: ReturnType<typeof readApiConfig>;
  services: ReturnType<typeof createServiceRegistry>;
  liveKit: Pick<LiveKit, 'removeParticipant'>;
  logger(): Logger;
  /** Removes a stored avatar file (the avatars service, built after the hub). */
  removeAvatar(key: string | null | undefined, log: Pick<Logger, 'error'> | undefined): Promise<void>;
}

/** What starting the realtime layer for an app needs from it. */
export interface RealtimeStartOptions {
  logger: Logger | FastifyBaseLogger;
  reconnectLeaseMs: number;
  now: () => number;
  setTimeout(this: void, callback: () => void, ms: number): Timer;
  clearTimeout(this: void, timer: Timer): void;
  resolveSession: (req: IncomingMessage) => Promise<ResolvedSession | null>;
  clientIp: (req: IncomingMessage) => string;
}

export function createRealtimeHub(deps: RealtimeHubDeps) {
  const { config, services } = deps;
  let wsRegistry: ConnectionRegistry | null = null;
  let roomRuntime: RoomRealtimeRuntime | null = null;
  const roomPresence = createRoomPresence({
    store: () => services.getRoomStore(),
    runtime: () => roomRuntime,
    logger: () => deps.logger(),
    occupancyRetry: { baseMs: 1000, maxMs: 30000 },
    roster: { waitMs: config.LIVEKIT_ROSTER_WAIT_MS, pollMs: config.ROSTER_POLL_INTERVAL_MS }
  });
  const presenceRooms = roomPresence.rooms;
  const { attach: attachPresence, broadcast, closePeer, queueOccupancy: queueRoomOccupancyTransition } = roomPresence;
  const messageProjection = createMessageProjection({
    attachments: () => services.getMediaServices()?.attachments ?? null,
    replies: () => {
      const pool = services.getPool();
      return pool ? createReplyRepository({ client: pool }) : null;
    }
  });
  const notificationDispatch = createNotificationDispatch({
    push: () => services.getPushService(),
    preferences: (userId) => services.getNotificationStore().getPreferences(userId),
    notifyUser: (userId, event) => broadcastToUser(userId, event),
    logger: () => deps.logger()
  });
  const linkPreviewEvents = createLinkPreviewEvents({
    previews: () => services.getLinkPreviewService(),
    roomMessage: (roomId, messageId) => services.getMessageService().room.getMessage(roomId, messageId),
    directMessage: (senderId, recipientId, messageId) =>
      services.getMessageService().direct.getMessage(senderId, recipientId, messageId),
    projection: messageProjection,
    publicChatMessage,
    broadcastRoomEdit: (roomId, message) =>
      roomRuntime?.broadcastRoomDetail?.(roomId, buildServerEnvelope('room.chat.edited', { roomId, message })),
    notifyUser: (userId, event) => broadcastToUser(userId, event)
  });
  const messageDeliveryRelay = createMessageDeliveryRelay({
    enabled: config.MESSAGE_DELIVERY_LISTEN_ENABLED,
    pool: () => services.getPool(),
    outbox: () => services.getMessageDeliveryServices()?.outbox ?? null,
    projection: messageProjection,
    broadcastChatMessage: (roomId, message) => roomRuntime?.broadcastChatMessage(roomId, message),
    notifyUser: (userId, event) => broadcastToUser(userId, event),
    findUser: (userId) => services.getUserStore().getUserById(userId),
    broadcastDmNotification: (recipientId, sender, message) =>
      notificationDispatch.broadcastDmNotification(recipientId, sender, message),
    logger: () => deps.logger()
  });
  const roomLifecycle = createRoomLifecycle({
    presence: roomPresence,
    runtime: () => roomRuntime,
    invitations: () => services.invitationStore(),
    notifyUser: (userId, event) => broadcastToUser(userId, event),
    credentials: () => services.getCredentialBoundary(),
    removeParticipant: (roomId, peerId) => deps.liveKit.removeParticipant(roomId, peerId),
    removeAvatar: (key, log) => deps.removeAvatar(key, log),
    displayName: (user) => sessionDisplayName(user),
    logger: () => deps.logger()
  });
  const accountLifecycle = createAccountLifecycle({
    friendIds: (userId) => services.getFriendStore().getFriendIds(userId),
    notifyUser: (userId, event) => broadcastToUser(userId, event),
    sockets: () => wsRegistry,
    seatPrincipal: (roomId, peerId) => {
      const peer = presenceRooms.get(roomId)?.peers.get(peerId);
      return peer ? liveKitGatePrincipalForPeer(roomId, peer) : null;
    },
    revokeSeatCredentials: (input) => services.getRoomStore().revokeLiveKitGateCredentialsForPeer(input),
    leaveVoice: (connection, activeVoice) => roomRuntime?.leaveVoiceRoom(connection, activeVoice),
    removeParticipant: (roomId, peerId) => deps.liveKit.removeParticipant(roomId, peerId),
    sessionRevokedCloseCode: config.SESSION_REVOKED_CLOSE_CODE,
    deletions: () => services.getAccountDeletionRepository(),
    findRoom: (roomId) => services.getRoomStore().getRoom(roomId),
    announceRoomUpdate: (roomId, room) => roomLifecycle.announceRoomUpdate(roomId, room),
    finishRoomDeletion: (roomId, options) => roomLifecycle.finishRoomDeletion(roomId, options),
    removeAvatar: (key) => deps.removeAvatar(key, undefined),
    logger: () => deps.logger()
  });
  const publicLobbyRoom = roomLifecycle.lobbyRoom;
  // Callers pass the request (or `{ log }`) whose logger records a failed broadcast.
  type ProfileArgs = Parameters<typeof accountLifecycle.broadcastProfileToFriends>;
  const broadcastUserProfileToFriends = (user: ProfileArgs[0], request?: { log?: ProfileArgs[1] } | null) =>
    accountLifecycle.broadcastProfileToFriends(user, request?.log);

  function roomMembershipPresenceSnapshot(roomId: string) {
    const room = presenceRooms.get(roomId);
    return buildRoomMembershipPresenceSnapshot(roomId, room, wsRegistry);
  }

  function isUserOnline(userId: string): boolean {
    return Boolean(wsRegistry?.isUserOnline(userId));
  }

  function broadcastToUser(userId: string, message: AccountMessage): number {
    if (!wsRegistry) return 0;
    return wsRegistry.broadcastAccountEvent(userId, message);
  }

  function liveKitGatePrincipalForPeer(roomId: string, peer: GatePrincipalPeer) {
    return gatePrincipalForPeer(services.getRoomStore(), roomId, peer);
  }
  async function getRoom(roomId: string) {
    const room = await services.getRoomStore().getRoom(roomId);
    if (!room) return null;
    room.updatedAt = Date.now();
    return attachPresence(room);
  }

  async function findRoomBan(roomId: string, userId?: string | null, ip?: string | null) {
    if (!roomId) return null;
    const service = services.getActiveBanService();
    if (service) return service.getActiveBan({ roomId, userId: userId || null, ip: ip || '' });
    if (typeof services.getRoomStore().findActiveRoomBan !== 'function') return null;
    return services.getRoomStore().findActiveRoomBan({ roomId, userId: userId || null, ip: ip || '' });
  }

  function getActiveGuestWsCount() {
    if (!wsRegistry?.connections) return 0;
    let count = 0;
    for (const connection of wsRegistry.connections.values()) {
      if (connection.guest) count += 1;
    }
    return count;
  }

  /** Builds the socket registry, the room runtime and the WebSocket handler. */
  function start(options: RealtimeStartOptions) {
    wsRegistry = createConnectionRegistry({
      maxConnectionsPerUser: config.MAX_REALTIME_STREAMS_PER_USER,
      maxGuestConnectionsPerIp: config.MAX_GUEST_STREAMS_PER_IP,
      keepaliveMs: config.KEEPALIVE_MS,
      onPresenceChange: (friendId, userId, online) => {
        broadcastToUser(friendId, { type: 'presence', userId, online });
      },
      getFriendIds: (userId) => services.getFriendStore().getFriendIds(userId),
      onConnectionClose: (connection) => {
        roomRuntime?.cleanupConnection(connection);
      },
      logger: options.logger
    });

    roomRuntime = createRoomRealtimeRuntime({
      presenceRooms,
      wsRegistry,
      getRoomStore: services.getRoomStore,
      getRoom,
      publicPeer,
      publicLobbyRoom,
      publicChatMessage,
      getUserStore: services.getUserStore,
      broadcast,
      closePeer,
      avatarColorForPeerId,
      MAX_ROOM_PEERS: config.MAX_ROOM_PEERS,
      tokensMatch,
      sessionAvatarColorKey,
      queueRoomOccupancyTransition,
      findRoomBan,
      credentialBoundary: services.getCredentialBoundary(),
      removeLiveKitParticipant: deps.liveKit.removeParticipant,
      reconnectLeaseMs: options.reconnectLeaseMs,
      now: options.now,
      setTimeout: options.setTimeout,
      clearTimeout: options.clearTimeout,
      logger: options.logger
    });

    const wsHandler = createWsHandler({
      registry: wsRegistry,
      roomRuntime,
      resolveSessionUser: options.resolveSession,
      getFriendIds: (userId) => services.getFriendStore().getFriendIds(userId),
      isUserOnline,
      // The same relationship rule as sending a direct message.
      canTypeToUser: async (userId, peerId) =>
        (await services.getFriendStore().areFriends(userId, peerId)) &&
        !(await services.getFriendStore().isBlockedBetween(userId, peerId)),
      getClientIp: options.clientIp,
      logger: options.logger
    });
    return { roomRuntime, wsHandler };
  }

  return {
    start,
    registry: () => wsRegistry,
    runtime: () => roomRuntime,
    presence: roomPresence,
    presenceRooms,
    getRoom,
    findRoomBan,
    broadcastToUser,
    isUserOnline,
    roomMembershipPresenceSnapshot,
    liveKitGatePrincipalForPeer,
    activeGuestConnections: getActiveGuestWsCount,
    projection: messageProjection,
    notifications: notificationDispatch,
    linkPreviews: linkPreviewEvents,
    deliveryRelay: messageDeliveryRelay,
    roomLifecycle,
    accountLifecycle,
    broadcastUserProfileToFriends
  };
}

export type RealtimeHub = ReturnType<typeof createRealtimeHub>;
