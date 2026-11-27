// The realtime side of one API app: the socket registry, the room runtime
// (built when the app starts), the in-memory presence roster, and the event
// fan-out that domain services call (account events, room broadcasts, link
// previews, delivery relay, room and account lifecycles).

import type { FastifyBaseLogger } from 'fastify';
import type { IncomingMessage } from 'node:http';
import type { AccountMessage } from '../realtime/account-events.ts';
import { createWsHandler } from '../realtime/ws-handler.ts';
import { buildServerEnvelope } from '../realtime/envelope.ts';
import { createLinkPreviewEvents } from '../domains/link-previews/link-preview-events.ts';
import { createMessageDeliveryRelay } from '../domains/messaging/message-delivery-relay.ts';
import { createMessageProjection } from '../domains/messaging/message-projection.ts';
import { createReplyRepository } from '../domains/messaging/reply.repository.ts';
import { publicChatMessage } from '../domains/messaging/room-chat-views.ts';
import { createNotificationDispatch } from '../domains/notifications/notification-dispatch.ts';
import { createAccountLifecycle } from '../domains/account/account-lifecycle.ts';
import { gatePrincipalForPeer, type GatePrincipalPeer } from '../domains/admission/gate-principal.ts';
import type { ActiveBanRecord } from '../domains/moderation/active-ban.repository.ts';
import type { NativeVoiceService } from '../domains/admission/native-voice.service.ts';
import { avatarColorForPeerId } from '../domains/rooms/avatar-color.ts';
import { createRoomLifecycle } from '../domains/rooms/room-lifecycle.ts';
import { publicPeer } from '../domains/rooms/room-views.ts';
import type { ResolvedSession } from './context.ts';
import type { readApiConfig } from './config.ts';
import type { LiveKit } from './livekit.ts';
import type { createServiceRegistry } from './service-registry.ts';
import { createVoiceStays } from '../realtime/voice-stays.ts';
import { createCallRealtime, type CallRealtimeStartOptions } from './call-realtime.ts';
import { createFullRoomRealtime, type FullRoomRealtimeRuntime } from './full-room-realtime.ts';
import { sessionAvatarColorKey, sessionDisplayName } from './session.ts';

export interface RealtimeHubDeps {
  config: ReturnType<typeof readApiConfig>;
  services: ReturnType<typeof createServiceRegistry>;
  liveKit: Pick<LiveKit, 'removeParticipant' | 'removeCallParticipant'>;
  logger(this: void): FastifyBaseLogger;
  onVoiceRosterChange?(): void;
  onCallVoiceChange?(roomId: string, userId: string, departed: boolean): void;
  /** Removes a stored avatar file (the avatars service, built after the hub). */
  removeAvatar(key: string | null | undefined, log: Pick<FastifyBaseLogger, 'error'> | undefined): Promise<void>;
}

/** What starting the realtime layer for an app needs from it. */
interface RealtimeStartOptions extends CallRealtimeStartOptions {
  resolveSession: (req: IncomingMessage) => Promise<ResolvedSession | null>;
  clientIp: (req: IncomingMessage) => string;
  widgetCanAdmit?: () => Promise<boolean>;
  widgetLocalAllowed?: () => boolean;
  nativeVoice?: NativeVoiceService;
  joinCallVoice?: Parameters<typeof createWsHandler>[0]['joinCallVoice'];
}

