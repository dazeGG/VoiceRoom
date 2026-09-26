// The API's application services, wired to the stores (the service
// registry), the realtime hub and LiveKit: rooms, peer moderation, room chat,
// accounts, friends, direct messages, notification settings, avatars and the
// desktop release feed.

import type { Logger } from 'pino';
import type { RoomPeerMessage } from '../realtime/legacy-events.ts';
import { buildServerEnvelope } from '../realtime/envelope.ts';
import { mentionUserIdsFromContent } from '@voice-room/shared/mentions';
import { LOG_EVENTS } from '../lib/log-events.ts';
import { createAccountService } from '../domains/account/account.service.ts';
import { createSessionCookies } from '../domains/account/session-cookie.ts';
import type { createAdmissionService } from '../domains/admission/admission.service.ts';
import { createAvatarsService } from '../domains/media/avatars.service.ts';
import { createContentRepository } from '../domains/messaging/content.repository.ts';
import { createDirectMessagesService } from '../domains/messaging/direct-messages.service.ts';
import { createReplyRepository } from '../domains/messaging/reply.repository.ts';
import { createRoomChatService } from '../domains/messaging/room-chat.service.ts';
import { createNotificationSettingsService } from '../domains/notifications/notification-settings.service.ts';
import { createDesktopReleaseService } from '../domains/ops/desktop-release.service.ts';
import { createPeerEviction } from '../domains/rooms/peer-eviction.ts';
import { createPeerModerationService } from '../domains/rooms/peer-moderation.service.ts';
import { publicPeer } from '../domains/rooms/room-views.ts';
import { createRoomsService } from '../domains/rooms/rooms.service.ts';
import { createFriendsService } from '../domains/social/friends.service.ts';
import type { readApiConfig } from './config.ts';
import type { LiveKit } from './livekit.ts';
import type { RateLimits } from './rate-limits.ts';
import type { RealtimeHub } from './realtime-hub.ts';
import type { createServiceRegistry } from './service-registry.ts';
import { sessionAvatarColorKey, sessionChatPeerId, sessionDisplayName } from './session.ts';

export interface DomainServiceDeps {
  config: ReturnType<typeof readApiConfig>;
  env: NodeJS.ProcessEnv;
  services: ReturnType<typeof createServiceRegistry>;
  hub: RealtimeHub;
  liveKit: LiveKit;
  limits: RateLimits;
  featureEnabled: (name: string) => boolean;
  logger: () => Logger;
  /** The admission service, built with the app (it needs the roster wait). */
  admission: () => ReturnType<typeof createAdmissionService> | null;
}

