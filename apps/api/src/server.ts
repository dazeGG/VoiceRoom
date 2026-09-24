import crypto from 'node:crypto';
import type http from 'node:http';
import fastify, { LogController } from 'fastify';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyWebsocket from '@fastify/websocket';
import { buildRoomMembershipPresenceSnapshot, createConnectionRegistry } from './realtime/registry.ts';
import type { ConnectionRegistry } from './realtime/registry.ts';
import { createWsHandler } from './realtime/ws-handler.ts';
import { createRoomRealtimeRuntime } from './realtime/room-runtime.ts';
import type { RoomRealtimeRuntime } from './realtime/room-runtime.ts';
import { buildServerEnvelope } from './realtime/envelope.ts';
import { createRoomPresence } from './realtime/room-presence.ts';
import { createLinkPreviewEvents } from './domains/link-previews/link-preview-events.ts';
import { createMessageDeliveryRelay } from './domains/messaging/message-delivery-relay.ts';
import { createMessageProjection } from './domains/messaging/message-projection.ts';
import { createNotificationDispatch } from './domains/notifications/notification-dispatch.ts';
import { createAccountLifecycle } from './domains/account/account-lifecycle.ts';
import { createRoomLifecycle } from './domains/rooms/room-lifecycle.ts';
import { startMaintenanceTimers } from './platform/maintenance.ts';
import { createServiceRegistry, resolveCursorHmacKeys as resolveCursorHmacKeysFor } from './app/service-registry.ts';
import { installGracefulShutdown } from './app/graceful-shutdown.ts';
import { createRequestLog } from './platform/http/request-log.ts';
import { liveKitConnectSources, securityHeaders } from './platform/http/security-headers.ts';
import { readApiConfig, readinessReadySetFromEnv, resolveRealtimeReconnectLeaseMs } from './app/config.ts';

import {
  readEnvInt,
  readEnvBool,
  readDatabaseConfig,
  readUploadsDir
} from './lib/config.ts';
import {
  cleanName,
  cleanLiveKitUrl,
  accountPeerIdFor
} from '@voice-room/shared/validation';
import { createProofOfWork } from './lib/pow.ts';
import { LOG_EVENTS } from './lib/log-events.ts';
import {
  createFastifyLoggerOptions,
  createLogger,
  hashIp,
  newRequestId,
  normalizeRequestId
} from './lib/logger.ts';
import { getClientIp, createFailureLimiter, createRateLimiter } from './lib/rate-limit.ts';
import { reconcileAvatarStorage } from './lib/avatar-reconciliation.ts';
import { createAvatarStorage } from './lib/avatar-storage.ts';
import { createLinkPreviewStorage, reconcileLinkPreviewImages } from './lib/link-preview-storage.ts';
import { createLinkPreviewRepository } from './domains/link-previews/link-preview-repository.ts';
import { avatarColorForPeerId, createRoomStore } from './lib/room-store.ts';
import { createUserStore } from './lib/user-store.ts';
import { createFriendStore } from './lib/friend-store.ts';
import { createNotificationStore } from './lib/notification-store.ts';
import { createPushStore } from './lib/push-store.ts';
import { createPushService } from './lib/push-service.ts';
import { startApiListener } from './lib/listen.ts';
import { assertMigrationReady, runMigrations } from './lib/migrate.ts';
import {
  observeMaintenance,
  recordCredentialRevokeCleanupFailure,
  recordHttpRequest,
  renderPrometheus
} from './lib/metrics.ts';
import { registerHttpKit } from './platform/http/http-kit.ts';
import { registerOpsRoutes } from './domains/ops/ops.routes.ts';
import { registerAdmissionRoutes } from './domains/admission/admission.routes.ts';
import { gatePrincipalForPeer } from './domains/admission/gate-principal.ts';
import { createPeerEviction } from './domains/rooms/peer-eviction.ts';
import { createPeerModerationService } from './domains/rooms/peer-moderation.service.ts';
import { registerPeerModerationRoutes } from './domains/rooms/peer-moderation.routes.ts';
import { publicPeer } from './domains/rooms/room-views.ts';
import { registerRoomRoutes } from './domains/rooms/rooms.routes.ts';
import { createRoomsService } from './domains/rooms/rooms.service.ts';
import { publicChatMessage } from './domains/messaging/room-chat-views.ts';
import { registerRoomChatRoutes } from './domains/messaging/room-chat.routes.ts';
import { createRoomChatService } from './domains/messaging/room-chat.service.ts';
import { registerAccountRoutes } from './domains/account/account.routes.ts';
import { createAccountService } from './domains/account/account.service.ts';
import { createSessionCookies } from './domains/account/session-cookie.ts';
import { registerFriendsRoutes } from './domains/social/friends.routes.ts';
import { createFriendsService } from './domains/social/friends.service.ts';
import { registerDirectMessageRoutes } from './domains/messaging/direct-messages.routes.ts';
import { createDirectMessagesService } from './domains/messaging/direct-messages.service.ts';
import { registerNotificationSettingsRoutes } from './domains/notifications/notification-settings.routes.ts';
import { createNotificationSettingsService } from './domains/notifications/notification-settings.service.ts';
import { registerAvatarRoutes } from './domains/media/avatars.routes.ts';
import { createAvatarsService } from './domains/media/avatars.service.ts';
import { createAdmissionService } from './domains/admission/admission.service.ts';
import { createLiveKitAdmin } from './domains/admission/livekit-admin.ts';
import { readLiveKitConfig } from './domains/admission/livekit-config.ts';
import { tokensMatch } from './platform/crypto/tokens-match.ts';
import { createDesktopReleaseService } from './domains/ops/desktop-release.service.ts';
import { getLiveKitRoomName as liveKitRoomName } from './domains/admission/livekit-token-binding.mts';
import { isCrossOriginCookieWrite, isCrossOriginWebSocket } from './platform/http/origin-guard.mts';
import { registerMembershipRoutes } from './domains/membership/membership-routes.ts';
import { registerDmHistoryRoutes } from './domains/messaging/dm-history-routes.ts';
import { registerRoomHistoryRoutes } from './domains/messaging/room-history-routes.ts';
import { createContentRepository } from './domains/messaging/content-repository.ts';
import { createReplyRepository } from './domains/messaging/reply-repository.ts';
import { registerReactionRoutes } from './domains/messaging/reaction-routes.ts';
import { registerPinRoutes } from './domains/messaging/pin-routes.ts';
import { registerNotificationRoutes } from './domains/notifications/notification-routes.ts';
import { registerModerationRoutes } from './domains/moderation/moderation-routes.ts';
import { MAX_UPLOAD_BYTES } from './domains/media/media-service.ts';
import { registerMediaRoutes } from './domains/media/media-routes.ts';
import { createRuntimeReadinessProvider } from './platform/runtime-readiness.ts';
import { registerCapabilityRoutes } from './platform/capability-routes.ts';
import { mentionUserIdsFromContent } from '@voice-room/shared/mentions';