export function createRealtimeHub(deps: RealtimeHubDeps) {
  const { config, services } = deps;
  // The room runtime takes the clock and timers of the app it starts with.
  let roomRuntime: FullRoomRealtimeRuntime | null = null;
  /** The room runtime; the app starts it before it serves anything that reaches here. */
  function runtime(): FullRoomRealtimeRuntime {
    if (!roomRuntime) throw new Error('The realtime room runtime starts with the app');
    return roomRuntime;
  }
  const call = createCallRealtime({
    config,
    getRoomStore: services.getRoomStore,
    getCredentialBoundary: services.getCredentialBoundary,
    liveKit: deps.liveKit,
    logger: deps.logger,
    findRoomBan,
    onCallDeparture: (roomId, userId) => deps.onCallVoiceChange?.(roomId, userId, true),
    accountPresence: {
      onPresenceChange: (friendId, userId, online) => {
        broadcastToUser(friendId, { type: 'presence', userId, online });
      },
      getFriendIds: (userId) => services.getFriendStore().getFriendIds(userId)
    },
    presenceEffects: {
      previewSubscribers: (roomId) => wsRegistry.roomDetailSubscribers(roomId),
      onRosterChange: (roomId) => {
        roomRuntime?.scheduleSummaryBroadcast(roomId);
        deps.onVoiceRosterChange?.();
      },
      onPeerLeft: (room, peer) => voiceStays.recordPeerLeft(room, peer)
    }
  });
  const { getRoom, registry: wsRegistry, presence: roomPresence, presenceRooms } = call;
  const queueRoomOccupancyTransition = roomPresence.queueOccupancy;
  const voiceStays = createVoiceStays({
    rooms: () => presenceRooms.values(),
    sessions: services.getVoiceSessionRepository,
    logger: deps.logger
  });
  const messageProjection = createMessageProjection({
    attachments: () => services.getMediaServices()?.attachments ?? null,
    replies: () => {
      const pool = services.getPool();
      return pool ? createReplyRepository({ client: pool }) : null;
    }
  });
  const notificationDispatch = createNotificationDispatch({
    push: () => services.getPushDelivery(),
    preferences: (userId) => services.getNotificationPreferences().getPreferences(userId),
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
      runtime().broadcastRoomDetail(roomId, buildServerEnvelope('room.chat.edited', { roomId, message })),
    notifyUser: (userId, event) => broadcastToUser(userId, event)
  });
  const messageDeliveryRelay = createMessageDeliveryRelay({
    enabled: config.MESSAGE_DELIVERY_LISTEN_ENABLED,
    pool: () => services.getPool(),
    outbox: () => services.getMessageDeliveryServices()?.outbox ?? null,
    projection: messageProjection,
    broadcastChatMessage: (roomId, message) => runtime().broadcastChatMessage(roomId, message),
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
    leaveVoice: (connection, activeVoice) => runtime().leaveVoiceRoom(connection, activeVoice),
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
    return wsRegistry.presenceSnapshot(roomId, presenceRooms.get(roomId));
  }

  function isUserOnline(userId: string): boolean {
    return wsRegistry.isUserOnline(userId);
  }

  let wsHandler: ReturnType<typeof createWsHandler> | undefined;
  function invalidateTyping(userId: string, peerId?: string) {
    wsHandler?.invalidateTyping(userId, peerId);
  }

  function broadcastToUser(userId: string, message: AccountMessage): number {
    if (message.type === 'account.privacy.updated') invalidateTyping(userId);
    if (message.type === 'friend-accepted' || message.type === 'friend-removed')
      invalidateTyping(userId, message.userId);
    return wsRegistry.broadcastAccountEvent(userId, message);
  }

  function liveKitGatePrincipalForPeer(roomId: string, peer: GatePrincipalPeer) {
    return gatePrincipalForPeer(services.getRoomStore(), roomId, peer);
  }
  // The ban service needs the database; without one, a store that knows bans answers.
  async function findRoomBan(
    roomId: string,
    userId?: string | null,
    ip?: string | null
  ): Promise<ActiveBanRecord | null> {
    if (!roomId) return null;
    const service = services.getActiveBanService();
    if (service) return service.getActiveBan({ roomId, userId: userId || null, ip: ip || '' });
    return services.getRoomStore().findActiveRoomBan({ roomId, userId: userId || null, ip: ip || '' });
  }

  /** Builds the room runtime and the WebSocket handler. */
  function start(options: RealtimeStartOptions) {
    const product = createFullRoomRealtime({
      presenceRooms,
      wsRegistry,
      getRoomStore: services.getRoomStore,
      getUserStore: services.getUserStore,
      publicPeer,
      publicLobbyRoom,
      avatarColorForPeerId,
      limits: config,
      now: options.now,
      logger: options.logger
    });
    const startedRuntime = {
      ...call.start(
        options,
        {
          ...product.callEffects,
          sessionAvatarColorKey,
          ...(options.nativeVoice && { nativeVoice: options.nativeVoice })
        },
        (roomId, userId) => deps.onCallVoiceChange?.(roomId, userId, false)
      ),
      ...product.handlers
    };
    roomRuntime = startedRuntime;

    wsHandler = createWsHandler({
      registry: wsRegistry,
      roomRuntime: startedRuntime,
      joinCallVoice: options.joinCallVoice,
      getBoundary: getRoom,
      resolveSessionUser: options.resolveSession,
      getFriendIds: (userId) => services.getFriendStore().getFriendIds(userId),
      isUserOnline,
      // The same relationship rule as sending a direct message.
      canTypeToUser: services.contact.typing,
      getClientIp: options.clientIp,
      logger: options.logger
    });
    const widgetWsHandler = call.guestHandler('widget', {
      widgetAdmissionEnabled: options.widgetCanAdmit ?? (async () => false),
      widgetLocalAllowed: options.widgetLocalAllowed ?? (() => false),
      clientIp: options.clientIp,
      logger: options.logger
    });
    return { roomRuntime: startedRuntime, wsHandler, widgetWsHandler };
  }

  function invalidateWidgetConnections(): void {
    for (const connection of wsRegistry.allConnections())
      if (connection.roomSurface === 'widget') {
        connection.widgetQuiesced = true;
        connection.pendingVoiceJoin = null;
        connection.socket.close(1008, 'Widget admission disabled');
      }
  }
  async function reconcileWidgetAdmission(force = false): Promise<boolean> {
    const connections = [...wsRegistry.allConnections()].filter((connection) => connection.roomSurface === 'widget');
    const widgetRooms = [...presenceRooms.values()].filter((room) => room.kind === 'widget');
    if (connections.length === 0 && !widgetRooms.some((room) => room.peers.size > 0)) return true;
    if (!force && config.WIDGET_ENABLED && (await services.getRoomStore().isWidgetAdmissionEnabled())) return false;
    for (const connection of connections) {
      connection.widgetQuiesced = true;
      connection.pendingVoiceJoin = null;
      connection.socket.close(1008, 'Widget admission disabled');
    }
    for (const room of widgetRooms) {
      await roomRuntime?.cancelRoomReconnectLeases({ roomId: room.id, reason: 'left' });
      if (room.peers.size > 0) throw new Error('widget_peer_cleanup_incomplete');
      await queueRoomOccupancyTransition(room.id);
    }
    return true;
  }

  return {
    reconcileWidgetAdmission,
    invalidateWidgetConnections,
    start,
    registry: wsRegistry,
    runtime,
    presence: roomPresence,
    callSeatCleanup: call.seatCleanup,
    recordOpenSessions: voiceStays.recordOpenSessions,
    resetPresence: () => {
      roomPresence.reset();
      voiceStays.reset();
    },
    presenceRooms,
    getRoom,
    findRoomBan,
    broadcastToUser,
    invalidateTyping,
    isUserOnline,
    roomMembershipPresenceSnapshot,
    liveKitGatePrincipalForPeer,
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
