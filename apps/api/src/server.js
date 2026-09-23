import crypto from 'node:crypto';
import fastify, { LogController } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyWebsocket from '@fastify/websocket';
import { buildRoomMembershipPresenceSnapshot, createConnectionRegistry } from './realtime/registry.js';
import { createWsHandler } from './realtime/ws-handler.js';
import { createRoomRealtimeRuntime } from './realtime/room-runtime.js';
import { buildServerEnvelope } from './realtime/envelope.js';
import { createRoomPresence } from './realtime/room-presence.ts';
import { createLinkPreviewEvents } from './domains/link-previews/link-preview-events.ts';
import { createMessageDeliveryRelay } from './domains/messaging/message-delivery-relay.ts';
import { createMessageProjection } from './domains/messaging/message-projection.ts';
import { createNotificationDispatch } from './domains/notifications/notification-dispatch.ts';
import { createAccountLifecycle } from './domains/account/account-lifecycle.ts';
import { createRoomLifecycle } from './domains/rooms/room-lifecycle.ts';
import { startMaintenanceTimers } from './platform/maintenance.ts';
import { URL } from 'node:url';

import {
  readEnvInt,
  readEnvBool,
  readMessageDeliveryMode,
  readDatabaseConfig,
  readUploadsDir
} from './lib/config.js';
import {
  normalizeRoomId,
  normalizePeerId,
  normalizeSessionToken,
  cleanName,
  cleanStreamId,
  cleanScreenProfileId,
  cleanLiveKitUrl,
  accountPeerIdFor,
  isReservedPeerId
} from '@voice-room/shared/validation';
import { createProofOfWork } from './lib/pow.js';
import { LOG_EVENTS } from './lib/log-events.js';
import {
  createFastifyLoggerOptions,
  createLogger,
  hashIp,
  newRequestId,
  normalizeRequestId
} from './lib/logger.js';
import { getClientIp, createFailureLimiter, createRateLimiter } from './lib/rate-limit.js';
import { reconcileAvatarStorage } from './lib/avatar-reconciliation.js';
import { createAvatarStorage } from './lib/avatar-storage.js';
import { createLinkPreviewFetcher } from './lib/link-preview-fetcher.js';
import { processLinkPreviewImage } from './lib/link-preview-image.js';
import { createLinkPreviewStorage, reconcileLinkPreviewImages } from './lib/link-preview-storage.js';
import { createLinkPreviewRepository } from './domains/link-previews/link-preview-repository.js';
import { createLinkPreviewService } from './domains/link-previews/link-preview-service.js';
import { avatarColorForPeerId, createRoomStore } from './lib/room-store.js';
import { createUserStore } from './lib/user-store.js';
import { createGeoLocator } from './lib/geoip.js';
import { createAccountDeletionRepository } from './domains/account/account-deletion-repository.js';
import { createFriendStore } from './lib/friend-store.js';
import { createNotificationStore } from './lib/notification-store.js';
import { createPushStore } from './lib/push-store.js';
import { createPushService } from './lib/push-service.js';
import { startApiListener } from './lib/listen.js';
import { assertMigrationReady, runMigrations } from './lib/migrate.js';
import { createRelease250Pool } from './lib/release-250-pool.js';
import {
  observeMaintenance,
  recordCredentialRevokeCleanupFailure,
  recordHttpRequest,
  recordMediaAuthorizationInvariantFailure,
  recordMediaPressure,
  renderPrometheus
} from './lib/metrics.js';
import { createCredentialBoundaryService } from './domains/admission/credential-boundary-service.js';
import { registerHttpKit } from './platform/http/http-kit.ts';
import { registerOpsRoutes } from './domains/ops/ops.routes.ts';
import { registerAdmissionRoutes } from './domains/admission/admission.routes.ts';
import { gatePrincipalForPeer, isGatePrincipal } from './domains/admission/gate-principal.ts';
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
import { notificationActor } from './domains/social/social-views.ts';
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
import { createLiveKitCredentialProvider } from './domains/admission/livekit-credential-provider.js';
import { createMembershipRepository } from './domains/membership/membership-repository.js';
import { createMembershipService } from './domains/membership/membership-service.js';
import { createMemberDirectoryService } from './domains/membership/member-directory-service.js';
import { registerMembershipRoutes } from './domains/membership/membership-routes.js';
import { createDirectMessageRepository } from './domains/messaging/direct-message-repository.js';
import { createDmHistoryRepository } from './domains/messaging/dm-history-repository.js';
import { createDmHistoryService } from './domains/messaging/dm-history-service.js';
import { registerDmHistoryRoutes } from './domains/messaging/dm-history-routes.js';
import { createMessageService } from './domains/messaging/message-service.js';
import { createMessageReadRepository } from './domains/messaging/message-read-repository.js';
import { createMessageReadService } from './domains/messaging/message-read-service.js';
import { createMessageIdempotencyRepository } from './domains/messaging/message-idempotency-repository.js';
import { createMessageOutboxRepository } from './domains/messaging/message-outbox-repository.js';
import { createMessageVisibilityService } from './domains/messaging/message-visibility-service.js';
import { createRoomHistoryRepository } from './domains/messaging/room-history-repository.js';
import { createRoomHistoryService } from './domains/messaging/room-history-service.js';
import { registerRoomHistoryRoutes } from './domains/messaging/room-history-routes.js';
import { createRoomMessageRepository } from './domains/messaging/room-message-repository.js';
import { createContentRepository } from './domains/messaging/content-repository.js';
import { createReplyRepository } from './domains/messaging/reply-repository.js';
import { createReactionRepository } from './domains/messaging/reaction-repository.js';
import { createReactionService } from './domains/messaging/reaction-service.js';
import { createReactionRealtimeAdapter } from './domains/messaging/reaction-realtime-adapter.js';
import { registerReactionRoutes } from './domains/messaging/reaction-routes.js';
import { createPinRepository } from './domains/messaging/pin-repository.js';
import { createPinService } from './domains/messaging/pin-service.js';
import { registerPinRoutes } from './domains/messaging/pin-routes.js';
import { createInboxRepository } from './domains/notifications/inbox-repository.js';
import { createMentionRepository } from './domains/notifications/mention-repository.js';
import { createMentionEligibilityService } from './domains/notifications/mention-eligibility-service.js';
import { createNotificationOutboxRepository } from './domains/notifications/notification-outbox-repository.js';
import { createNotificationService } from './domains/notifications/notification-service.js';
import { registerNotificationRoutes } from './domains/notifications/notification-routes.js';
import { createModerationRepository } from './domains/moderation/moderation-repository.js';
import { createActiveBanService } from './domains/moderation/active-ban-service.js';
import { createModerationService } from './domains/moderation/moderation-service.js';
import { createMessageModerationService } from './domains/moderation/message-moderation-service.js';
import { registerModerationRoutes } from './domains/moderation/moderation-routes.js';
import { createAttachmentRepository } from './domains/media/attachment-repository.js';
import { createMediaJobRepository } from './domains/media/media-job-repository.js';
import { createMediaStorage } from './domains/media/storage.js';
import { createMediaPressureService } from './domains/media/media-pressure-service.js';
import { createMediaQuotaRepository } from './domains/media/media-quota-repository.js';
import { createMediaQuotaService } from './domains/media/media-quota-service.js';
import { createMediaService, MAX_UPLOAD_BYTES } from './domains/media/media-service.js';
import { createMediaVisibilityService } from './domains/media/media-visibility-service.js';
import { registerMediaRoutes } from './domains/media/media-routes.js';
import { createCursorCodec } from './platform/cursor-codec.js';
import { createRuntimeReadinessProvider } from './platform/runtime-readiness.js';
import { registerCapabilityRoutes } from './platform/capability-routes.js';
import { mentionUserIdsFromContent } from '@voice-room/shared/mentions';