type ApiServer = http.Server & { app: FastifyInstance; inject: FastifyInstance['inject'] };
type Logger = ReturnType<typeof createLogger>;

const {
  HOST,
  PORT,
  SOCKET_PATH,
  MAX_ROOM_PEERS,
  MAX_ROOMS,
  KEEPALIVE_MS,
  BODY_LIMIT_BYTES,
  TRUST_PROXY,
  LIVEKIT_TOKEN_TTL_SECONDS,
  LIVEKIT_GATE_CREDENTIAL_TTL_SECONDS,
  LIVEKIT_ROSTER_WAIT_MS,
  ROSTER_POLL_INTERVAL_MS,
  LIVEKIT_GATE_PUBLIC_URL,
  LIVEKIT_GATE_SECRET,
  ROOM_IDLE_TTL_MS,
  ROOM_PRUNE_INTERVAL_MS,
  ROOM_CHAT_RATE_LIMIT,
  ROOM_CHAT_RATE_WINDOW_MS,
  ROOM_CREATE_RATE_LIMIT,
  ROOM_CREATE_RATE_WINDOW_MS,
  MAX_TEMP_ROOMS_PER_IP,
  MAX_STATIC_ROOMS_PER_USER,
  MAX_ROOM_BANS,
  ROOM_CREATE_POW_DIFFICULTY,
  ROOM_CREATE_POW_TTL_MS,
  SESSION_TTL_MS,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_SECURE,
  CAPABILITY_DAG_PATH,
  CAPABILITY_DESIRED,
  CAPABILITY_API_REPLICA_ID,
  CAPABILITY_EXPECTED_API_REPLICA_IDS,
  CAPABILITY_HEARTBEAT_INTERVAL_MS,
  CAPABILITY_HEARTBEAT_MAX_AGE_MS,
  AUTH_RATE_LIMIT,
  AUTH_RATE_WINDOW_MS,
  LOGIN_FAILURE_LIMIT,
  LOGIN_FAILURE_WINDOW_MS,
  GEOIP_DB_PATH,
  SESSION_REVOKED_CLOSE_CODE,
  DM_RATE_LIMIT,
  DM_RATE_WINDOW_MS,
  FRIEND_REQUEST_RATE_LIMIT,
  FRIEND_REQUEST_RATE_WINDOW_MS,
  RING_RATE_LIMIT,
  RING_RATE_WINDOW_MS,
  RING_TTL_MS,
  AVATAR_UPLOAD_RATE_LIMIT,
  AVATAR_UPLOAD_RATE_WINDOW_MS,
  PUSH_SUBSCRIPTION_RATE_LIMIT,
  PUSH_SUBSCRIPTION_RATE_WINDOW_MS,
  MAX_PUSH_SUBSCRIPTIONS_PER_USER,
  CLIENT_LOG_INTAKE_ENABLED,
  CLIENT_LOG_RATE_LIMIT,
  CLIENT_LOG_RATE_WINDOW_MS,
  MAX_REALTIME_STREAMS_PER_USER,
  MAX_GUEST_STREAMS_PER_IP,
  WS_MAX_PAYLOAD_BYTES,
  RETENTION_PURGE_INTERVAL_MS,
  RETENTION_KEEP_DELETED_MS,
  LINK_PREVIEWS_ENABLED,
  MESSAGE_DIRECT_EMIT_ENABLED,
  MESSAGE_DELIVERY_LISTEN_ENABLED,
  DESKTOP_RELEASE_REPO,
  DESKTOP_RELEASE_CACHE_MS,
  DESKTOP_RELEASE_TIMEOUT_MS
} = readApiConfig();
const readinessProvider = createRuntimeReadinessProvider({
  expectedApiReplicaIds: CAPABILITY_EXPECTED_API_REPLICA_IDS,
  getClient: () => getRelease250Pool(),
  heartbeatIntervalMs: CAPABILITY_HEARTBEAT_INTERVAL_MS,
  heartbeatMaxAgeMs: CAPABILITY_HEARTBEAT_MAX_AGE_MS,
  manifestPath: CAPABILITY_DAG_PATH,
  runtimeId: CAPABILITY_API_REPLICA_ID,
  getReadinessOptions: () => ({
    desired: CAPABILITY_DESIRED,
    binaryReady: readinessReadySetFromEnv('CAPABILITY_READY_BINARY'),
    schemaReady: readinessReadySetFromEnv('CAPABILITY_READY_SCHEMA'),
    indexReady: readinessReadySetFromEnv('CAPABILITY_READY_INDEX'),
    configReady: readinessReadySetFromEnv('CAPABILITY_READY_CONFIG'),
    apiReady: readinessReadySetFromEnv('CAPABILITY_READY_API'),
    webReady: readinessReadySetFromEnv('CAPABILITY_READY_WEB'),
    visibilityReady: readinessReadySetFromEnv('CAPABILITY_READY_VISIBILITY'),
    workerReady: readinessReadySetFromEnv('CAPABILITY_READY_WORKER'),
    internalReady: readinessReadySetFromEnv('CAPABILITY_READY_INTERNAL')
  })
});

const services = createServiceRegistry({
  ROOM_IDLE_TTL_MS,
  SESSION_TTL_MS,
  GEOIP_DB_PATH,
  LIVEKIT_GATE_SECRET,
  LIVEKIT_GATE_CREDENTIAL_TTL_SECONDS,
  LIVEKIT_TOKEN_TTL_SECONDS,
  MAX_ROOM_BANS,
  MAX_PUSH_SUBSCRIPTIONS_PER_USER,
  LINK_PREVIEWS_ENABLED
}, {
  readinessProvider,
  release250FeatureEnabled: (name) => release250FeatureEnabled(name),
  roomRuntime: () => roomRuntime,
  getRoom: (roomId) => getRoom(roomId),
  findRoomBan: (roomId, userId, ip) => findRoomBan(roomId, userId, ip),
  broadcast: (room, message) => broadcast(room, message),
  broadcastToUser: (userId, message) => broadcastToUser(userId, message),
  attachMediaProjection: (context, message) => attachMediaProjection(context, message),
  disconnectModeratedPeer: (room, peer, type, options) => disconnectModeratedPeer(room, peer, type, options),
  liveKitGatePrincipalForPeer: (roomId, peer) => liveKitGatePrincipalForPeer(roomId, peer),
  getLiveKitConfig: () => getLiveKitConfig(),
  roomMembershipPresenceSnapshot: (roomId) => roomMembershipPresenceSnapshot(roomId),
  broadcastRoomLinkPreview: (input) => broadcastRoomLinkPreview(input),
  broadcastDirectLinkPreview: (input) => broadcastDirectLinkPreview(input)
});
const {
  getAccountDeletionRepository,
  getActiveBanService,
  getAvatarStorage,
  getCredentialBoundary,
  getFriendStore,
  getGeoLocator,
  getHistoryServices,
  getLinkPreviewService,
  getLinkPreviewStorage,
  getLiveKitCredentialProvider,
  getMediaServices,
  getMembershipServices,
  getMessageDeliveryServices,
  getMessageService,
  getModerationServices,
  getNotificationServices,
  getNotificationStore,
  getPinServices,
  getPushService,
  getPushStore,
  getReactionServices,
  getRelease250Pool,
  getRoomStore,
  getUserStore
} = services;