export function createDomainServices(deps: DomainServiceDeps) {
  const { config, services, hub, liveKit, limits } = deps;

  async function refreshPinsAfterMessageMutation(roomId: string, action: string, messageId: string): Promise<void> {
    const service = services.getPinServices()?.service;
    if (!service?.refresh) return;
    try {
      await service.refresh({ roomId, action, messageId });
    } catch (error) {
      // The message mutation is already committed. Preserve its success while
      // retaining evidence; clients will reconcile the derived pin list on load.
      deps
        .logger()
        .error(
          { evt: LOG_EVENTS.MESSAGE_PIN_REFRESH_FAILED, roomId, messageId, err: error },
          'failed to refresh room pins after a message mutation'
        );
    }
  }

  const roomsService = createRoomsService({
    store: services.getRoomStore,
    getRoom: hub.getRoom,
    limits: {
      maxRooms: config.MAX_ROOMS,
      maxOwnedStaticRoomsPerUser: config.MAX_STATIC_ROOMS_PER_USER,
      maxTempRoomsPerIp: config.MAX_TEMP_ROOMS_PER_IP
    },
    announceRoomUpdate: (roomId, room) => hub.roomLifecycle.announceRoomUpdate(roomId, room),
    finishRoomDeletion: (roomId, options) => hub.roomLifecycle.finishRoomDeletion(roomId, options)
  });
  const peerEviction = createPeerEviction({
    store: services.getRoomStore,
    runtime: () => hub.runtime(),
    notifyPeer: (peer, event) => hub.presence.sendEvent(peer, event),
    notifyUser: (userId, event) => hub.broadcastToUser(userId, event),
    detachVoiceConnections: (roomId, peerId) => {
      for (const connection of hub.registry()?.connections.values() || []) {
        if (connection.activeVoice?.roomId !== roomId || connection.activeVoice?.peerId !== peerId) continue;
        connection.activeVoice = null;
        connection.previewRoomIds.delete(roomId);
        hub.registry()!.unregisterConnectionForRoom(connection, roomId);
      }
    },
    closePeer: (roomId, peerId, transportId, reason) => hub.presence.closePeer(roomId, peerId, transportId, reason),
    removeParticipant: (roomId, peerId) => liveKit.removeParticipant(roomId, peerId)
  });
  const peerModeration = createPeerModerationService({
    store: services.getRoomStore,
    eviction: peerEviction,
    gatePrincipalForPeer: (roomId, peer) => hub.liveKitGatePrincipalForPeer(roomId, peer),
    livekitConfig: () => liveKit.config(),
    revokeForServerMute: (input) => deps.admission()!.revokeForServerMute(input),
    setParticipantMuted: (roomId, peerId, muted) => liveKit.setParticipantMuted(roomId, peerId, muted),
    announcePeerUpdated: (room, peer) => {
      const event: RoomPeerMessage = { type: 'peer-updated', peer: publicPeer(peer) };
      hub.presence.broadcast(room, event);
      hub.runtime()?.mirrorLegacyRoomEvent(room.id, event);
    },
    notifyPeer: (peer, event) => hub.presence.sendEvent(peer, event),
    maxBans: config.MAX_ROOM_BANS,
    logger: () => deps.logger()
  });
  const roomChat = createRoomChatService({
    messages: services.getMessageService,
    readService: () => services.getHistoryServices().read,
    getRoom: hub.getRoom,
    findRoomBan: hub.findRoomBan,
    feature: deps.featureEnabled,
    prepareContent: (input) => createContentRepository().prepareWrite(input),
    mentionUserIds: mentionUserIdsFromContent,
    limiter: limits.roomChat,
    findUser: (userId) => services.getUserStore().getUserById(userId),
    media: services.getMediaServices,
    replies: () => createReplyRepository({ client: services.getPool() }),
    notifications: services.getNotificationServices,
    delivery: services.getMessageDeliveryServices,
    projectMedia: hub.projection.projectMedia,
    projectReply: hub.projection.projectReply,
    identity: { chatPeerId: sessionChatPeerId, avatarColorKey: sessionAvatarColorKey, displayName: sessionDisplayName },
    directEmit: config.MESSAGE_DIRECT_EMIT_ENABLED,
    broadcastChatMessage: (roomId, message) => hub.runtime()?.broadcastChatMessage(roomId, message),
    broadcastRoomDetail: (roomId, event) => hub.runtime()?.broadcastRoomDetail?.(roomId, event),
    roomDetailEvent: buildServerEnvelope,
    scheduleLinkPreview: hub.linkPreviews.scheduleRoomLinkPreview,
    refreshPins: refreshPinsAfterMessageMutation,
    sendRoomSummaryToUser: async (roomId, userId) => {
      await hub.runtime()?.sendRoomSummaryToUser(roomId, userId);
    },
    logger: () => deps.logger()
  });
  const sessionCookies = createSessionCookies({
    name: config.SESSION_COOKIE_NAME,
    secure: config.SESSION_COOKIE_SECURE,
    maxAgeSeconds: config.SESSION_TTL_MS / 1000
  });
  const accountService = createAccountService({
    users: services.getUserStore,
    deletions: services.getAccountDeletionRepository,
    loginFailures: limits.loginFailures,
    endSessionConnections: (input) => hub.accountLifecycle.endSessionConnections(input),
    notifyUser: (userId, event) => hub.broadcastToUser(userId, event),
    queuePush: (userId, payload, options) => hub.notifications.queuePush(userId, payload, options),
    refreshActiveProfile: (user) => hub.roomLifecycle.refreshActiveProfile(user),
    broadcastProfileToFriends: (user, log) => hub.broadcastUserProfileToFriends(user, { log }),
    logger: () => deps.logger()
  });
  const friendsService = createFriendsService({
    friends: services.getFriendStore,
    findUser: (userId) => services.getUserStore().getUserById(userId),
    findRoom: (roomId) => services.getRoomStore().getRoom(roomId),
    sendDirectMessage: (input) => services.getMessageService().direct.sendMessage(input),
    isOnline: (userId) => hub.isUserOnline(userId),
    notifyUser: (userId, event) => hub.broadcastToUser(userId, event),
    queuePush: (userId, payload, context) => hub.notifications.queuePush(userId, payload, context),
    ringLimiter: limits.ring,
    ringTtlMs: config.RING_TTL_MS
  });
  const directMessages = createDirectMessagesService({
    messages: services.getMessageService,
    readService: () => services.getHistoryServices().read,
    friends: services.getFriendStore,
    findUser: (userId) => services.getUserStore().getUserById(userId),
    isDmMuted: async (userId, peerUserId) => {
      const notifications = services.getNotificationStore();
      return typeof notifications.isDmMuted === 'function' ? notifications.isDmMuted({ userId, peerUserId }) : false;
    },
    roomExists: async (roomId) => Boolean(await hub.getRoom(roomId)),
    expireRoomInvitations: (senderId, roomId) => hub.roomLifecycle.expireRoomInvitations(senderId, roomId),
    feature: deps.featureEnabled,
    limiter: limits.dm,
    media: services.getMediaServices,
    replies: () => createReplyRepository({ client: services.getPool() }),
    delivery: services.getMessageDeliveryServices,
    projectMedia: hub.projection.projectMedia,
    projectReply: hub.projection.projectReply,
    directEmit: config.MESSAGE_DIRECT_EMIT_ENABLED,
    notifyUser: (userId, event) => hub.broadcastToUser(userId, event),
    notifyRecipient: (recipientId, sender, message) =>
      hub.notifications.broadcastDmNotification(recipientId, sender, message),
    scheduleLinkPreview: hub.linkPreviews.scheduleDirectLinkPreview
  });
  const notificationSettings = createNotificationSettingsService({
    preferences: services.getNotificationStore,
    pushes: services.getPushStore,
    pushConfig: () => services.getPushService().config,
    pushLimiter: limits.pushSubscriptions,
    setPresence: (userId, presenceStatus) => hub.registry()?.setUserPresenceStatus(userId, presenceStatus),
    notifyUser: (userId, event) => hub.broadcastToUser(userId, event),
    broadcastProfileToFriends: (user, log) => hub.broadcastUserProfileToFriends(user, { log })
  });
  const avatarsService = createAvatarsService({
    storage: services.getAvatarStorage,
    linkPreviewStorage: services.getLinkPreviewStorage,
    users: services.getUserStore,
    rooms: services.getRoomStore,
    refreshActiveProfile: (user) => hub.roomLifecycle.refreshActiveProfile(user),
    broadcastProfileToFriends: (user, log) => hub.broadcastUserProfileToFriends(user, { log }),
    announceRoomUpdate: (roomId, room) => hub.roomLifecycle.announceRoomUpdate(roomId, room)
  });

  const desktopReleaseService = createDesktopReleaseService({
    repo: config.DESKTOP_RELEASE_REPO,
    cacheMs: config.DESKTOP_RELEASE_CACHE_MS,
    timeoutMs: config.DESKTOP_RELEASE_TIMEOUT_MS,
    githubToken: (deps.env.GITHUB_TOKEN || '').trim() || undefined,
    logger: { warn: (...args: unknown[]) => deps.logger().warn(...(args as [unknown])) }
  });

  return {
    rooms: roomsService,
    peerEviction,
    peerModeration,
    roomChat,
    sessionCookies,
    account: accountService,
    friends: friendsService,
    directMessages,
    notificationSettings,
    avatars: avatarsService,
    desktopRelease: desktopReleaseService
  };
}

export type DomainServices = ReturnType<typeof createDomainServices>;