const API_PREFIX = '/api';
const HOST = (process.env.HOST || '127.0.0.1').trim();
const PORT = readEnvInt('PORT', 3000, 1);
const SOCKET_PATH = (process.env.SOCKET_PATH || '').trim();
const MAX_ROOM_PEERS = readEnvInt('MAX_ROOM_PEERS', 12, 1);
const MAX_ROOMS = readEnvInt('MAX_ROOMS', 100, 1);
const KEEPALIVE_MS = readEnvInt('SSE_KEEPALIVE_MS', 15000, 1000);
const DEFAULT_REALTIME_RECONNECT_LEASE_MS = 30000;
const BODY_LIMIT_BYTES = readEnvInt('BODY_LIMIT_BYTES', 65536, 1024);
const TRUST_PROXY = readEnvBool('TRUST_PROXY', false);
// The LiveKit JWT only has to survive the join: LiveKit refreshes it for a
// connected participant, so a short TTL bounds how long a leaked token is
// useful. The gate credential is revocable server-side and keeps the long TTL
// that signal resumes and in-place reconnects rely on.
const LIVEKIT_TOKEN_TTL_SECONDS = readEnvInt('LIVEKIT_TOKEN_TTL_SECONDS', 600, 60);
const LIVEKIT_GATE_CREDENTIAL_TTL_SECONDS = readEnvInt('LIVEKIT_GATE_CREDENTIAL_TTL_SECONDS', 21600, 60);
const LIVEKIT_ROSTER_WAIT_MS = readEnvInt('LIVEKIT_ROSTER_WAIT_MS', 5000, 0);
const ROSTER_POLL_INTERVAL_MS = 50;
const LIVEKIT_GATE_PUBLIC_URL = cleanLiveKitUrl(process.env.LIVEKIT_GATE_PUBLIC_URL || process.env.LIVEKIT_URL || '');
const LIVEKIT_GATE_SECRET = (process.env.LIVEKIT_GATE_SECRET || '').trim();
const ROOM_IDLE_TTL_MS = readEnvInt('ROOM_IDLE_TTL_MS', 900000, 1000);
const ROOM_PRUNE_INTERVAL_MS = readEnvInt('ROOM_PRUNE_INTERVAL_MS', 60000, 0);
const ROOM_CHAT_RATE_LIMIT = readEnvInt('ROOM_CHAT_RATE_LIMIT', 60, 0);
const ROOM_CHAT_RATE_WINDOW_MS = readEnvInt('ROOM_CHAT_RATE_WINDOW_MS', 60000, 1000);
const ROOM_CREATE_RATE_LIMIT = readEnvInt('ROOM_CREATE_RATE_LIMIT', 20, 0);
const ROOM_CREATE_RATE_WINDOW_MS = readEnvInt('ROOM_CREATE_RATE_WINDOW_MS', 60000, 1000);
const MAX_TEMP_ROOMS_PER_IP = readEnvInt(
  'MAX_TEMP_ROOMS_PER_IP',
  readEnvInt('MAX_EMPTY_ROOMS_PER_IP', 1, 0),
  0
);
const MAX_STATIC_ROOMS_PER_USER = readEnvInt('MAX_STATIC_ROOMS_PER_USER', 3, 0);
const MAX_ROOM_BANS = readEnvInt('MAX_ROOM_BANS', 100, 1);
const ROOM_CREATE_POW_DIFFICULTY = Math.min(readEnvInt('ROOM_CREATE_POW_DIFFICULTY', 14, 0), 32);
const ROOM_CREATE_POW_TTL_MS = readEnvInt('ROOM_CREATE_POW_TTL_MS', 120000, 10000);
const SESSION_TTL_MS = readEnvInt('SESSION_TTL_MS', 30 * 24 * 60 * 60 * 1000, 60000);
const SESSION_COOKIE_NAME = 'vr_session';
const SESSION_COOKIE_SECURE = readEnvBool('SESSION_COOKIE_SECURE', process.env.NODE_ENV === 'production');
const CAPABILITY_DAG_PATH = (process.env.CAPABILITY_DAG_PATH || 'config/capability-dag.v1.json').trim();
const CAPABILITY_DESIRED = (() => {
  try {
    const parsed = JSON.parse(process.env.CAPABILITY_DESIRED || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
})();

function readinessReadySetFromEnv(name) {
  const raw = (process.env[name] || '').trim();
  if (!raw) return new Set();
  return new Set(raw.split(',').map((item) => item.trim()).filter(Boolean));
}

const CAPABILITY_API_REPLICA_ID = (process.env.CAPABILITY_API_REPLICA_ID || process.env.HOSTNAME || 'api-primary').trim();
const CAPABILITY_EXPECTED_API_REPLICA_IDS = (() => {
  const configured = readinessReadySetFromEnv('CAPABILITY_EXPECTED_API_REPLICA_IDS');
  return configured.size ? [...configured] : [CAPABILITY_API_REPLICA_ID];
})();
const readinessProvider = createRuntimeReadinessProvider({
  expectedApiReplicaIds: CAPABILITY_EXPECTED_API_REPLICA_IDS,
  getClient: () => getRelease250Pool(),
  heartbeatIntervalMs: readEnvInt('CAPABILITY_HEARTBEAT_INTERVAL_MS', 5_000, 1_000),
  heartbeatMaxAgeMs: readEnvInt('CAPABILITY_HEARTBEAT_MAX_AGE_MS', 15_000, 3_000),
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
const AUTH_RATE_LIMIT = readEnvInt('AUTH_RATE_LIMIT', 30, 0);
const AUTH_RATE_WINDOW_MS = readEnvInt('AUTH_RATE_WINDOW_MS', 60000, 1000);
const LOGIN_FAILURE_LIMIT = readEnvInt('LOGIN_FAILURE_LIMIT', 10, 0);
const LOGIN_FAILURE_WINDOW_MS = readEnvInt('LOGIN_FAILURE_WINDOW_MS', 900000, 1000);
const GEOIP_DB_PATH = String(process.env.GEOIP_DB_PATH || '').trim();
// Close code for sockets whose account session was ended; clients stop
// reconnecting and return to the sign-in screen instead.
const SESSION_REVOKED_CLOSE_CODE = 4401;
const DM_RATE_LIMIT = readEnvInt('DM_RATE_LIMIT', 30, 0);
const DM_RATE_WINDOW_MS = readEnvInt('DM_RATE_WINDOW_MS', 10000, 1000);
const FRIEND_REQUEST_RATE_LIMIT = readEnvInt('FRIEND_REQUEST_RATE_LIMIT', 20, 0);
const FRIEND_REQUEST_RATE_WINDOW_MS = readEnvInt('FRIEND_REQUEST_RATE_WINDOW_MS', 60000, 1000);
const RING_RATE_LIMIT = readEnvInt('RING_RATE_LIMIT', 1, 0);
const RING_RATE_WINDOW_MS = readEnvInt('RING_RATE_WINDOW_MS', 30000, 1000);
const RING_TTL_MS = readEnvInt('RING_TTL_MS', 30000, 1000);
const AVATAR_UPLOAD_RATE_LIMIT = readEnvInt('AVATAR_UPLOAD_RATE_LIMIT', 10, 0);
const AVATAR_UPLOAD_RATE_WINDOW_MS = readEnvInt('AVATAR_UPLOAD_RATE_WINDOW_MS', 60000, 1000);
const PUSH_SUBSCRIPTION_RATE_LIMIT = readEnvInt('PUSH_SUBSCRIPTION_RATE_LIMIT', 20, 0);
const PUSH_SUBSCRIPTION_RATE_WINDOW_MS = readEnvInt('PUSH_SUBSCRIPTION_RATE_WINDOW_MS', 60000, 1000);
const MAX_PUSH_SUBSCRIPTIONS_PER_USER = readEnvInt('MAX_PUSH_SUBSCRIPTIONS_PER_USER', 10, 1);
// Browser log intake is off unless an operator turns it on: it is a public
// write path into the log stream, so it stays opt-in per environment.
const CLIENT_LOG_INTAKE_ENABLED = readEnvBool('CLIENT_LOG_INTAKE_ENABLED', false);
const CLIENT_LOG_RATE_LIMIT = readEnvInt('CLIENT_LOG_RATE_LIMIT', 6, 0);
const CLIENT_LOG_RATE_WINDOW_MS = readEnvInt('CLIENT_LOG_RATE_WINDOW_MS', 60000, 1000);
// Cap concurrent realtime (WebSocket) connections per user so a single account
// cannot pin an unbounded number of keep-alive connections.
const MAX_REALTIME_STREAMS_PER_USER = readEnvInt('MAX_REALTIME_STREAMS_PER_USER', 8, 1);
const MAX_GUEST_STREAMS_PER_IP = readEnvInt('MAX_GUEST_STREAMS_PER_IP', 8, 1);
const WS_MAX_PAYLOAD_BYTES = readEnvInt('WS_MAX_PAYLOAD_BYTES', 64 * 1024, 1024);
const RETENTION_PURGE_INTERVAL_MS = readEnvInt('RETENTION_PURGE_INTERVAL_MS', 60 * 60 * 1000, 0);
const RETENTION_KEEP_DELETED_MS = readEnvInt('RETENTION_KEEP_DELETED_MS', 30 * 24 * 60 * 60 * 1000, 60000);
// Off unless configured: a link preview makes the API open a URL a user posted.
const LINK_PREVIEWS_ENABLED = readEnvBool('LINK_PREVIEWS_ENABLED', false);
const MESSAGE_DELIVERY_MODE = readMessageDeliveryMode();
const MESSAGE_DIRECT_EMIT_ENABLED = MESSAGE_DELIVERY_MODE.directEmitEnabled;
const MESSAGE_DELIVERY_LISTEN_ENABLED = readEnvBool('MESSAGE_DELIVERY_LISTEN_ENABLED', true);
// Desktop app downloads are served from the latest GitHub release of this repo.
// Metadata is cached server-side so visitors never hit GitHub's per-IP rate limit.
const DESKTOP_RELEASE_REPO = (process.env.DESKTOP_RELEASE_REPO || 'dazeGG/VoiceRoomDesktop').trim();
const DESKTOP_RELEASE_CACHE_MS = readEnvInt('DESKTOP_RELEASE_CACHE_MS', 600000, 1000);
const DESKTOP_RELEASE_TIMEOUT_MS = readEnvInt('DESKTOP_RELEASE_TIMEOUT_MS', 6000, 1000);

function resolveRealtimeReconnectLeaseMs(env = process.env) {
  const value = Number(env.REALTIME_RECONNECT_LEASE_MS);
  return Number.isInteger(value) && value >= 1000 && value <= 120000
    ? value
    : DEFAULT_REALTIME_RECONNECT_LEASE_MS;
}

let roomStore = null;
let userStore = null;
let geoLocator = null;
let friendStore = null;
let friendStoreInviteExpiryEnabled = false;
let notificationStore = null;
let pushStore = null;
let pushService = null;
let avatarStorage = null;
let messageService = null;
let historyServices = null;
let credentialBoundary = null;
let liveKitCredentialProvider = null;
let membershipPool = null;
let membershipServices = null;
let release250Pool = null;
let reactionServices = null;
let pinServices = null;
let notificationServices = null;
let moderationServices = null;
let mediaServices = null;
let activeBanService = null;
let messageDeliveryServices = null;

let wsRegistry = null;
let roomRuntime = null;
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
  invitations: () => (friendStoreInviteExpiryEnabled ? friendStore : null),
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
const broadcastUserProfileToFriends = (user, request) => accountLifecycle.broadcastProfileToFriends(user, request?.log);

// Work that runs outside a request (timers, listeners, background dispatch)
// still has to be searchable next to the requests it was triggered by, so it
// logs through one process logger with the same base fields and redaction
// instead of falling back to console.
let processLogger = null;

function getProcessLogger() {
  return (processLogger ||= createLogger({ name: 'api' }));
}

// createApiApp builds a fresh Fastify logger per app; background work adopts it
// so a test harness and the real process agree on the destination.
function setProcessLogger(logger) {
  processLogger = logger || null;
}

function getRoomStore() {
  if (!roomStore) {
    roomStore = createRoomStore({
      roomIdleTtlMs: ROOM_IDLE_TTL_MS
    });
  }
  return roomStore;
}

function getUserStore() {
  if (!userStore) {
    userStore = createUserStore({ sessionTtlMs: SESSION_TTL_MS });
  }
  return userStore;
}

function getGeoLocator() {
  if (!geoLocator) {
    geoLocator = createGeoLocator({ databasePath: GEOIP_DB_PATH });
  }
  return geoLocator;
}

function getFriendStore() {
  if (!friendStore) {
    friendStore = createFriendStore({});
  }
  return friendStore;
}

function getMessageService() {
  if (!messageService) {
    messageService = createMessageService({
      directMessages: createDirectMessageRepository({ store: getFriendStore() }),
      roomMessages: createRoomMessageRepository({ store: getRoomStore() }),
      visibility: createMessageVisibilityService()
    });
  }
  return messageService;
}

function resolveCursorHmacKeys({ context, env = process.env } = {}) {
  const configured = env.VOICE_ROOM_CURSOR_HMAC_KEYS
    || env.CURSOR_HMAC_KEYS
    || env.CURSOR_HMAC_KEY;
  if (configured) return configured;

  if (env.NODE_ENV === 'production') {
    throw new Error('VOICE_ROOM_CURSOR_HMAC_KEYS is required in production');
  }

  const liveKitGateSecret = typeof env.LIVEKIT_GATE_SECRET === 'string'
    ? env.LIVEKIT_GATE_SECRET.trim()
    : LIVEKIT_GATE_SECRET;
  if (liveKitGateSecret.length >= 32) return `${liveKitGateSecret}:${context}-cursors`;

  const developmentSeed = context === 'membership' ? 'voice-room-development-membership' : 'voice-room-development-cursors';
  return crypto.createHash('sha256').update(String(env.POW_SECRET || developmentSeed)).digest('hex');
}

function getHistoryServices() {
  if (!historyServices) {
    const cursorCodec = createCursorCodec({ keys: resolveCursorHmacKeys({ context: 'history' }) });
    const visibilityPolicy = createMessageVisibilityService();
    historyServices = {
      cursorCodec,
      dm: createDmHistoryService({
        cursorCodec,
        repository: createDmHistoryRepository(),
        projectMessage: async ({ message, peerId, userId }) => {
          const projected = await attachMediaProjection('dm', message);
          if (!projected.replyTo?.messageId) return projected;
          const replies = createReplyRepository({ client: getRelease250Pool() });
          return {
            ...projected,
            replyPreview: await replies.getDirectPreview({
              userId,
              peerId,
              messageId: projected.replyTo.messageId
            })
          };
        },
        visibilityPolicy
      }),
      room: createRoomHistoryService({
        cursorCodec,
        repository: createRoomHistoryRepository(),
        projectMessage: async ({ message, roomId }) => {
          const projected = await attachMediaProjection('room', message);
          if (!projected.replyTo?.messageId) return projected;
          const replies = createReplyRepository({ client: getRelease250Pool() });
          return {
            ...projected,
            replyPreview: await replies.getRoomPreview({
              roomId,
              messageId: projected.replyTo.messageId
            })
          };
        },
        visibilityPolicy
      }),
      read: createMessageReadService({
        authorizeRoomRead: ({ roomId, userId }) => getRoomStore().canUserReadRoomChat(roomId, userId),
        cursorCodec,
        repository: createMessageReadRepository()
      })
    };
  }
  return historyServices;
}

function release250FeatureEnabled(name) {
  try {
    return readinessProvider.getSnapshot()?.features?.[name] === true;
  } catch {
    return false;
  }
}

function getRelease250Pool() {
  const databaseUrl = typeof process.env.DATABASE_URL === 'string' ? process.env.DATABASE_URL.trim() : '';
  if (!databaseUrl) return null;
  release250Pool = release250Pool || createRelease250Pool({ databaseUrl });
  return release250Pool;
}

let accountDeletionRepository = null;

function getAccountDeletionRepository() {
  if (accountDeletionRepository) return accountDeletionRepository;
  const pool = getRelease250Pool();
  if (!pool) return null;
  accountDeletionRepository = createAccountDeletionRepository({ pool });
  return accountDeletionRepository;
}

function getReactionServices() {
  if (reactionServices) return reactionServices;
  const pool = getRelease250Pool();
  if (!pool) return null;
  const realtime = createReactionRealtimeAdapter({
    broadcastRoom: async (roomId, event) => {
      const room = await getRoom(roomId);
      if (!room) return false;
      roomRuntime?.broadcastRoomDetail(roomId, event);
      return true;
    },
    broadcastAccount: broadcastToUser,
    resolveDirectRecipients: ({ actorUserId, conversation }) => [actorUserId, conversation.id]
  });
  const service = createReactionService({
    repository: createReactionRepository({ client: pool }),
    cursorCodec: getHistoryServices().cursorCodec,
    requireVisible: async ({ conversation, messageId, viewer, operation }) => {
      if (conversation.type === 'room') {
        const message = await getMessageService().room.getMessage(conversation.id, messageId);
        if (!message) return false;
        if (operation === 'read' && !viewer?.id) return Boolean(await getRoom(conversation.id));
        if (!viewer?.id) return false;
        return operation === 'read'
          ? getRoomStore().canUserReadRoomChat(conversation.id, viewer.id)
          : getRoomStore().canUserReactInRoom(conversation.id, viewer.id);
      }
      if (!viewer?.id) return false;
      return Boolean(await getMessageService().direct.getMessage(viewer.id, conversation.id, messageId));
    },
    writesEnabled: () => release250FeatureEnabled('reactions'),
    publish: realtime.publish
  });
  reactionServices = { realtime, service };
  return reactionServices;
}

function getPinServices() {
  if (pinServices) return pinServices;
  const pool = getRelease250Pool();
  if (!pool) return null;
  const service = createPinService({
    repository: createPinRepository({ client: pool }),
    // Everyone watching the room detail stream needs the new pin list: the
    // pinned bar is shared state, not a per-viewer projection.
    publish: async ({ roomId, action, messageId, pins, count }) => {
      const room = await getRoom(roomId);
      if (!room) return false;
      roomRuntime?.broadcastRoomDetail(roomId, {
        type: 'room.pins',
        payload: { roomId, action, messageId, pins, count }
      });
      return true;
    }
  });
  pinServices = { service };
  return pinServices;
}

async function refreshPinsAfterMessageMutation(roomId, action, messageId) {
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

function getMessageDeliveryServices() {
  if (messageDeliveryServices) return messageDeliveryServices;
  const pool = getRelease250Pool();
  if (!pool) return null;
  messageDeliveryServices = {
    idempotency: createMessageIdempotencyRepository(),
    outbox: createMessageOutboxRepository({ pool })
  };
  return messageDeliveryServices;
}

function getNotificationServices() {
  if (notificationServices) return notificationServices;
  const pool = getRelease250Pool();
  if (!pool) return null;
  const inbox = createInboxRepository({ pool });
  const mentions = createMentionRepository({ pool });
  const eligibility = createMentionEligibilityService({ activeBanService: getActiveBanService(), pool });
  const outbox = createNotificationOutboxRepository({ pool });
  const service = createNotificationService({
    pool,
    inbox,
    mentions,
    eligibility,
    outbox,
    cursorCodec: getHistoryServices().cursorCodec,
    notificationStore: getNotificationStore()
  });
  notificationServices = { eligibility, inbox, mentions, outbox, service };
  return notificationServices;
}

function getModerationServices() {
  if (moderationServices) return moderationServices;
  const pool = getRelease250Pool();
  if (!pool) return null;
  const repository = createModerationRepository({ cursorCodec: getHistoryServices().cursorCodec, pool });
  const service = createModerationService({
    pool,
    repository,
    maxActiveBans: MAX_ROOM_BANS,
    resolvePrincipals: async ({ roomId, userId, guestIp }) => {
      if (userId) {
        const principal = getRoomStore().normalizeGatePrincipal({ accountUserId: userId, roomId });
        return isGatePrincipal(principal) ? [principal] : [];
      }
      const room = await getRoom(roomId);
      if (!room || !guestIp) return [];
      return [...room.peers.values()]
        .filter((peer) => !peer.accountUserId && peer.ip === guestIp)
        .map((peer) => liveKitGatePrincipalForPeer(roomId, peer))
        .filter(isGatePrincipal);
    },
    revokePrincipalInTransaction: ({ client, principal, roomId, now }) => (
      getRoomStore().revokeLiveKitGatePrincipalInTransaction(client, { principal, roomId, now })
    ),
    afterBanCommitted: async ({ roomId, userId, guestIp }) => {
      const room = await getRoom(roomId);
      if (!room) return;
      const peers = [...room.peers.values()].filter((peer) => userId
        ? peer.accountUserId === userId
        : Boolean(guestIp && !peer.accountUserId && peer.ip === guestIp));
      for (const peer of peers) {
        await disconnectModeratedPeer(room, peer, 'room.banned', { gateAlreadyRevoked: true });
      }
    }
  });
  const messageService = createMessageModerationService({
    pool,
    moderationService: service,
    attachmentRepository: createAttachmentRepository({ pool }),
    mediaJobRepository: createMediaJobRepository({ pool }),
    publishMessageDeleted: async ({ roomId, messageId, deletedAt }) => {
      const room = await getRoom(roomId);
      if (!room) return;
      broadcast(room, { type: 'chat-message-deleted', messageId, deletedAt });
    }
  });
  moderationServices = { messageService, repository, service };
  return moderationServices;
}

function getActiveBanService() {
  if (activeBanService) return activeBanService;
  const pool = getRelease250Pool();
  if (!pool) return null;
  activeBanService = createActiveBanService({ pool });
  return activeBanService;
}

function getMediaServices() {
  if (mediaServices) return mediaServices;
  const pool = getRelease250Pool();
  if (!pool) return null;
  const storage = createMediaStorage({ rootDir: process.env.MEDIA_STORAGE_DIR || '/data/media' });
  const pressure = createMediaPressureService({
    storagePath: storage.root,
    minFreeBytes: readEnvInt('MEDIA_MIN_FREE_BYTES', 2 * 1024 * 1024 * 1024, 1),
    replicaConsensus: () => readinessProvider.getSnapshot()?.replicaConsensus === true,
    onSnapshot: recordMediaPressure
  });
  const attachments = createAttachmentRepository({ pool });
  const jobs = createMediaJobRepository({ pool });
  const quotaRepository = createMediaQuotaRepository({ attachmentRepository: attachments, pool });
  const quota = createMediaQuotaService({ attachmentRepository: attachments, quotaRepository });
  const service = createMediaService({
    attachmentRepository: attachments,
    jobRepository: jobs,
    pressureService: pressure,
    quotaService: quota,
    storage
  });
  const visibility = createMediaVisibilityService({
    attachmentRepository: attachments,
    storage,
    authorizeRoomAttachment: async ({ attachment, viewerId }) => {
      if (!attachment.roomMessageId) return false;
      const result = await pool.query(
        `SELECT room.id AS room_id
         FROM room_messages message
         JOIN rooms room ON room.id = message.room_id AND room.deleted_at IS NULL
         JOIN room_memberships membership ON membership.room_id = room.id AND membership.user_id = $2
         WHERE message.id = $1 AND message.deleted_at IS NULL
           AND (message.expires_at IS NULL OR message.expires_at > current_timestamp)
         LIMIT 1`,
        [attachment.roomMessageId, viewerId]
      );
      if (result.rowCount !== 1) return false;
      return !await getActiveBanService().isBanned({ roomId: result.rows[0].room_id, userId: viewerId });
    },
    authorizeDirectAttachment: async ({ attachment, viewerId }) => {
      if (!attachment.directMessageId) return false;
      const result = await pool.query(
        `SELECT 1 FROM direct_messages
         WHERE id = $1 AND deleted_at IS NULL
           AND (sender_id = $2 OR recipient_id = $2)
         LIMIT 1`,
        [attachment.directMessageId, viewerId]
      );
      return result.rowCount === 1;
    },
    onAuthorizationInvariantFailure: recordMediaAuthorizationInvariantFailure
  });
  mediaServices = { attachments, jobs, pressure, quota, service, storage, visibility };
  return mediaServices;
}

function getCredentialBoundary() {
  if (credentialBoundary) return credentialBoundary;
  if (LIVEKIT_GATE_SECRET.length < 32) return null;
  const store = getRoomStore();
  if (
    typeof store.getLiveKitGatePrincipalEpoch !== 'function'
    || typeof store.createLiveKitGateCredential !== 'function'
    || typeof store.verifyLiveKitGateCredential !== 'function'
    || (
      typeof store.revokeLiveKitGatePrincipal !== 'function'
      && typeof store.revokeLiveKitGatePeer !== 'function'
    )
  ) {
    return null;
  }
  credentialBoundary = createCredentialBoundaryService({
    roomStore: store,
    secret: LIVEKIT_GATE_SECRET,
    credentialTtlMs: LIVEKIT_GATE_CREDENTIAL_TTL_SECONDS * 1000
  });
  return credentialBoundary;
}

function getLiveKitCredentialProvider() {
  if (liveKitCredentialProvider) return liveKitCredentialProvider;
  const boundary = getCredentialBoundary();
  const livekit = getLiveKitConfig();
  if (!boundary || !livekit.enabled) return null;
  liveKitCredentialProvider = createLiveKitCredentialProvider({
    apiKey: livekit.apiKey,
    apiSecret: livekit.apiSecret,
    boundary,
    gateUrl: livekit.gateUrl,
    tokenTtlSeconds: LIVEKIT_TOKEN_TTL_SECONDS
  });
  return liveKitCredentialProvider;
}

function membershipCursorCodec() {
  return createCursorCodec({ keys: resolveCursorHmacKeys({ context: 'membership' }) });
}

function roomMembershipPresenceSnapshot(roomId) {
  const room = presenceRooms.get(roomId);
  return buildRoomMembershipPresenceSnapshot(roomId, room, wsRegistry);
}

function getMembershipServices() {
  if (membershipServices) return membershipServices;
  const databaseUrl = typeof process.env.DATABASE_URL === 'string' ? process.env.DATABASE_URL.trim() : '';
  if (!databaseUrl) return null;
  membershipPool = membershipPool || createRelease250Pool({ databaseUrl });
  const repository = createMembershipRepository({ pool: membershipPool });
  const service = createMembershipService({
    pool: membershipPool,
    repository,
    activeBanService: {
      isBanned: ({ roomId, userId, ip }) => findRoomBan(roomId, userId, ip)
    }
  });
  const directory = createMemberDirectoryService({
    membershipService: service,
    repository,
    cursorCodec: membershipCursorCodec(),
    getPresenceSnapshot: roomMembershipPresenceSnapshot
  });
  membershipServices = { directory, repository, service };
  return membershipServices;
}

function getNotificationStore() {
  if (!notificationStore) {
    notificationStore = createNotificationStore({});
  }
  return notificationStore;
}

function getPushStore() {
  if (!pushStore) pushStore = createPushStore({ maxSubscriptionsPerUser: MAX_PUSH_SUBSCRIPTIONS_PER_USER });
  return pushStore;
}

function getPushService() {
  if (!pushService) pushService = createPushService({ store: getPushStore() });
  return pushService;
}

function getAvatarStorage() {
  if (!avatarStorage) avatarStorage = createAvatarStorage();
  return avatarStorage;
}

let linkPreviewStorage = null;
let linkPreviewService = null;

function getLinkPreviewStorage() {
  if (!linkPreviewStorage) linkPreviewStorage = createLinkPreviewStorage();
  return linkPreviewStorage;
}

function getLinkPreviewService() {
  if (!LINK_PREVIEWS_ENABLED) return null;
  if (linkPreviewService) return linkPreviewService;
  const pool = getRelease250Pool();
  if (!pool) return null;
  linkPreviewService = createLinkPreviewService({
    repository: createLinkPreviewRepository({ pool }),
    fetcher: createLinkPreviewFetcher(),
    storage: getLinkPreviewStorage(),
    processImage: processLinkPreviewImage,
    onRoomPreview: broadcastRoomLinkPreview,
    onDirectPreview: broadcastDirectLinkPreview
  });
  return linkPreviewService;
}

function isUserOnline(userId) {
  return Boolean(wsRegistry?.isUserOnline(userId));
}

function broadcastToUser(userId, message) {
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
let admissionService = null;
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
      wsRegistry.unregisterConnectionForRoom(connection, roomId);
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
  revokeForServerMute: (input) => admissionService.revokeForServerMute(input),
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

function liveKitGatePrincipalForPeer(roomId, peer) {
  return gatePrincipalForPeer(getRoomStore(), roomId, peer);
}
const desktopReleaseService = createDesktopReleaseService({
  repo: DESKTOP_RELEASE_REPO,
  cacheMs: DESKTOP_RELEASE_CACHE_MS,
  timeoutMs: DESKTOP_RELEASE_TIMEOUT_MS,
  githubToken: (process.env.GITHUB_TOKEN || '').trim() || undefined,
  logger: { warn: (...args) => getProcessLogger().warn(...args) }
});
const clientLogLimiter = createRateLimiter({
  limit: CLIENT_LOG_RATE_LIMIT,
  windowMs: CLIENT_LOG_RATE_WINDOW_MS
});

function getLiveKitConnectSources() {
  const url = cleanLiveKitUrl(LIVEKIT_GATE_PUBLIC_URL || process.env.LIVEKIT_URL || '');
  if (!url) return [];

  const sources = new Set();
  try {
    const parsed = new URL(url);
    sources.add(parsed.origin);
    if (parsed.hostname === 'localhost') {
      parsed.hostname = '127.0.0.1';
      sources.add(parsed.origin);
    } else if (parsed.hostname === '127.0.0.1') {
      parsed.hostname = 'localhost';
      sources.add(parsed.origin);
    }
  } catch {
    // Ignore a malformed LIVEKIT_URL; the client will surface the connection error.
  }
  return [...sources];
}

function baseHeaders() {
  const connectSrc = [
    "'self'",
    ...getLiveKitConnectSources(),
    ...(process.env.NODE_ENV === 'production' ? [] : ['ws://localhost:7880', 'ws://127.0.0.1:7880']),
    'stun:',
    'turn:',
    'turns:'
  ].join(' ');

  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      "base-uri 'none'",
      `connect-src ${connectSrc}`,
      "font-src 'self'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      // blob: serves local-only previews (avatar crop) rendered via object URLs.
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "object-src 'none'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self'"
    ].join('; '),
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'microphone=(self), display-capture=(self), camera=(), geolocation=(), payment=()',
    'Referrer-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff'
  };
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, {
    ...baseHeaders(),
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function getSessionToken(req) {
  return sessionCookies.read(req);
}

async function resolveSessionUser(req) {
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

async function resolveOptionalSessionUser(req) {
  if (!getSessionToken(req)) return null;
  const session = await resolveSessionUser(req);
  return session?.user || null;
}

function sessionAvatarColorKey(user) {
  return user?.avatarColorKey || '';
}

function sessionDisplayName(user) {
  if (!user) return '';
  return cleanName(user.displayName || user.login);
}

function sessionChatPeerId(user) {
  return accountPeerIdFor(user?.id);
}

function getLiveKitRoomName(roomId) {
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

function startPruneTimer(server, logger = getProcessLogger()) {
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
        run: () => getLinkPreviewService().pruneExpired()
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

async function getRoom(roomId) {
  const room = await getRoomStore().getRoom(roomId);
  if (!room) return null;
  room.updatedAt = Date.now();
  return attachPresence(room);
}

async function findRoomBan(roomId, userId, ip) {
  if (!roomId) return null;
  const service = getActiveBanService();
  if (service) return service.getActiveBan({ roomId, userId: userId || null, ip: ip || '' });
  if (typeof getRoomStore().findActiveRoomBan !== 'function') return null;
  return getRoomStore().findActiveRoomBan({ roomId, userId: userId || null, ip: ip || '' });
}


function getApiRoutePath(pathname) {
  if (pathname === API_PREFIX) return '/';
  if (pathname.startsWith(`${API_PREFIX}/`)) return pathname.slice(API_PREFIX.length);
  return null;
}

function attachFastifyRequestBody(request) {
  request.raw.body = request.body;
  // Legacy handlers receive the raw Node request, which carries neither the
  // request id nor a logger. Both are attached here so any handler can emit a
  // record that correlates with the request line, without threading the
  // Fastify request through every signature.
  request.raw.id = request.id;
  request.raw.log = request.log;
  return request.raw;
}

function getRequestRouteLabel(request) {
  return request.routeOptions?.url || request.routerPath || request.url || 'unknown';
}

function logHttpRequest(request, statusCode, durationMs) {
  const route = getRequestRouteLabel(request);
  if (route === '/api/healthz') return;
  // A slow or failed request is the one worth finding later, so it is raised
  // above the steady-state info stream rather than being counted only in the
  // Prometheus histogram.
  const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
  request.log?.[level]?.({
    evt: LOG_EVENTS.HTTP_REQUEST,
    method: request.method,
    route,
    statusCode,
    userId: request.raw?.voiceRoomUserId || undefined,
    ipHash: hashIp(getClientIp(request.raw || request, TRUST_PROXY)),
    durationMs: Math.round(durationMs * 100) / 100
  }, 'request completed');
}

async function runLegacyHandler(request, reply, handler) {
  reply.hijack();
  const req = attachFastifyRequestBody(request);
  const res = reply.raw;
  const startedAt = process.hrtime.bigint();
  const route = getRequestRouteLabel(request);

  res.once('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    recordHttpRequest({
      method: request.method,
      route,
      statusCode: res.statusCode,
      durationMs
    });
    logHttpRequest(request, res.statusCode, durationMs);
  });

  try {
    await handler(req, res, request);
  } catch (error) {
    const status = error.statusCode || 500;
    const message = error.publicMessage || (status >= 500 ? 'Internal server error' : error.message);
    if (status >= 500) {
      request.log?.error?.({
        evt: LOG_EVENTS.HTTP_HANDLER_FAILED,
        route,
        err: error
      }, 'legacy handler failed');
    }
    if (!res.headersSent) {
      sendJson(res, status, { ok: false, error: message });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
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
} = {}) {
  if (store && store !== roomStore) {
    roomPresence.reset();
  }
  if (store) roomStore = store;
  if (users) userStore = users;
  friendStoreInviteExpiryEnabled = Boolean(friends?.expirePendingInvites);
  if (friends) friendStore = friends;
  messageService = null;
  historyServices = null;
  credentialBoundary = null;
  liveKitCredentialProvider = liveKitCredentials;
  membershipServices = membershipServicesOverride;
  reactionServices = null;
  pinServices = null;
  notificationServices = null;
  moderationServices = null;
  mediaServices = null;
  activeBanService = null;
  messageDeliveryServices = null;
  if (notifications) notificationStore = notifications;
  pushStore = pushes || null;
  pushService = push || null;
  if (avatars) avatarStorage = avatars;

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
  // It goes on the raw response because legacy handlers hijack the reply and
  // write to that themselves: a header set on the Fastify reply would be
  // dropped for nearly every route.
  app.addHook('onRequest', (request, reply, done) => {
    reply.raw.setHeader('x-request-id', request.id);
    done();
  });

  // Origin checks run for every route, not only the legacy handlers: the
  // domain routes (bans, memberships, media, notifications, reactions, pins)
  // mutate state with the same session cookie.
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
    clientIp: (req) => getClientIp(req, TRUST_PROXY),
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
    getNotificationStore,
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
    pow,
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
    pow,
    powDifficulty: ROOM_CREATE_POW_DIFFICULTY,
    powTtlMs: ROOM_CREATE_POW_TTL_MS,
    clientLogs: { enabled: CLIENT_LOG_INTAKE_ENABLED, limiter: clientLogLimiter },
    desktopRelease: desktopReleaseService
  });

  registerCapabilityRoutes({
    app,
    readinessProvider: activeReadinessProvider,
    runLegacyHandler
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
      prepareLeave: ({ roomId, user }) => roomRuntime.disconnectAccountFromRoom({ roomId, userId: user.id }),
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
        && await getRoomStore().canUserReadRoomChat(roomId, session.user.id);
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
          && await getRoomStore()[action === 'write' ? 'canUserReactInRoom' : 'canUserReadRoomChat'](roomId, viewer.id);
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

function createApiServer(options = {}) {
  const app = createApiApp(options);
  const server = app.server;
  const listen = server.listen.bind(server);
  server.app = app;
  server.inject = app.inject.bind(app);
  server.listen = (...args) => {
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
  };
  server.once('close', () => roomPresence.clearOccupancyRetries());
  return server;
}

async function closeStores(logger = getProcessLogger()) {
  await Promise.allSettled([
    roomStore?.close?.(),
    userStore?.close?.(),
    friendStore?.close?.(),
    notificationStore?.close?.(),
    pushStore?.close?.(),
    membershipPool?.end?.()
  ]).then((results) => {
    for (const result of results) {
      if (result.status === 'rejected') logger.error({ evt: LOG_EVENTS.STORE_CLOSE_FAILED, err: result.reason }, 'failed to close a store');
    }
  });
  membershipPool = null;
  membershipServices = null;
}

function installGracefulShutdown(server, { logger = getProcessLogger(), exit = process.exit, timeoutMs = 8000 } = {}) {
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ evt: LOG_EVENTS.SHUTDOWN_STARTED, signal }, 'shutting down gracefully');
    const timeout = setTimeout(() => {
      logger.error({ evt: LOG_EVENTS.SHUTDOWN_TIMEOUT, timeoutMs }, 'graceful shutdown timed out; exiting');
      exit(1);
    }, timeoutMs);
    if (typeof timeout.unref === 'function') timeout.unref();

    try {
      for (const connection of wsRegistry?.connections?.values?.() || []) {
        try {
          connection.socket.close(1001, 'Going away');
        } catch {
          // Ignore close failures while draining.
        }
      }
      await new Promise((resolve) => server.close(resolve));
      await closeStores(logger);
      clearTimeout(timeout);
      exit(0);
    } catch (error) {
      clearTimeout(timeout);
      logger.error({ evt: LOG_EVENTS.SHUTDOWN_FAILED, err: error }, 'graceful shutdown failed');
      exit(1);
    }
  }

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

async function bootstrap({ env = process.env, logger = createLogger({ env, name: 'api' }), exit = process.exit } = {}) {
  try {
    const database = readDatabaseConfig(env);
    if (readEnvBool('MIGRATE_ON_START', env.NODE_ENV !== 'production', env)) {
      await runMigrations({ databaseUrl: database.url, logger });
    }
    if (env.NODE_ENV === 'production') {
      await assertMigrationReady({ databaseUrl: database.url });
    }
    roomStore = createRoomStore({
      databaseUrl: database.url,
      logger,
      roomIdleTtlMs: ROOM_IDLE_TTL_MS
    });
    await roomStore.markActiveTemporaryRoomsEmpty();
    await roomStore.pruneRooms();
    userStore = createUserStore({ databaseUrl: database.url, logger, sessionTtlMs: SESSION_TTL_MS });
    friendStore = createFriendStore({ databaseUrl: database.url, logger });
    messageService = null;
    notificationStore = createNotificationStore({ databaseUrl: database.url, logger });
    pushStore = createPushStore({
      databaseUrl: database.url,
      logger,
      maxSubscriptionsPerUser: readEnvInt('MAX_PUSH_SUBSCRIPTIONS_PER_USER', 10, 1, env)
    });
    pushService = createPushService({ store: pushStore, env, logger });
    avatarStorage = createAvatarStorage({ uploadsDir: readUploadsDir(env) });
    const reconciliation = await reconcileAvatarStorage({
      storage: avatarStorage,
      userStore,
      roomStore
    });
    if (reconciliation.removed > 0) {
      logger.info({ evt: LOG_EVENTS.MAINTENANCE_TASK_COMPLETED, task: 'avatar-reconciliation', removed: reconciliation.removed }, 'removed orphaned avatar files');
    }
    linkPreviewStorage = createLinkPreviewStorage({ uploadsDir: readUploadsDir(env) });
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
    installGracefulShutdown(server, { logger, exit });
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