function resolveCursorHmacKeys(options: Parameters<typeof resolveCursorHmacKeysFor>[0]): string {
  return resolveCursorHmacKeysFor({ fallbackGateSecret: LIVEKIT_GATE_SECRET, ...options });
}

let wsRegistry: ConnectionRegistry | null = null;
let roomRuntime: RoomRealtimeRuntime | null = null;
const roomPresence = createRoomPresence({
  store: () => getRoomStore(),
  runtime: () => roomRuntime,
  logger: () => getProcessLogger(),
  occupancyRetry: { baseMs: 1000, maxMs: 30000 },
  roster: { waitMs: LIVEKIT_ROSTER_WAIT_MS, pollMs: ROSTER_POLL_INTERVAL_MS }
});
const presenceRooms = roomPresence.rooms;
const {
  attach: attachPresence,
  broadcast,
  closePeer,
  peerCount: getPresencePeerCount,
  prune: pruneRooms,
  publishClearedScreenViewers,
  queueOccupancy: queueRoomOccupancyTransition,
  sendEvent,
  waitForRosterPeer
} = roomPresence;
const messageProjection = createMessageProjection({
  attachments: () => getMediaServices()?.attachments ?? null,
  replies: () => {
    const pool = getRelease250Pool();
    return pool ? createReplyRepository({ client: pool }) : null;
  }
});
const notificationDispatch = createNotificationDispatch({
  push: () => getPushService(),
  preferences: (userId) => getNotificationStore().getPreferences(userId),
  notifyUser: (userId, event) => broadcastToUser(userId, event),
  logger: () => getProcessLogger()
});
const linkPreviewEvents = createLinkPreviewEvents({
  previews: () => getLinkPreviewService(),
  roomMessage: (roomId, messageId) => getMessageService().room.getMessage(roomId, messageId),
  directMessage: (senderId, recipientId, messageId) => getMessageService().direct.getMessage(senderId, recipientId, messageId),
  projection: messageProjection,
  publicChatMessage,
  broadcastRoomEdit: (roomId, message) => roomRuntime?.broadcastRoomDetail?.(roomId, buildServerEnvelope('room.chat.edited', { roomId, message })),
  notifyUser: (userId, event) => broadcastToUser(userId, event)
});
const messageDeliveryRelay = createMessageDeliveryRelay({
  enabled: MESSAGE_DELIVERY_LISTEN_ENABLED,
  pool: () => getRelease250Pool(),
  outbox: () => getMessageDeliveryServices()?.outbox ?? null,
  projection: messageProjection,
  broadcastChatMessage: (roomId, message) => roomRuntime?.broadcastChatMessage(roomId, message),
  notifyUser: (userId, event) => broadcastToUser(userId, event),
  findUser: (userId) => getUserStore().getUserById(userId),
  broadcastDmNotification: (recipientId, sender, message) => notificationDispatch.broadcastDmNotification(recipientId, sender, message),
  publicChatMessage,
  logger: () => getProcessLogger()
});
const { projectMedia: attachMediaProjection, projectReply: attachReplyProjection } = messageProjection;
const { queuePush, broadcastDmNotification } = notificationDispatch;
const { broadcastRoomLinkPreview, broadcastDirectLinkPreview, scheduleRoomLinkPreview, scheduleDirectLinkPreview } = linkPreviewEvents;
const { start: startMessageDeliveryListener, stop: stopMessageDeliveryListener } = messageDeliveryRelay;
const roomLifecycle = createRoomLifecycle({
  presence: roomPresence,
  runtime: () => roomRuntime,
  invitations: () => services.invitationStore(),
  notifyUser: (userId, event) => broadcastToUser(userId, event),
  credentials: () => getCredentialBoundary(),
  removeParticipant: (roomId, peerId) => removeLiveKitParticipant(roomId, peerId),
  removeAvatar: (key, log) => avatarsService.removeFile(key, log),
  displayName: (user) => sessionDisplayName(user),
  logger: () => getProcessLogger()
});
const accountLifecycle = createAccountLifecycle({
  friendIds: (userId) => getFriendStore().getFriendIds(userId),
  notifyUser: (userId, event) => broadcastToUser(userId, event),
  sockets: () => wsRegistry,
  seatPrincipal: (roomId, peerId) => {
    const peer = presenceRooms.get(roomId)?.peers.get(peerId);
    return peer ? liveKitGatePrincipalForPeer(roomId, peer) : null;
  },
  revokeSeatCredentials: (input) => getRoomStore().revokeLiveKitGateCredentialsForPeer(input),
  leaveVoice: (connection, activeVoice) => roomRuntime?.leaveVoiceRoom(connection, activeVoice),
  removeParticipant: (roomId, peerId) => removeLiveKitParticipant(roomId, peerId),
  sessionRevokedCloseCode: SESSION_REVOKED_CLOSE_CODE,
  deletions: () => getAccountDeletionRepository(),
  findRoom: (roomId) => getRoomStore().getRoom(roomId),
  announceRoomUpdate: (roomId, room) => roomLifecycle.announceRoomUpdate(roomId, room),
  finishRoomDeletion: (roomId, options) => roomLifecycle.finishRoomDeletion(roomId, options),
  removeAvatar: (key) => avatarsService.removeFile(key, undefined),
  logger: () => getProcessLogger()
});
const {
  lobbyRoom: publicLobbyRoom,
  announceRoomUpdate: broadcastRoomUpdate,
  refreshActiveProfile: refreshActiveUserProfile,
  expireRoomInvitations,
  finishRoomDeletion
} = roomLifecycle;
const {
  endSessionConnections: endAccountSessionConnections,
  finalizeDueDeletions: finalizeDueAccountDeletions
} = accountLifecycle;
// Callers pass the request (or `{ log }`) whose logger records a failed broadcast.
const broadcastUserProfileToFriends = (user: any, request?: { log?: any } | null) => accountLifecycle.broadcastProfileToFriends(user, request?.log);

// Work that runs outside a request (timers, listeners, background dispatch)
// still has to be searchable next to the requests it was triggered by, so it
// logs through one process logger with the same base fields and redaction
// instead of falling back to console.
let processLogger: Logger | FastifyBaseLogger | null = null;

function getProcessLogger(): Logger {
  return (processLogger ||= createLogger({ name: 'api' })) as Logger;
}

// createApiApp builds a fresh Fastify logger per app; background work adopts it
// so a test harness and the real process agree on the destination.
function setProcessLogger(logger: Logger | FastifyBaseLogger | null): void {
  processLogger = logger || null;
}

function release250FeatureEnabled(name: string): boolean {
  try {
    return readinessProvider.getSnapshot()?.features?.[name] === true;
  } catch {
    return false;
  }
}

async function refreshPinsAfterMessageMutation(roomId: string, action: string, messageId: string): Promise<void> {
  const service = getPinServices()?.service;
  if (!service?.refresh) return;
  try {
    await service.refresh({ roomId, action, messageId });
  } catch (error) {
    // The message mutation is already committed. Preserve its success while
    // retaining evidence; clients will reconcile the derived pin list on load.
    getProcessLogger().error({ evt: LOG_EVENTS.MESSAGE_PIN_REFRESH_FAILED, roomId, messageId, err: error }, 'failed to refresh room pins after a message mutation');
  }
}

function roomMembershipPresenceSnapshot(roomId: string) {
  const room = presenceRooms.get(roomId);
  return buildRoomMembershipPresenceSnapshot(roomId, room, wsRegistry);
}

function isUserOnline(userId: string): boolean {
  return Boolean(wsRegistry?.isUserOnline(userId));
}

function broadcastToUser(userId: string, message: any): number {
  if (!wsRegistry) return 0;
  return wsRegistry.broadcastAccountEvent(userId, message);
}

const pow = createProofOfWork({
  secret: process.env.POW_SECRET || crypto.randomBytes(32),
  difficulty: ROOM_CREATE_POW_DIFFICULTY,
  ttlMs: ROOM_CREATE_POW_TTL_MS
});
const roomCreateLimiter = createRateLimiter({
  limit: ROOM_CREATE_RATE_LIMIT,
  windowMs: ROOM_CREATE_RATE_WINDOW_MS
});
const roomChatLimiter = createRateLimiter({
  limit: ROOM_CHAT_RATE_LIMIT,
  windowMs: ROOM_CHAT_RATE_WINDOW_MS
});
const ringLimiter = createRateLimiter({ limit: RING_RATE_LIMIT, windowMs: RING_RATE_WINDOW_MS });
const authLimiter = createRateLimiter({
  limit: AUTH_RATE_LIMIT,
  windowMs: AUTH_RATE_WINDOW_MS
});
const loginFailureLimiter = createFailureLimiter({
  limit: LOGIN_FAILURE_LIMIT,
  windowMs: LOGIN_FAILURE_WINDOW_MS
});
const dmLimiter = createRateLimiter({
  limit: DM_RATE_LIMIT,
  windowMs: DM_RATE_WINDOW_MS
});
const friendRequestLimiter = createRateLimiter({
  limit: FRIEND_REQUEST_RATE_LIMIT,
  windowMs: FRIEND_REQUEST_RATE_WINDOW_MS
});
const avatarUploadLimiter = createRateLimiter({
  limit: AVATAR_UPLOAD_RATE_LIMIT,
  windowMs: AVATAR_UPLOAD_RATE_WINDOW_MS
});
const pushSubscriptionLimiter = createRateLimiter({
  limit: PUSH_SUBSCRIPTION_RATE_LIMIT,
  windowMs: PUSH_SUBSCRIPTION_RATE_WINDOW_MS
});
let admissionService: ReturnType<typeof createAdmissionService> | null = null;
const roomsService = createRoomsService({
  store: getRoomStore,
  getRoom,
  limits: {
    maxRooms: MAX_ROOMS,
    maxOwnedStaticRoomsPerUser: MAX_STATIC_ROOMS_PER_USER,
    maxTempRoomsPerIp: MAX_TEMP_ROOMS_PER_IP
  },
  announceRoomUpdate: (roomId, room) => broadcastRoomUpdate(roomId, room),
  finishRoomDeletion: (roomId, options) => finishRoomDeletion(roomId, options)
});
const peerEviction = createPeerEviction({
  store: getRoomStore,
  runtime: () => roomRuntime,
  notifyPeer: (peer, event) => sendEvent(peer, event),
  notifyUser: (userId, event) => broadcastToUser(userId, event),
  detachVoiceConnections: (roomId, peerId) => {
    for (const connection of wsRegistry?.connections.values() || []) {
      if (connection.activeVoice?.roomId !== roomId || connection.activeVoice?.peerId !== peerId) continue;
      connection.activeVoice = null;
      connection.previewRoomIds.delete(roomId);
      wsRegistry!.unregisterConnectionForRoom(connection, roomId);
    }
  },
  closePeer: (roomId, peerId, transportId, reason) => closePeer(roomId, peerId, transportId, reason),
  removeParticipant: (roomId, peerId) => removeLiveKitParticipant(roomId, peerId)
});
const disconnectModeratedPeer = peerEviction.disconnect;
const peerModeration = createPeerModerationService({
  store: getRoomStore,
  eviction: peerEviction,
  gatePrincipalForPeer: (roomId, peer) => liveKitGatePrincipalForPeer(roomId, peer),
  livekitConfig: () => getLiveKitConfig(),
  revokeForServerMute: (input) => admissionService!.revokeForServerMute(input),
  setParticipantMuted: (roomId, peerId, muted) => setLiveKitParticipantMuted(roomId, peerId, muted),
  announcePeerUpdated: (room, peer) => {
    const event = { type: 'peer-updated', peer: publicPeer(peer) };
    broadcast(room, event);
    roomRuntime?.mirrorLegacyRoomEvent(room.id, event);
  },
  notifyPeer: (peer, event) => sendEvent(peer, event),
  maxBans: MAX_ROOM_BANS,
  logger: () => getProcessLogger()
});
const roomChat = createRoomChatService({
  messages: getMessageService,
  readService: () => getHistoryServices().read,
  getRoom,
  findRoomBan,
  feature: release250FeatureEnabled,
  prepareContent: (input) => createContentRepository().prepareWrite(input),
  mentionUserIds: mentionUserIdsFromContent,
  limiter: roomChatLimiter,
  findUser: (userId) => getUserStore().getUserById(userId),
  media: getMediaServices,
  replies: () => createReplyRepository({ client: getRelease250Pool() }),
  notifications: getNotificationServices,
  delivery: getMessageDeliveryServices,
  projectMedia: attachMediaProjection,
  projectReply: attachReplyProjection,
  identity: { chatPeerId: sessionChatPeerId, avatarColorKey: sessionAvatarColorKey, displayName: sessionDisplayName },
  directEmit: MESSAGE_DIRECT_EMIT_ENABLED,
  broadcastChatMessage: (roomId, message) => roomRuntime?.broadcastChatMessage(roomId, message),
  broadcastRoomDetail: (roomId, event) => roomRuntime?.broadcastRoomDetail?.(roomId, event),
  roomDetailEvent: buildServerEnvelope,
  scheduleLinkPreview: scheduleRoomLinkPreview,
  refreshPins: refreshPinsAfterMessageMutation,
  sendRoomSummaryToUser: async (roomId, userId) => { await roomRuntime?.sendRoomSummaryToUser(roomId, userId); },
  logger: () => getProcessLogger()
});
const sessionCookies = createSessionCookies({
  name: SESSION_COOKIE_NAME,
  secure: SESSION_COOKIE_SECURE,
  maxAgeSeconds: SESSION_TTL_MS / 1000
});
const accountService = createAccountService({
  users: getUserStore,
  deletions: getAccountDeletionRepository,
  loginFailures: loginFailureLimiter,
  endSessionConnections: (input) => endAccountSessionConnections(input),
  notifyUser: (userId, event) => broadcastToUser(userId, event),
  queuePush: (userId, payload, options) => queuePush(userId, payload, options),
  refreshActiveProfile: (user) => refreshActiveUserProfile(user),
  broadcastProfileToFriends: (user, log) => broadcastUserProfileToFriends(user, { log }),
  logger: () => getProcessLogger()
});
const friendsService = createFriendsService({
  friends: getFriendStore,
  findUser: (userId) => getUserStore().getUserById(userId),
  findRoom: (roomId) => getRoomStore().getRoom(roomId),
  sendDirectMessage: (input) => getMessageService().direct.sendMessage(input),
  isOnline: (userId) => isUserOnline(userId),
  notifyUser: (userId, event) => broadcastToUser(userId, event),
  queuePush: (userId, payload, context) => queuePush(userId, payload, context),
  ringLimiter,
  ringTtlMs: RING_TTL_MS
});
const directMessages = createDirectMessagesService({
  messages: getMessageService,
  readService: () => getHistoryServices().read,
  friends: getFriendStore,
  findUser: (userId) => getUserStore().getUserById(userId),
  isDmMuted: async (userId, peerUserId) => {
    const notifications = getNotificationStore();
    return typeof notifications.isDmMuted === 'function' ? notifications.isDmMuted({ userId, peerUserId }) : false;
  },
  roomExists: async (roomId) => Boolean(await getRoom(roomId)),
  expireRoomInvitations: (senderId, roomId) => expireRoomInvitations(senderId, roomId),
  feature: release250FeatureEnabled,
  limiter: dmLimiter,
  media: getMediaServices,
  replies: () => createReplyRepository({ client: getRelease250Pool() }),
  delivery: getMessageDeliveryServices,
  projectMedia: attachMediaProjection,
  projectReply: attachReplyProjection,
  directEmit: MESSAGE_DIRECT_EMIT_ENABLED,
  notifyUser: (userId, event) => broadcastToUser(userId, event),
  notifyRecipient: (recipientId, sender, message) => broadcastDmNotification(recipientId, sender, message),
  scheduleLinkPreview: scheduleDirectLinkPreview
});
const notificationSettings = createNotificationSettingsService({
  preferences: getNotificationStore,
  pushes: getPushStore,
  pushConfig: () => getPushService().config,
  pushLimiter: pushSubscriptionLimiter,
  setPresence: (userId, presenceStatus) => wsRegistry?.setUserPresenceStatus(userId, presenceStatus),
  notifyUser: (userId, event) => broadcastToUser(userId, event),
  broadcastProfileToFriends: (user, log) => broadcastUserProfileToFriends(user, { log })
});
const avatarsService = createAvatarsService({
  storage: getAvatarStorage,
  linkPreviewStorage: getLinkPreviewStorage,
  users: getUserStore,
  rooms: getRoomStore,
  refreshActiveProfile: (user) => refreshActiveUserProfile(user),
  broadcastProfileToFriends: (user, log) => broadcastUserProfileToFriends(user, { log }),
  announceRoomUpdate: (roomId, room) => broadcastRoomUpdate(roomId, room)
});

function liveKitGatePrincipalForPeer(roomId: string, peer: any) {
  return gatePrincipalForPeer(getRoomStore(), roomId, peer);
}
const desktopReleaseService = createDesktopReleaseService({
  repo: DESKTOP_RELEASE_REPO,
  cacheMs: DESKTOP_RELEASE_CACHE_MS,
  timeoutMs: DESKTOP_RELEASE_TIMEOUT_MS,
  githubToken: (process.env.GITHUB_TOKEN || '').trim() || undefined,
  logger: { warn: (...args: unknown[]) => getProcessLogger().warn(...(args as [unknown])) }
});
const clientLogLimiter = createRateLimiter({
  limit: CLIENT_LOG_RATE_LIMIT,
  windowMs: CLIENT_LOG_RATE_WINDOW_MS
});

// The CSP admits the LiveKit gate the browser connects to, read per request
// so a changed LIVEKIT_URL in tests takes effect.
function baseHeaders() {
  return securityHeaders({
    connectSources: liveKitConnectSources(cleanLiveKitUrl(LIVEKIT_GATE_PUBLIC_URL || process.env.LIVEKIT_URL || '')),
    production: process.env.NODE_ENV === 'production'
  });
}

const logHttpRequest = createRequestLog({ clientIp: (req) => getClientIp(req, TRUST_PROXY), hashIp });

// Callers pass the raw request or a Fastify request; both carry the headers.
function getSessionToken(req: any) {
  return sessionCookies.read(req);
}

async function resolveSessionUser(req: any) {
  const token = getSessionToken(req);
  if (!token) return null;
  const session = await getUserStore().getSessionUser(token, Date.now(), {
    userAgent: String(req.headers?.['user-agent'] || ''),
    resolveLocation: () => getGeoLocator().locate(getClientIp(req, TRUST_PROXY))
  });
  // Stamped for the request-completed record: without it every authenticated
  // request looks anonymous in the log and a user's report cannot be traced to
  // the requests they actually made.
  if (session?.user?.id && req) req.voiceRoomUserId = session.user.id;
  return session;
}

async function resolveOptionalSessionUser(req: any) {
  if (!getSessionToken(req)) return null;
  const session = await resolveSessionUser(req);
  return session?.user || null;
}

function sessionAvatarColorKey(user: any): string {
  return user?.avatarColorKey || '';
}

function sessionDisplayName(user: { displayName?: unknown; login?: unknown } | null | undefined): string {
  if (!user) return '';
  return cleanName(user.displayName || user.login);
}

function sessionChatPeerId(user: { id?: string } | null | undefined) {
  return accountPeerIdFor(user?.id);
}

function getLiveKitRoomName(roomId: string) {
  return liveKitRoomName(roomId);
}

function getLiveKitConfig() {
  return readLiveKitConfig(process.env, { gatePublicUrl: LIVEKIT_GATE_PUBLIC_URL, gateSecret: LIVEKIT_GATE_SECRET });
}

const liveKitAdmin = createLiveKitAdmin({
  config: getLiveKitConfig,
  roomName: getLiveKitRoomName,
  logger: () => getProcessLogger()
});
const removeLiveKitParticipant = liveKitAdmin.removeParticipant;
const setLiveKitParticipantMuted = liveKitAdmin.setParticipantMuted;

function startPruneTimer(server: ApiServer, logger: Logger = getProcessLogger()) {
  return startMaintenanceTimers(server, {
    keepaliveMs: KEEPALIVE_MS,
    intervalMs: ROOM_PRUNE_INTERVAL_MS,
    pruneSockets: () => wsRegistry?.pruneStale(),
    observe: observeMaintenance,
    logger,
    tasks: [
      { name: 'room_prune', label: 'room-prune', failureMessage: 'room prune timer failed', run: () => pruneRooms() },
      { name: 'session_prune', label: 'session-prune', failureMessage: 'session prune timer failed', run: () => getUserStore().pruneSessions() },
      { name: 'login_event_prune', label: 'sign-in-history-prune', failureMessage: 'sign-in history prune timer failed', run: () => getUserStore().pruneLoginEvents() },
      { name: 'account_deletion_finalize', label: 'account-deletion', failureMessage: 'account deletion timer failed', run: () => finalizeDueAccountDeletions() },
      {
        name: 'link_preview_prune',
        label: 'link-preview-prune',
        failureMessage: 'link preview prune timer failed',
        enabled: () => Boolean(getLinkPreviewService()),
        run: () => getLinkPreviewService()!.pruneExpired()
      },
      {
        name: 'retention_purge',
        label: 'retention-purge',
        failureMessage: 'retention purge timer failed',
        enabled: () => RETENTION_PURGE_INTERVAL_MS > 0 && Boolean(getRoomStore().purgeDeleted),
        run: () => getRoomStore().purgeDeleted({ olderThanMs: RETENTION_KEEP_DELETED_MS })
      }
    ]
  });
}

async function getRoom(roomId: string) {
  const room = await getRoomStore().getRoom(roomId);
  if (!room) return null;
  room.updatedAt = Date.now();
  return attachPresence(room);
}

async function findRoomBan(roomId: string, userId?: string | null, ip?: string | null) {
  if (!roomId) return null;
  const service = getActiveBanService();
  if (service) return service.getActiveBan({ roomId, userId: userId || null, ip: ip || '' });
  if (typeof getRoomStore().findActiveRoomBan !== 'function') return null;
  return getRoomStore().findActiveRoomBan({ roomId, userId: userId || null, ip: ip || '' });
}


function getActiveGuestWsCount() {
  if (!wsRegistry?.connections) return 0;
  let count = 0;
  for (const connection of wsRegistry.connections.values()) {
    if (connection.guest) count += 1;
  }
  return count;
}

function createApiApp({
  store = null,
  users = null,
  friends = null,
  notifications = null,
  pushes = null,
  push = null,
  avatars = null,
  liveKitCredentials = null,
  membershipServicesOverride = null,
  readinessProviderOverride = null,
  realtimeReconnectLeaseMs = resolveRealtimeReconnectLeaseMs(process.env),
  realtimeNow = Date.now,
  realtimeSetTimeout = globalThis.setTimeout,
  realtimeClearTimeout = globalThis.clearTimeout,
  // A test that asserts a failure was observed rather than swallowed needs
  // somewhere to observe it: Fastify's own logger is silent by default.
  logger = null
}: {
  store?: unknown;
  users?: unknown;
  friends?: unknown;
  notifications?: unknown;
  pushes?: unknown;
  push?: unknown;
  avatars?: unknown;
  liveKitCredentials?: unknown;
  membershipServicesOverride?: unknown;
  readinessProviderOverride?: typeof readinessProvider | null;
  realtimeReconnectLeaseMs?: number;
  realtimeNow?: () => number;
  realtimeSetTimeout?: (callback: () => void, ms: number) => any;
  realtimeClearTimeout?: (timer: any) => void;
  logger?: Logger | FastifyBaseLogger | null;
} = {}) {
  const { roomStoreChanged } = services.applyOverrides({
    store,
    users,
    friends,
    notifications,
    pushes,
    push,
    avatars,
    liveKitCredentials,
    membershipServicesOverride
  });
  if (roomStoreChanged) roomPresence.reset();

  const app = fastify({
    bodyLimit: BODY_LIMIT_BYTES,
    // Request lines come from our own logHttpRequest (one record per request,
    // healthz excluded), not from Fastify's built-in pair.
    logController: new LogController({ disableRequestLogging: true }),
    // A request id supplied by the edge is reused so one identifier spans
    // Caddy, the API and the browser report that quotes it; anything malformed
    // is replaced rather than trusted into the log stream.
    genReqId: (request) => normalizeRequestId(request.headers['x-request-id']) || newRequestId(),
    logger: createFastifyLoggerOptions(),
    trustProxy: TRUST_PROXY
  });
  const appLogger = logger || app.log;
  setProcessLogger(appLogger);

  // The client cannot quote an id it never saw, so every response carries it
  // back — including the error responses a user is most likely to report.
  // It is set on the raw response so it also reaches the WebSocket upgrade
  // refusal and the not-found handler.
  app.addHook('onRequest', (request, reply, done) => {
    reply.raw.setHeader('x-request-id', request.id);
    done();
  });

  // Origin checks run for every route: every route that mutates state does so
  // with the same session cookie.
  app.addHook('onRequest', (request, reply, done) => {
    if (isCrossOriginWebSocket(request.raw)) {
      // The refused handshake socket is not an HTTP connection the server
      // tracks, so it has to be closed explicitly once the 403 is written.
      reply.code(403).header('Connection', 'close').send({ ok: false, error: 'Cross-origin request rejected' });
      reply.raw.once('finish', () => request.raw.socket?.destroySoon?.());
      return;
    }
    if (isCrossOriginCookieWrite(request.raw, Boolean(getSessionToken(request.raw)))) {
      reply.code(403).send({ ok: false, error: 'Cross-origin request rejected' });
      return;
    }
    done();
  });

  // Fastify-native routes get the same headers, failure shape, metric and
  // request log line as the legacy handlers (platform/http/http-kit.ts).
  registerHttpKit(app, {
    securityHeaders: baseHeaders,
    recordRequest: recordHttpRequest,
    logRequest: logHttpRequest,
    logHandlerFailure: (request, route, error) => {
      request.log?.error?.({ evt: LOG_EVENTS.HTTP_HANDLER_FAILED, route, err: error }, 'route handler failed');
    }
  });
  admissionService = createAdmissionService({
    livekitConfig: getLiveKitConfig,
    credentialProvider: getLiveKitCredentialProvider,
    credentialBoundary: getCredentialBoundary,
    store: getRoomStore,
    roomExists: async (roomId) => Boolean(await getRoom(roomId)),
    findRoomBan,
    waitForRosterPeer,
    memberships: getMembershipServices,
    roomName: getLiveKitRoomName,
    recordRevokeFailure: recordCredentialRevokeCleanupFailure
  });
  const apiContext = {
    logger: appLogger,
    clientIp: (req: http.IncomingMessage) => getClientIp(req, TRUST_PROXY),
    resolveSession: resolveSessionUser,
    hashIp
  };

  app.register(fastifyCookie, { hook: 'onRequest' });
  app.register(fastifyMultipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, parts: 2 }
  });
  app.register(fastifyWebsocket, { options: { maxPayload: WS_MAX_PAYLOAD_BYTES } });
  const activeReadinessProvider = readinessProviderOverride || readinessProvider;
  app.addHook('onReady', async () => { await activeReadinessProvider.start?.(); });
  app.addHook('onClose', async () => { await activeReadinessProvider.stop?.(); });
  app.addHook('onReady', startMessageDeliveryListener);
  app.addHook('onClose', stopMessageDeliveryListener);

  wsRegistry = createConnectionRegistry({
    maxConnectionsPerUser: MAX_REALTIME_STREAMS_PER_USER,
    maxGuestConnectionsPerIp: MAX_GUEST_STREAMS_PER_IP,
    keepaliveMs: KEEPALIVE_MS,
    onPresenceChange: (friendId, userId, online) => {
      broadcastToUser(friendId, { type: 'presence', userId, online });
    },
    getFriendIds: (userId) => getFriendStore().getFriendIds(userId),
    onConnectionClose: (connection) => {
      roomRuntime?.cleanupConnection(connection);
    },
    logger: appLogger
  });

  roomRuntime = createRoomRealtimeRuntime({
    presenceRooms,
    wsRegistry,
    getRoomStore,
    getRoom,
    publicPeer,
    publicLobbyRoom,
    publicChatMessage,
    getUserStore,
    broadcast,
    closePeer,
    avatarColorForPeerId,
    MAX_ROOM_PEERS,
    tokensMatch,
    sessionAvatarColorKey,
    queueRoomOccupancyTransition,
    findRoomBan,
    credentialBoundary: getCredentialBoundary(),
    removeLiveKitParticipant,
    reconnectLeaseMs: realtimeReconnectLeaseMs,
    now: realtimeNow,
    setTimeout: realtimeSetTimeout,
    clearTimeout: realtimeClearTimeout,
    logger: appLogger
  });

  const wsHandler = createWsHandler({
    registry: wsRegistry,
    roomRuntime,
    resolveSessionUser,
    getFriendIds: (userId) => getFriendStore().getFriendIds(userId),
    isUserOnline,
    // The same relationship rule as sending a direct message.
    canTypeToUser: async (userId, peerId) => (
      await getFriendStore().areFriends(userId, peerId)
      && !(await getFriendStore().isBlockedBetween(userId, peerId))
    ),
    getClientIp: (req) => getClientIp(req, TRUST_PROXY),
    logger: appLogger
  });

  app.setNotFoundHandler((request, reply) => {
    reply.headers(baseHeaders()).code(404).send({ ok: false, error: 'Not found' });
  });

  registerAdmissionRoutes(app, apiContext, admissionService);
  registerRoomRoutes(app, apiContext, {
    rooms: roomsService,
    store: getRoomStore,
    getRoom,
    findRoomBan,
    findAuthorizedPeer: (roomId, peerId, sessionToken) => {
      const peer = presenceRooms.get(roomId)?.peers.get(peerId);
      return peer && tokensMatch(peer.sessionToken, sessionToken) ? peer : null;
    },
    lobbyRoom: publicLobbyRoom,
    invalidateRecipientCache: (roomId) => roomRuntime?.invalidateRecipientCache(roomId),
    createLimiter: roomCreateLimiter,
    pow: pow,
    maxRooms: MAX_ROOMS,
    maxRoomPeers: MAX_ROOM_PEERS
  });
  registerPeerModerationRoutes(app, apiContext, { rooms: roomsService, moderation: peerModeration });
  registerRoomChatRoutes(app, apiContext, roomChat);
  registerFriendsRoutes(app, apiContext, { friends: friendsService, requestLimiter: friendRequestLimiter });
  registerDirectMessageRoutes(app, apiContext, directMessages);
  registerNotificationSettingsRoutes(app, apiContext, notificationSettings);
  registerAvatarRoutes(app, apiContext, { avatars: avatarsService, rooms: roomsService, uploadLimiter: avatarUploadLimiter });
  registerAccountRoutes(app, apiContext, {
    account: accountService,
    limiter: authLimiter,
    sessionCookie: sessionCookies.issue,
    clearedSessionCookie: sessionCookies.clear,
    sessionToken: getSessionToken,
    device: async (req) => ({
      userAgent: String(req.headers?.['user-agent'] || ''),
      // Only used for the local city/country lookup; the IP is not stored.
      locationLabel: await getGeoLocator().locate(getClientIp(req, TRUST_PROXY))
    })
  });
  registerOpsRoutes(app, apiContext, {
    readiness: activeReadinessProvider,
    livekitEnabled: () => getLiveKitConfig().enabled,
    renderMetrics: () => {
      const readiness = (() => {
        try {
          return activeReadinessProvider.getSnapshot();
        } catch {
          return null;
        }
      })();
      return renderPrometheus({
        activeWs: wsRegistry?.connections?.size || 0,
        activeGuestWs: getActiveGuestWsCount(),
        presenceRooms: presenceRooms.size,
        presencePeers: getPresencePeerCount(),
        capabilityReadiness: readiness?.features || {}
      });
    },
    pow: pow,
    powDifficulty: ROOM_CREATE_POW_DIFFICULTY,
    powTtlMs: ROOM_CREATE_POW_TTL_MS,
    clientLogs: { enabled: CLIENT_LOG_INTAKE_ENABLED, limiter: clientLogLimiter },
    desktopRelease: desktopReleaseService
  });

  registerCapabilityRoutes({
    app,
    readinessProvider: activeReadinessProvider
  });

  const memberships = getMembershipServices();
  if (memberships) {
    registerMembershipRoutes({
      app,
      directoryService: memberships.directory,
      membershipService: memberships.service,
      resolveUser: resolveSessionUser,
      membershipEnabled: () => {
        try {
          return activeReadinessProvider.getSnapshot()?.features?.membership === true;
        } catch {
          return false;
        }
      },
      prepareLeave: ({ roomId, user }) => roomRuntime!.disconnectAccountFromRoom({ roomId, userId: user.id }),
      onLeft: async ({ roomId, user }) => {
        await getRoomStore().removeRoomBookmarkForUser(user.id, roomId);
        roomRuntime?.invalidateRecipientCache(roomId);
      }
    });
  }

  registerRoomHistoryRoutes({
    app,
    historyService: getHistoryServices().room,
    resolveRoomAccess: async ({ request, roomId }) => {
      const session = await resolveSessionUser(request);
      const authorized = Boolean(session?.user?.id)
        && await getRoomStore().canUserReadRoomChat(roomId, session!.user!.id);
      return { authorized, statusCode: session ? 403 : 401 };
    }
  });
  registerDmHistoryRoutes({
    app,
    historyService: getHistoryServices().dm,
    resolveUser: resolveSessionUser
  });

  const reactions = getReactionServices();
  if (reactions) {
    registerReactionRoutes({
      app,
      reactionService: reactions.service,
      resolveUser: resolveSessionUser
    });
  }

  const pins = getPinServices();
  if (pins) {
    registerPinRoutes({
      app,
      pinService: pins.service,
      resolveRoomAccess: async ({ request, roomId, action }) => {
        const session = await resolveSessionUser(request);
        const viewer = session?.user || null;
        const authorized = Boolean(viewer?.id)
          && await getRoomStore()[action === 'write' ? 'canUserReactInRoom' : 'canUserReadRoomChat'](roomId, viewer!.id);
        return { authorized, statusCode: session ? 403 : 401, viewer };
      }
    });
  }

  const notificationDomain = getNotificationServices();
  if (notificationDomain) {
    registerNotificationRoutes({
      app,
      service: notificationDomain.service,
      resolveUser: async (request) => (await resolveSessionUser(request))?.user || null,
      enabled: () => release250FeatureEnabled('engagement')
    });
  }

  const moderation = getModerationServices();
  if (moderation) {
    registerModerationRoutes({
      app,
      moderationService: moderation.service,
      messageModerationService: moderation.messageService,
      resolveUser: async (request) => (await resolveSessionUser(request))?.user || null,
      enabled: () => release250FeatureEnabled('moderationCenter')
    });
  }

  const media = getMediaServices();
  if (media) {
    registerMediaRoutes({
      app,
      mediaService: media.service,
      mediaVisibilityService: media.visibility,
      resolveUser: resolveSessionUser,
      uploadsEnabled: () => release250FeatureEnabled('mediaUploads'),
      readsEnabled: () => release250FeatureEnabled('mediaRead')
    });
  }



  // Register after plugins finish loading so @fastify/websocket can wrap the handler.
  app.after(() => {
    app.get('/api/ws', { websocket: true }, (socket, request) => {
      void wsHandler.handleConnection(socket, request.raw);
    });
  });

  return app;
}

function createApiServer(options: Parameters<typeof createApiApp>[0] = {}): ApiServer {
  const app = createApiApp(options);
  const server = app.server as ApiServer;
  const listen = server.listen.bind(server);
  server.app = app;
  server.inject = app.inject.bind(app);
  server.listen = ((...args: any[]) => {
    const callback = typeof args.at(-1) === 'function' ? args.at(-1) : null;
    const listenArgs = callback ? args.slice(0, -1) : args;

    app.ready((error) => {
      if (error) {
        if (callback) {
          callback(error);
          return;
        }
        server.emit('error', error);
        return;
      }
      listen(...listenArgs, callback || undefined);
    });
    return server;
  }) as ApiServer['listen'];
  server.once('close', () => roomPresence.clearOccupancyRetries());
  return server;
}

async function closeStores(logger: Pick<Logger, 'error'> = getProcessLogger()): Promise<void> {
  await services.close(logger);
}

async function bootstrap({ env = process.env, logger = createLogger({ env, name: 'api' }), exit = process.exit }: {
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
  exit?: (code?: number) => void;
} = {}): Promise<ApiServer | null> {
  try {
    const database = readDatabaseConfig(env);
    if (readEnvBool('MIGRATE_ON_START', env.NODE_ENV !== 'production', env)) {
      await runMigrations({ databaseUrl: database.url, logger });
    }
    if (env.NODE_ENV === 'production') {
      await assertMigrationReady({ databaseUrl: database.url });
    }
    const roomStore = createRoomStore({
      databaseUrl: database.url,
      logger,
      roomIdleTtlMs: ROOM_IDLE_TTL_MS
    });
    await roomStore.markActiveTemporaryRoomsEmpty();
    await roomStore.pruneRooms();
    const userStore = createUserStore({ databaseUrl: database.url, logger, sessionTtlMs: SESSION_TTL_MS });
    const friendStore = createFriendStore({ databaseUrl: database.url, logger });
    const notificationStore = createNotificationStore({ databaseUrl: database.url, logger });
    const pushStore = createPushStore({
      databaseUrl: database.url,
      logger,
      maxSubscriptionsPerUser: readEnvInt('MAX_PUSH_SUBSCRIPTIONS_PER_USER', 10, 1, env)
    });
    const pushService = createPushService({ store: pushStore, env, logger });
    const avatarStorage = createAvatarStorage({ uploadsDir: readUploadsDir(env) });
    const reconciliation = await reconcileAvatarStorage({
      storage: avatarStorage,
      userStore,
      roomStore
    });
    if (reconciliation.removed > 0) {
      logger.info({ evt: LOG_EVENTS.MAINTENANCE_TASK_COMPLETED, task: 'avatar-reconciliation', removed: reconciliation.removed }, 'removed orphaned avatar files');
    }
    const linkPreviewStorage = createLinkPreviewStorage({ uploadsDir: readUploadsDir(env) });
    services.install({ roomStore, userStore, friendStore, notificationStore, pushStore, pushService, avatarStorage, linkPreviewStorage });
    try {
      const previewPool = getRelease250Pool();
      if (previewPool) {
        const removedPreviewImages = await reconcileLinkPreviewImages({
          storage: linkPreviewStorage,
          repository: createLinkPreviewRepository({ pool: previewPool })
        });
        if (removedPreviewImages > 0) logger.info({ evt: LOG_EVENTS.MAINTENANCE_TASK_COMPLETED, task: 'link-preview-reconciliation', removed: removedPreviewImages }, 'removed unused link preview images');
      }
    } catch (error) {
      logger.warn({ evt: LOG_EVENTS.LINK_PREVIEW_RECONCILE_FAILED, err: error }, 'link preview image reconciliation failed');
    }
    const server = createApiServer({
      store: roomStore,
      users: userStore,
      friends: friendStore,
      notifications: notificationStore,
      pushes: pushStore,
      push: pushService,
      avatars: avatarStorage,
      realtimeReconnectLeaseMs: resolveRealtimeReconnectLeaseMs(env)
    });
    await server.app.ready();
    startPruneTimer(server, logger);
    startApiListener({
      host: HOST,
      port: PORT,
      server,
      socketPath: SOCKET_PATH,
      logger,
      exit
    });
    installGracefulShutdown(server, {
      logger,
      exit,
      sockets: () => wsRegistry?.connections?.values?.() || [],
      closeStores
    });
    return server;
  } catch (error) {
    logger.fatal({ evt: LOG_EVENTS.BOOTSTRAP_FAILED, err: error }, 'Voice Room API failed to bootstrap');
    if (exit === process.exit && typeof process !== 'undefined') {
      process.exitCode = 1;
    }
    exit(1);
    return null;
  }
}

if (import.meta.main) {
  void bootstrap();
}

export const __private = {
    pruneRooms,
    resolveCursorHmacKeys,
    resolveRealtimeReconnectLeaseMs
  };
export { bootstrap, closeStores, createApiApp, createApiServer };
