import crypto from 'node:crypto';
import fastify, { LogController } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyWebsocket from '@fastify/websocket';
import { buildRoomMembershipPresenceSnapshot, createConnectionRegistry } from './realtime/registry.js';
import { createWsHandler } from './realtime/ws-handler.js';
import { clearViewedScreenPeerReferences, createRoomRealtimeRuntime, resolveViewedScreenPeerId } from './realtime/room-runtime.js';
import { buildServerEnvelope } from './realtime/envelope.js';
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
  cleanDisplayName,
  cleanStreamId,
  cleanScreenProfileId,
  cleanLiveKitUrl,
  cleanPresenceStatus,
  isValidPassword,
  normalizeLogin,
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
import { MAX_AVATAR_BYTES, createAvatarKey, processAvatar } from './lib/avatar-processing.js';
import { reconcileAvatarStorage } from './lib/avatar-reconciliation.js';
import { createAvatarStorage, validateAvatarKey } from './lib/avatar-storage.js';
import { firstPreviewableUrl } from '@voice-room/shared/link-preview';
import { createLinkPreviewFetcher } from './lib/link-preview-fetcher.js';
import { processLinkPreviewImage } from './lib/link-preview-image.js';
import { createLinkPreviewStorage, reconcileLinkPreviewImages } from './lib/link-preview-storage.js';
import { createLinkPreviewRepository } from './domains/link-previews/link-preview-repository.js';
import { createLinkPreviewService } from './domains/link-previews/link-preview-service.js';
import { avatarColorForPeerId, createRoomStore } from './lib/room-store.js';
import {
  createUserStore,
  hashSessionToken,
  publicUser,
  selfUser
} from './lib/user-store.js';
import { createGeoLocator } from './lib/geoip.js';
import {
  ACCOUNT_DELETION_GRACE_MS,
  WHATS_NEW_VERSION,
  formatRecoveryCode,
  isDeletedAccountLogin
} from '@voice-room/shared/account-security';
import { createAccountDeletionRepository } from './domains/account/account-deletion-repository.js';
import { createFriendStore } from './lib/friend-store.js';
import { createNotificationStore } from './lib/notification-store.js';
import { createPushStore } from './lib/push-store.js';
import { createPushService, resolvePushTtl, shouldDeliverPush } from './lib/push-service.js';
import { cleanPushEndpoint } from './lib/push-endpoint.js';
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
import { publicLobbyRoom as lobbyRoomView, publicPeer, roomBanned } from './domains/rooms/room-views.ts';
import { ownerRefusal, registerRoomRoutes } from './domains/rooms/rooms.routes.ts';
import { createRoomsService } from './domains/rooms/rooms.service.ts';
import { cleanUuid, messageFingerprint, normalizeAttachmentIds, requestIdempotencyKey } from './domains/messaging/message-input.ts';
import { publicChatMessage } from './domains/messaging/room-chat-views.ts';
import { registerRoomChatRoutes } from './domains/messaging/room-chat.routes.ts';
import { createRoomChatService } from './domains/messaging/room-chat.service.ts';
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
import { requireReplyTarget } from './domains/messaging/reply-projector.js';
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
let messageDeliveryListener = null;

const presenceRooms = new Map();
let wsRegistry = null;
let roomRuntime = null;
const roomOccupancyQueue = new Map();
const roomOccupancyRetries = new Map();
const ROOM_OCCUPANCY_RETRY_BASE_MS = 1000;
const ROOM_OCCUPANCY_RETRY_MAX_MS = 30000;

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

async function dispatchMessageDeliveryEvent(event) {
  if (!event || event.type !== 'message.created' || !event.message) return;
  if (event.conversation?.type === 'room') {
    const roomId = event.conversation.id;
    const projected = await attachReplyProjection(
      'room',
      await attachMediaProjection('room', event.message),
      { roomId }
    );
    roomRuntime?.broadcastChatMessage(roomId, publicChatMessage(projected));
    return;
  }
  if (event.conversation?.type === 'dm') {
    const message = event.message;
    const peerId = message.senderId === event.conversation.id ? message.recipientId : event.conversation.id;
    const projected = await attachReplyProjection(
      'dm',
      await attachMediaProjection('dm', message),
      { userId: message.senderId, peerId }
    );
    broadcastToUser(message.senderId, { type: 'dm-message', message: projected });
    broadcastToUser(message.recipientId, { type: 'dm-message', message: projected });
    // The direct-emit path notifies right after sending; the relayed path has to
    // do the same or DMs never raise a system notification.
    const sender = await getUserStore().getUserById(message.senderId).catch(() => null);
    if (sender) await broadcastDmNotification(message.recipientId, sender, projected);
  }
}

async function startMessageDeliveryListener() {
  if (!MESSAGE_DELIVERY_LISTEN_ENABLED || messageDeliveryListener) return;
  const pool = getRelease250Pool();
  const delivery = getMessageDeliveryServices();
  if (!pool || !delivery) return;
  const client = await pool.connect();
  const onNotification = (notification) => {
    if (notification.channel !== 'voice_room_message_delivery') return;
    void (async () => {
      const parsed = JSON.parse(notification.payload || '{}');
      const row = parsed.eventId ? await delivery.outbox.getEvent(parsed.eventId) : null;
      if (row?.payload) await dispatchMessageDeliveryEvent(row.payload);
    })().catch((error) => getProcessLogger().error({ evt: LOG_EVENTS.MESSAGE_EVENT_DISPATCH_FAILED, err: error }, 'failed to dispatch a durable message event'));
  };
  client.on('notification', onNotification);
  client.on('error', (error) => getProcessLogger().error({ evt: LOG_EVENTS.MESSAGE_LISTENER_FAILED, err: error }, 'message delivery listener failed'));
  await client.query('LISTEN voice_room_message_delivery');
  messageDeliveryListener = { client, onNotification };
}

async function stopMessageDeliveryListener() {
  const listener = messageDeliveryListener;
  messageDeliveryListener = null;
  if (!listener) return;
  listener.client.off('notification', listener.onNotification);
  await listener.client.query('UNLISTEN voice_room_message_delivery').catch(() => {});
  listener.client.release();
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

function publicAttachment(attachment) {
  return {
    id: attachment.id,
    context: attachment.context,
    order: attachment.order,
    mimeType: attachment.mimeType,
    bytes: attachment.processedBytes || attachment.originalBytes,
    width: attachment.width,
    height: attachment.height,
    state: attachment.state,
    url: attachment.state === 'ready' ? `/api/media/attachments/${encodeURIComponent(attachment.id)}/preview` : null
  };
}

async function attachMediaProjection(context, message) {
  const media = getMediaServices();
  if (!media || !message?.id) return { ...message, attachments: [] };
  const attachments = await media.attachments.listForMessage(context, message.id);
  return { ...message, attachments: attachments.map(publicAttachment) };
}

async function attachReplyProjection(context, message, { roomId, userId, peerId } = {}) {
  if (!message?.replyTo?.messageId) return message;
  const pool = getRelease250Pool();
  if (!pool) return message;
  const replies = createReplyRepository({ client: pool });
  const replyPreview = context === 'room'
    ? await replies.getRoomPreview({ roomId, messageId: message.replyTo.messageId })
    : await replies.getDirectPreview({ userId, peerId, messageId: message.replyTo.messageId });
  return { ...message, replyPreview };
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

// A preview reaches readers as an edit of the message, re-read in full so it
// carries its attachments and reply quote like any other copy of it.
async function broadcastRoomLinkPreview({ roomId, messageId }) {
  const message = await getMessageService().room.getMessage(roomId, messageId);
  if (!message) return;
  const projected = await attachReplyProjection('room', await attachMediaProjection('room', message), { roomId });
  roomRuntime?.broadcastRoomDetail?.(
    roomId,
    buildServerEnvelope('room.chat.edited', { roomId, message: publicChatMessage(projected) })
  );
}

async function broadcastDirectLinkPreview({ messageId, senderId, recipientId }) {
  const message = await getMessageService().direct.getMessage(senderId, recipientId, messageId);
  if (!message) return;
  const projected = await attachReplyProjection('dm', await attachMediaProjection('dm', message), {
    userId: senderId,
    peerId: recipientId
  });
  const event = { type: 'dm.message.edited', message: projected };
  broadcastToUser(recipientId, event);
  broadcastToUser(senderId, event);
}

// Previews are built after the reply was sent. A new message without a link
// needs no work; an edit always does, because it may have removed the link.
function scheduleRoomLinkPreview(roomId, messageId, text, { edited = false } = {}) {
  if (!edited && !firstPreviewableUrl(text)) return;
  getLinkPreviewService()?.scheduleRoomMessage({ roomId, messageId, text });
}

function scheduleDirectLinkPreview({ messageId, senderId, recipientId, text, edited = false }) {
  if (!edited && !firstPreviewableUrl(text)) return;
  getLinkPreviewService()?.scheduleDirectMessage({ messageId, senderId, recipientId, text });
}

function isUserOnline(userId) {
  return Boolean(wsRegistry?.isUserOnline(userId));
}

function broadcastToUser(userId, message) {
  if (!wsRegistry) return 0;
  return wsRegistry.broadcastAccountEvent(userId, message);
}

function notificationActor(user) {
  const actor = publicUser(user);
  if (!actor) return null;
  return {
    id: actor.id,
    displayName: actor.displayName,
    login: actor.login,
    avatarAccent: actor.avatarAccent,
    avatarColorKey: actor.avatarColorKey,
    avatarUrl: actor.avatarUrl
  };
}

async function queuePush(userId, payload, context = {}) {
  try {
    if (!getPushService().config.enabled) return;
    const preferences = await getNotificationStore().getPreferences(userId);
    // Security alerts reach the account even in do-not-disturb.
    if (!context.ignorePreferences && !shouldDeliverPush(preferences, context)) return;
    const body = preferences.privateNotifications && payload.privateBody
      ? payload.privateBody
      : payload.body;
    const { privateBody: _privateBody, ...publicPayload } = payload;
    const ttl = resolvePushTtl(context);
    if (ttl === null) return;
    const deliveryContext = ttl === undefined ? context : { ...context, ttl };
    await getPushService().sendToUser(userId, { ...publicPayload, body }, deliveryContext);
  } catch (error) {
    getProcessLogger().warn({ evt: LOG_EVENTS.PUSH_SEND_FAILED, userId, err: error }, 'failed to send a push notification');
  }
}

function sendFriendPush(userId, type, actor, dedupeKey) {
  void queuePush(userId, {
      type,
      title: type === 'friend.accepted' ? 'Заявка принята' : 'Новая заявка в друзья',
      body: actor.displayName || actor.login || 'VoiceRoom',
      privateBody: 'Откройте VoiceRoom, чтобы посмотреть событие.',
      tag: type,
      dedupeKey,
      url: '/'
    });
}

async function broadcastDmNotification(recipientUserId, sender, message) {
  if (!recipientUserId || recipientUserId === sender?.id) return 0;
  try {
    const preferences = await getNotificationStore().getPreferences(recipientUserId);
    if (preferences.mutedPeerIds.includes(sender.id)) return 0;
    const notification = {
      type: 'notification.dm.message',
      dedupeKey: `dm:${message.id}`,
      peer: notificationActor(sender),
      message: {
        id: message.id,
        body: message.body,
        createdAt: message.createdAt
      }
    };
    const broadcastCount = broadcastToUser(recipientUserId, notification);
    void queuePush(recipientUserId, {
      type: 'dm.message',
      title: sender.displayName || sender.login || 'Новое сообщение',
      body: message.body,
      privateBody: 'Откройте VoiceRoom, чтобы прочитать сообщение.',
      tag: `dm:${sender.id}`,
      dedupeKey: notification.dedupeKey,
      url: `/?dm=${encodeURIComponent(sender.id)}`
    }, { peerUserId: sender.id });
    return broadcastCount;
  } catch (error) {
    getProcessLogger().error({ evt: LOG_EVENTS.NOTIFICATION_BROADCAST_FAILED, err: error }, 'failed to broadcast a direct message notification');
    return 0;
  }
}

function getPresenceRoom(roomId) {
  let room = presenceRooms.get(roomId);
  if (!room) {
    room = { id: roomId, peers: new Map(), updatedAt: Date.now() };
    presenceRooms.set(roomId, room);
  }
  return room;
}

function attachPresence(dbRoom) {
  if (!dbRoom) return null;
  const presence = getPresenceRoom(dbRoom.id);
  if (dbRoom.peers instanceof Map && dbRoom.peers !== presence.peers) {
    for (const [peerId, peer] of dbRoom.peers) {
      if (!presence.peers.has(peerId)) presence.peers.set(peerId, peer);
    }
  }
  dbRoom.peers = presence.peers;
  return dbRoom;
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

function parseCookies(req) {
  const header = req.headers?.cookie;
  const cookies = {};
  if (typeof header !== 'string' || !header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      // Ignore malformed cookie values instead of failing auth checks with 500s.
    }
  }
  return cookies;
}

function getSessionToken(req) {
  return parseCookies(req)[SESSION_COOKIE_NAME] || '';
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

// What the signed-in devices list shows about a new session. The IP is only
// used for the local city/country lookup and is not stored.
async function sessionDeviceFor(req) {
  return {
    userAgent: String(req.headers?.['user-agent'] || ''),
    locationLabel: await getGeoLocator().locate(getClientIp(req, TRUST_PROXY))
  };
}

function describeLoginDevice(alert) {
  const device = [alert.client || 'Неизвестный браузер', alert.os].filter(Boolean).join(' · ');
  return alert.location ? `${device}, ${alert.location}` : device;
}

// Records a sign-in and, when it comes from an unfamiliar device or city, asks
// the account's other devices right away and by push. A failure here must not
// fail the sign-in itself.
async function recordAndAnnounceLogin({ userId, session, device, kind }) {
  try {
    const { alert } = await getUserStore().recordLogin({
      userId,
      sessionPublicId: session.publicId,
      kind,
      userAgent: device.userAgent,
      locationLabel: device.locationLabel
    });
    if (!alert) return;
    broadcastToUser(userId, { type: 'account.login.new', alert });
    void queuePush(userId, {
      type: 'account.login',
      title: kind === 'recovery' ? 'Вход по коду восстановления' : 'Новый вход в аккаунт',
      body: `${describeLoginDevice(alert)}. Если это были не вы, откройте Voice Room.`,
      tag: `login-alert:${alert.id}`,
      dedupeKey: `login-alert:${alert.id}`,
      url: '/'
    }, { ignorePreferences: true });
  } catch (error) {
    getProcessLogger().error({ evt: LOG_EVENTS.AUTH_SIGN_IN_RECORD_FAILED, userId, kind, err: error }, 'failed to record a sign-in');
  }
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

function buildSessionCookie(token, maxAgeSeconds) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`
  ];
  if (SESSION_COOKIE_SECURE) parts.push('Secure');
  return parts.join('; ');
}

function clearSessionCookie() {
  const parts = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (SESSION_COOKIE_SECURE) parts.push('Secure');
  return parts.join('; ');
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

async function pruneRooms(now = Date.now()) {
  // Reconcile every room that is known active in memory before the durable
  // idle-room sweep. If the database is still unavailable, fail the sweep
  // closed so an old empty_since marker cannot delete a live dynamic room.
  const activeRoomIds = [...presenceRooms.entries()]
    .filter(([, room]) => room?.peers?.size > 0)
    .map(([roomId]) => roomId);
  await Promise.all(activeRoomIds.map((roomId) => queueRoomOccupancyTransition(roomId)));
  await getRoomStore().pruneRooms(now);
  for (const roomId of [...presenceRooms.keys()]) {
    const room = await getRoomStore().getRoom(roomId);
    if (room) continue;
    presenceRooms.delete(roomId);
  }
}

function startPruneTimer(server, logger = getProcessLogger()) {
  // Reap WS connections whose clients stopped heartbeating (half-open sockets
  // never emit 'close'), otherwise dead peers linger in rosters and friends
  // stay "online" forever.
  const wsTimer = setInterval(() => {
    try {
      wsRegistry?.pruneStale();
    } catch (error) {
      logger.error({ evt: LOG_EVENTS.MAINTENANCE_TASK_FAILED, task: 'ws-prune', err: error }, 'ws prune timer failed');
    }
  }, KEEPALIVE_MS);
  if (typeof wsTimer.unref === 'function') wsTimer.unref();
  server.once('close', () => clearInterval(wsTimer));

  if (ROOM_PRUNE_INTERVAL_MS <= 0) return null;

  const timer = setInterval(() => {
    void observeMaintenance('room_prune', () => pruneRooms()).catch((error) => {
      logger.error({ evt: LOG_EVENTS.MAINTENANCE_TASK_FAILED, task: 'room-prune', err: error }, 'room prune timer failed');
    });
    void observeMaintenance('session_prune', () => getUserStore().pruneSessions())
      .catch((error) => {
        logger.error({ evt: LOG_EVENTS.MAINTENANCE_TASK_FAILED, task: 'session-prune', err: error }, 'session prune timer failed');
      });
    void observeMaintenance('login_event_prune', () => getUserStore().pruneLoginEvents())
      .catch((error) => {
        logger.error({ evt: LOG_EVENTS.MAINTENANCE_TASK_FAILED, task: 'sign-in-history-prune', err: error }, 'sign-in history prune timer failed');
      });
    void observeMaintenance('account_deletion_finalize', () => finalizeDueAccountDeletions())
      .catch((error) => {
        logger.error({ evt: LOG_EVENTS.MAINTENANCE_TASK_FAILED, task: 'account-deletion', err: error }, 'account deletion timer failed');
      });
    if (getLinkPreviewService()) {
      void observeMaintenance('link_preview_prune', () => getLinkPreviewService().pruneExpired())
        .catch((error) => {
          logger.error({ evt: LOG_EVENTS.MAINTENANCE_TASK_FAILED, task: 'link-preview-prune', err: error }, 'link preview prune timer failed');
        });
    }
    if (RETENTION_PURGE_INTERVAL_MS > 0 && getRoomStore().purgeDeleted) {
      void observeMaintenance('retention_purge', () => getRoomStore().purgeDeleted({ olderThanMs: RETENTION_KEEP_DELETED_MS }))
        .catch((error) => {
          logger.error({ evt: LOG_EVENTS.MAINTENANCE_TASK_FAILED, task: 'retention-purge', err: error }, 'retention purge timer failed');
        });
    }
  }, ROOM_PRUNE_INTERVAL_MS);

  if (typeof timer.unref === 'function') timer.unref();
  server.once('close', () => clearInterval(timer));
  return timer;
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

function sendRoomBanned(res, roomId) {
  sendJson(res, 403, roomBanned(roomId));
}

function queueRoomOccupancyTransition(roomId) {
  const previous = roomOccupancyQueue.get(roomId) || Promise.resolve();
  const transition = previous
    .catch(() => {})
    .then(async () => {
      const room = presenceRooms.get(roomId);
      if (room?.peers.size > 0) {
        await getRoomStore().markRoomActive(roomId, room.updatedAt || Date.now());
        return;
      }
      await getRoomStore().markRoomEmpty(roomId);
    });

  roomOccupancyQueue.set(roomId, transition);
  void transition.then(
    () => {
      if (roomOccupancyQueue.get(roomId) !== transition) return;
      roomOccupancyQueue.delete(roomId);
      clearRoomOccupancyRetry(roomId);
    },
    () => {
      if (roomOccupancyQueue.get(roomId) !== transition) return;
      roomOccupancyQueue.delete(roomId);
      scheduleRoomOccupancyRetry(roomId);
    }
  );
  return transition;
}

function clearRoomOccupancyRetry(roomId) {
  const retry = roomOccupancyRetries.get(roomId);
  if (!retry) return;
  if (retry.timer) clearTimeout(retry.timer);
  roomOccupancyRetries.delete(roomId);
}

function clearRoomOccupancyRetries() {
  for (const roomId of roomOccupancyRetries.keys()) clearRoomOccupancyRetry(roomId);
}

function scheduleRoomOccupancyRetry(roomId) {
  const current = roomOccupancyRetries.get(roomId);
  if (current?.timer) return;
  const attempt = (current?.attempt || 0) + 1;
  const delay = Math.min(
    ROOM_OCCUPANCY_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1),
    ROOM_OCCUPANCY_RETRY_MAX_MS
  );
  const retry = { attempt, timer: null };
  retry.timer = setTimeout(() => {
    if (roomOccupancyRetries.get(roomId) !== retry) return;
    retry.timer = null;
    void queueRoomOccupancyTransition(roomId).catch((error) => {
      getProcessLogger().error({ evt: LOG_EVENTS.ROOM_OCCUPANCY_RETRY_FAILED, err: error }, 'failed to retry room occupancy persistence');
    });
  }, delay);
  retry.timer?.unref?.();
  roomOccupancyRetries.set(roomId, retry);
}

function sendEvent(peer, message) {
  const sent = peer?.transport?.send(message) ?? false;
  if (!sent && peer) peer.closed = true;
  return sent;
}

// Delivers a legacy room event to active peers over their own transports.
// Preview-only WS subscribers are reached separately via mirrorLegacyRoomEvent
// at each call site, so nothing is double-delivered.
function broadcast(room, message, exceptPeerId = '') {
  const failedPeers = [];
  for (const peer of room.peers.values()) {
    if (peer.id !== exceptPeerId) {
      const sent = sendEvent(peer, message);
      if (!sent) failedPeers.push(peer);
    }
  }

  for (const peer of failedPeers) {
    closePeer(room.id, peer.id, peer.transport?.id, 'lost');
  }
  if (failedPeers.length > 0) {
    roomRuntime?.scheduleSummaryBroadcast(room.id);
  }
}

function publishClearedScreenViewers(room, ownerPeerId) {
  for (const viewer of clearViewedScreenPeerReferences(room, ownerPeerId)) {
    const message = { type: 'peer-updated', peer: publicPeer(viewer) };
    broadcast(room, message);
    roomRuntime?.mirrorLegacyRoomEvent(room.id, message);
  }
}

// senderId narrows the expiry to one inviter; pass null to expire every pending
// invitation for the room (used when the room itself goes away).
async function expireRoomInvitations(senderId, roomId) {
  if (!roomId) return [];
  if (!friendStoreInviteExpiryEnabled || typeof friendStore?.expirePendingInvites !== 'function') return [];
  const messages = await friendStore.expirePendingInvites({ senderId: senderId || null, roomId });
  for (const message of messages) {
    const event = { type: 'dm.message.edited', message };
    broadcastToUser(message.senderId, event);
    broadcastToUser(message.recipientId, event);
  }
  return messages;
}

function closePeer(roomId, peerId, transportId, reason = 'left') {
  const room = presenceRooms.get(roomId);
  if (!room) return;

  const current = room.peers.get(peerId);
  if (!current || !transportId || current.transport?.id !== transportId) return;

  current.closed = true;
  room.peers.delete(peerId);
  if (!current.replaced) {
    publishClearedScreenViewers(room, peerId);
    broadcast(room, { type: 'peer-left', peerId, reason });
    roomRuntime?.mirrorLegacyRoomEvent(roomId, { type: 'peer-left', peerId, reason });
    roomRuntime?.scheduleSummaryBroadcast(roomId);
  }

  if (room.peers.size === 0) {
    // The call ended: reset the in-memory call clock (never persisted).
    room.voiceActiveSince = null;
    void queueRoomOccupancyTransition(roomId).catch((error) => {
      getProcessLogger().error({ evt: LOG_EVENTS.ROOM_OCCUPANCY_PERSIST_FAILED, roomId, err: error }, 'failed to persist room occupancy');
    });
  } else {
    room.updatedAt = Date.now();
  }
}

async function readJsonBody(req) {
  if (req && Object.hasOwn(req, 'body')) {
    return req.body && typeof req.body === 'object' ? req.body : {};
  }

  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > BODY_LIMIT_BYTES) {
      const error = new Error('Request body is too large');
      error.statusCode = 413;
      throw error;
    }
  }

  try {
    return JSON.parse(body || '{}');
  } catch (error) {
    error.statusCode = 400;
    error.publicMessage = 'Invalid JSON';
    throw error;
  }
}

async function waitForRosterPeer(roomId, peerId, timeoutMs = LIVEKIT_ROSTER_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const peer = presenceRooms.get(roomId)?.peers?.get(peerId);
    if (peer || Date.now() >= deadline) return peer || null;
    await new Promise((resolve) => setTimeout(resolve, ROSTER_POLL_INTERVAL_MS));
  }
}

// Owner gate for the room avatar handlers that are still legacy. Returns the
// room, or null after writing the 401/403/404 answer.
async function authorizeRoomMutation(req, res, roomId) {
  const session = await resolveSessionUser(req);
  const check = await roomsService.checkOwner(session?.user?.id ?? null, roomId);
  if (check.status === 'owner') return check.room;
  const refusal = ownerRefusal(check);
  sendJson(res, refusal.status, refusal.body);
  return null;
}

// Everything a room deletion does after the durable soft-delete: tell whoever
// watches it, expire its invitations, drop every peer and its avatar. Shared by
// the owner's delete and by rooms nobody inherits from a deleted account.
async function finishRoomDeletion(roomId, { avatarKey = null, request = null } = {}) {
  // Broadcast after durable soft-delete, before presence teardown so the WS
  // writes are not racing socket close.
  const presence = presenceRooms.get(roomId);
  if (presence) broadcast(presence, { type: 'room-deleted', roomId });
  roomRuntime?.mirrorLegacyRoomEvent(roomId, { type: 'room-deleted', roomId });
  roomRuntime?.invalidateRecipientCache(roomId);
  // Invitations outlive the inviter's session now, so the deleted room is the
  // only thing left that can invalidate them.
  void expireRoomInvitations(null, roomId).catch((error) => {
    getProcessLogger().error({ evt: LOG_EVENTS.ROOM_INVITATION_EXPIRY_FAILED, err: error }, 'failed to expire room invitations');
  });

  // Terminal-claim every active/leased peer before credential or transport
  // teardown so a delayed replacement join cannot resurrect the deleted room.
  try {
    await roomRuntime?.cancelRoomReconnectLeases({
      roomId,
      reason: 'deleted',
      finalizePeer: async ({ peer, ownershipFinalized }) => {
        if (!peer || ownershipFinalized) return { finalized: ownershipFinalized };
        let failure = null;
        try {
          await getCredentialBoundary().revokePeer({
            roomId,
            accountUserId: peer.accountUserId || null,
            guestPrincipalId: peer.gateGuestPrincipalId || ''
          });
        } catch (error) {
          failure = error;
        }
        closePeer(roomId, peer.id, peer.transport?.id, 'deleted');
        try {
          await removeLiveKitParticipant(roomId, peer.id);
        } catch (error) {
          failure ||= error;
        }
        if (failure) {
          failure.ownershipFinalized = true;
          throw failure;
        }
        return { finalized: true };
      }
    });
  } catch {
    // The room deletion is already durable and peer ownership is terminal.
    // Cleanup callbacks continue close/remove even when credential revoke fails.
    request?.log?.warn?.({ code: 'room_delete_peer_cleanup_failed' }, 'Room peer cleanup finished with errors');
  }
  await removeAvatarBestEffort(avatarKey, request);
}

async function handleRegister(req, res) {
  const clientIp = getClientIp(req, TRUST_PROXY);
  const rate = authLimiter.check(`register:${clientIp}`);
  if (!rate.allowed) {
    sendJson(
      res,
      429,
      { ok: false, error: 'Слишком много попыток, попробуйте позже' },
      { 'Retry-After': String(rate.retryAfterSeconds) }
    );
    return;
  }

  const body = await readJsonBody(req);
  const login = normalizeLogin(body.login);
  const displayName = cleanDisplayName(body.displayName);
  const password = typeof body.password === 'string' ? body.password : '';
  const passwordConfirm = typeof body.passwordConfirm === 'string' ? body.passwordConfirm : password;

  if (!login) {
    sendJson(res, 400, { ok: false, error: 'Логин: 3–32 символа, латиница, цифры, . _ -' });
    return;
  }
  if (!isValidPassword(password)) {
    sendJson(res, 400, { ok: false, error: 'Пароль должен быть не короче 8 символов' });
    return;
  }
  if (password !== passwordConfirm) {
    sendJson(res, 400, { ok: false, error: 'Пароли не совпадают' });
    return;
  }
  // A deleted account's login stays taken, so nobody can pose as that person.
  if (isDeletedAccountLogin(login) || await getAccountDeletionRepository()?.isLoginReserved(login)) {
    sendJson(res, 409, { ok: false, error: 'Этот логин уже занят' });
    return;
  }

  const created = await getUserStore().createUser({ login, displayName, password });
  if (created.status === 'login_taken') {
    sendJson(res, 409, { ok: false, error: 'Этот логин уже занят' });
    return;
  }

  const device = await sessionDeviceFor(req);
  const session = await getUserStore().createSession({ userId: created.user.id, ...device });
  await recordAndAnnounceLogin({ userId: created.user.id, session, device, kind: 'register' });
  sendJson(
    res,
    201,
    { ok: true, user: await reloadSelfUser(created.user) },
    { 'Set-Cookie': buildSessionCookie(session.token, SESSION_TTL_MS / 1000) }
  );
}

async function handleLogin(req, res) {
  const clientIp = getClientIp(req, TRUST_PROXY);
  const rate = authLimiter.check(`login:${clientIp}`);
  if (!rate.allowed) {
    sendJson(
      res,
      429,
      { ok: false, error: 'Слишком много попыток, попробуйте позже' },
      { 'Retry-After': String(rate.retryAfterSeconds) }
    );
    return;
  }

  const body = await readJsonBody(req);
  const login = normalizeLogin(body.login);
  const password = typeof body.password === 'string' ? body.password : '';

  if (!login || !password) {
    sendJson(res, 401, { ok: false, error: 'Неверный логин или пароль' });
    return;
  }

  // The per-IP limit above does nothing against credential stuffing from many
  // addresses; this caps failed guesses per login regardless of source. It is
  // keyed by the submitted login, existing or not, so it reveals nothing.
  const accountRate = loginFailureLimiter.reserve(login);
  if (!accountRate.allowed) {
    sendJson(
      res,
      429,
      { ok: false, error: 'Слишком много попыток, попробуйте позже' },
      { 'Retry-After': String(accountRate.retryAfterSeconds) }
    );
    return;
  }

  const user = await getUserStore().verifyCredentials(login, password);
  if (!user) {
    sendJson(res, 401, { ok: false, error: 'Неверный логин или пароль' });
    return;
  }
  loginFailureLimiter.reset(login);
  // The right password on an account waiting to be deleted offers a restore.
  if (user.deletionRequestedAt) {
    sendJson(res, 409, {
      ok: false,
      code: 'account_deletion_pending',
      error: 'Аккаунт ожидает удаления',
      deletionScheduledFor: user.deletionRequestedAt + ACCOUNT_DELETION_GRACE_MS
    });
    return;
  }

  const device = await sessionDeviceFor(req);
  const session = await getUserStore().createSession({ userId: user.id, ...device });
  await recordAndAnnounceLogin({ userId: user.id, session, device, kind: 'login' });
  sendJson(
    res,
    200,
    { ok: true, user: await reloadSelfUser(user) },
    { 'Set-Cookie': buildSessionCookie(session.token, SESSION_TTL_MS / 1000) }
  );
}

async function handleLogout(req, res) {
  const token = getSessionToken(req);
  if (token) {
    await getUserStore().deleteSession(token);
    await endAccountSessionConnections({ tokenHashes: [hashSessionToken(token)] });
  }
  sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
}

// Creating a session can stamp per-account markers (the desktop app marker),
// so a self response built right after it re-reads the row instead of reusing
// the user loaded before.
async function reloadSelfUser(user) {
  return selfUser((await getUserStore().getUserById(user.id)) || user);
}

async function handleMe(req, res) {
  const session = await resolveSessionUser(req);
  sendJson(res, 200, { ok: true, user: session ? selfUser(session.user) : null });
}

async function handleUpdateProfile(req, res, request) {
  const session = await resolveSessionUser(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Требуется вход' });
    return;
  }

  const body = await readJsonBody(req);
  const displayName = cleanDisplayName(body.displayName);
  const user = await getUserStore().updateDisplayName({ userId: session.user.id, displayName });
  if (!user) {
    sendJson(res, 404, { ok: false, error: 'Аккаунт не найден' });
    return;
  }

  refreshActiveUserProfile(user);
  await broadcastUserProfileToFriends(user, request);
  sendJson(res, 200, { ok: true, user: selfUser(user) });
}

function checkAvatarUploadRate(res, userId) {
  const rate = avatarUploadLimiter.check(`avatar:${userId}`);
  if (rate.allowed) return true;
  sendJson(
    res,
    429,
    { ok: false, error: 'Слишком много загрузок, попробуйте позже' },
    { 'Retry-After': String(rate.retryAfterSeconds) }
  );
  return false;
}

async function readAvatarUpload(request) {
  let part;
  try {
    part = await request.file({ limits: { fileSize: MAX_AVATAR_BYTES, files: 1 } });
  } catch (cause) {
    if (cause?.code === 'FST_REQ_FILE_TOO_LARGE' || cause?.statusCode === 413) {
      const error = new Error('Avatar file must be at most 5 MB');
      error.statusCode = 413;
      throw error;
    }
    throw cause;
  }
  if (!part || part.fieldname !== 'avatar') {
    part?.file?.resume?.();
    const error = new Error('Multipart field "avatar" is required');
    error.statusCode = 400;
    throw error;
  }

  try {
    const buffer = await part.toBuffer();
    if (part.file?.truncated) {
      const error = new Error('Avatar file must be at most 5 MB');
      error.statusCode = 413;
      throw error;
    }
    return buffer;
  } catch (cause) {
    if (cause?.code === 'FST_REQ_FILE_TOO_LARGE' || cause?.statusCode === 413) {
      const error = new Error('Avatar file must be at most 5 MB');
      error.statusCode = 413;
      throw error;
    }
    throw cause;
  }
}

async function removeAvatarBestEffort(key, request) {
  if (!key) return;
  try {
    await getAvatarStorage().remove(key);
  } catch (error) {
    request?.log?.error?.({ err: error, avatarKey: key }, 'failed to remove old avatar');
  }
}

function refreshActiveUserProfile(user) {
  if (!user?.id) return;
  const avatarUrl = user.avatarKey ? `/api/avatars/${encodeURIComponent(user.avatarKey)}` : null;
  for (const [roomId, room] of presenceRooms) {
    for (const peer of room.peers.values()) {
      if (peer.accountUserId !== user.id) continue;
      peer.name = sessionDisplayName(user);
      peer.avatarAccent = user.avatarAccent || null;
      peer.avatarColorKey = user.avatarColorKey || peer.avatarColorKey;
      peer.avatarUrl = avatarUrl;
      const message = { type: 'peer-updated', peer: publicPeer(peer) };
      broadcast(room, message);
      roomRuntime?.mirrorLegacyRoomEvent(roomId, message);
      roomRuntime?.scheduleSummaryBroadcast(roomId);
    }
  }
}

// Push the refreshed public profile (avatar, display name) to everyone whose UI
// caches it outside a live room: the friend list, DM threads, and pending
// requests. Best-effort — a failed lookup must not fail the profile mutation.
async function broadcastUserProfileToFriends(user, request) {
  if (!user?.id) return;
  try {
    const friendIds = await getFriendStore().getFriendIds(user.id);
    const message = { type: 'user-updated', user: publicUser(user) };
    for (const friendId of friendIds) broadcastToUser(friendId, message);
  } catch (error) {
    request?.log?.error?.({ err: error, userId: user.id }, 'failed to broadcast profile update to friends');
  }
}

async function handleUploadUserAvatar(req, res, request) {
  const session = await resolveSessionUser(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Требуется вход' });
    return;
  }
  if (!checkAvatarUploadRate(res, session.user.id)) return;

  const processed = await processAvatar(await readAvatarUpload(request));
  const avatarKey = createAvatarKey('user', session.user.id, processed.hash);
  await getAvatarStorage().save(avatarKey, processed.buffer);

  let result;
  try {
    result = await getUserStore().swapAvatar({
      userId: session.user.id,
      avatarKey,
      avatarAccent: processed.accent
    });
  } catch (error) {
    // Another request may already have committed the same content-addressed key.
    // Reconciliation removes a truly orphaned write without risking that live file.
    throw error;
  }
  if (!result.user) {
    if (session.user.avatarKey !== avatarKey) await removeAvatarBestEffort(avatarKey, request);
    sendJson(res, 404, { ok: false, error: 'Аккаунт не найден' });
    return;
  }
  if (result.previousAvatarKey !== avatarKey) {
    await removeAvatarBestEffort(result.previousAvatarKey, request);
  }
  refreshActiveUserProfile(result.user);
  await broadcastUserProfileToFriends(result.user, request);
  sendJson(res, 200, { ok: true, user: selfUser(result.user) });
}

async function handleDeleteUserAvatar(req, res, request) {
  const session = await resolveSessionUser(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Требуется вход' });
    return;
  }
  const result = await getUserStore().swapAvatar({ userId: session.user.id });
  if (!result.user) {
    sendJson(res, 404, { ok: false, error: 'Аккаунт не найден' });
    return;
  }
  await removeAvatarBestEffort(result.previousAvatarKey, request);
  refreshActiveUserProfile(result.user);
  await broadcastUserProfileToFriends(result.user, request);
  sendJson(res, 200, { ok: true, user: selfUser(result.user) });
}

async function handleChangePassword(req, res) {
  const session = await resolveSessionUser(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Требуется вход' });
    return;
  }

  // Throttle on the account so a hijacked session can't brute-force the current
  // password, which is the only secret guarding the rotation.
  const rate = authLimiter.check(`password:${session.user.id}`);
  if (!rate.allowed) {
    sendJson(
      res,
      429,
      { ok: false, error: 'Слишком много попыток, попробуйте позже' },
      { 'Retry-After': String(rate.retryAfterSeconds) }
    );
    return;
  }

  const body = await readJsonBody(req);
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (!isValidPassword(newPassword)) {
    sendJson(res, 400, { ok: false, error: 'Пароль должен быть не короче 8 символов' });
    return;
  }

  const result = await getUserStore().changePassword({
    userId: session.user.id,
    currentPassword,
    newPassword
  });
  if (result.status === 'not_found') {
    sendJson(res, 404, { ok: false, error: 'Аккаунт не найден' });
    return;
  }
  if (result.status === 'invalid_password') {
    sendJson(res, 400, { ok: false, error: 'Неверный текущий пароль' });
    return;
  }

  await endAccountSessionConnections({ userId: session.user.id });
  sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
}

function sendTooManyAttempts(res, retryAfterSeconds) {
  sendJson(
    res,
    429,
    { ok: false, error: 'Слишком много попыток, попробуйте позже' },
    { 'Retry-After': String(retryAfterSeconds) }
  );
}

async function handleAccountSecurity(req, res) {
  const session = await resolveSessionUser(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Требуется вход' });
    return;
  }
  const [recoveryCodes, notices] = await Promise.all([
    getUserStore().getRecoveryCodesStatus(session.user.id),
    getUserStore().getAccountNotices(session.user.id)
  ]);
  sendJson(res, 200, {
    ok: true,
    recoveryCodes,
    recoveryCodesReminder: { snoozedUntil: notices.recoveryCodesReminderSnoozedUntil }
  });
}

async function handleSnoozeRecoveryCodesReminder(req, res) {
  const session = await resolveSessionUser(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Требуется вход' });
    return;
  }
  const result = await getUserStore().snoozeRecoveryCodesReminder({ userId: session.user.id });
  if (result.status !== 'snoozed') {
    sendJson(res, 404, { ok: false, error: 'Аккаунт не найден' });
    return;
  }
  sendJson(res, 200, { ok: true, recoveryCodesReminder: { snoozedUntil: result.snoozedUntil } });
}

async function handleWhatsNew(req, res) {
  const session = await resolveSessionUser(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Требуется вход' });
    return;
  }
  const notices = await getUserStore().getAccountNotices(session.user.id);
  sendJson(res, 200, { ok: true, whatsNew: { current: WHATS_NEW_VERSION, lastSeen: notices.whatsNewSeen } });
}

async function handleMarkWhatsNewSeen(req, res) {
  const session = await resolveSessionUser(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Требуется вход' });
    return;
  }
  const result = await getUserStore().markWhatsNewSeen({ userId: session.user.id });
  if (result.status !== 'seen') {
    sendJson(res, 404, { ok: false, error: 'Аккаунт не найден' });
    return;
  }
  sendJson(res, 200, { ok: true, whatsNew: { current: WHATS_NEW_VERSION, lastSeen: result.whatsNewSeen } });
}

async function handleMarkAppPromptSeen(req, res) {
  const session = await resolveSessionUser(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Требуется вход' });
    return;
  }
  const result = await getUserStore().markAppPromptSeen({ userId: session.user.id });
  if (result.status !== 'seen') {
    sendJson(res, 404, { ok: false, error: 'Аккаунт не найден' });
    return;
  }
  sendJson(res, 200, { ok: true, appPromptSeen: true });
}

async function handleLoginAlerts(req, res) {
  const session = await resolveSessionUser(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Требуется вход' });
    return;
  }
  const alerts = await getUserStore().listPendingLoginAlerts({
    userId: session.user.id,
    excludeSessionPublicId: session.session.publicId
  });
  sendJson(res, 200, { ok: true, alerts });
}

async function handleResolveLoginAlert(req, res, alertId, resolution) {
  const session = await resolveSessionUser(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Требуется вход' });
    return;
  }
  const userId = session.user.id;
  const result = await getUserStore().resolveLoginAlert({
    userId,
    alertId,
    resolution,
    currentSessionPublicId: session.session.publicId
  });
  if (result.status !== 'resolved') {
    sendJson(res, 404, { ok: false, error: 'Вход не найден или на него уже ответили' });
    return;
  }
  if (result.revokedTokenHash) {
    await endAccountSessionConnections({ userId, tokenHashes: [result.revokedTokenHash] });
  }
  // Every other device showing the same question closes it.
  broadcastToUser(userId, { type: 'account.login.resolved', alertId: String(alertId).toLowerCase(), resolution });
  if (resolution === 'confirmed') {
    sendJson(res, 200, { ok: true, resolution });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    resolution,
    sessionEnded: Boolean(result.revokedTokenHash),
    recoveryCodes: await getUserStore().getRecoveryCodesStatus(userId)
  });
}

function sendAccountDeletionUnavailable(res) {
  sendJson(res, 503, { ok: false, error: 'Удаление аккаунта сейчас недоступно' });
}

async function handleAccountDeletionPreview(req, res) {
  const session = await resolveSessionUser(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Требуется вход' });
    return;
  }
  const repository = getAccountDeletionRepository();
  if (!repository) {
    sendAccountDeletionUnavailable(res);
    return;
  }
  sendJson(res, 200, { ok: true, ...await repository.previewDeletion({ userId: session.user.id }) });
}

async function handleRequestAccountDeletion(req, res, request) {
  const session = await resolveSessionUser(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Требуется вход' });
    return;
  }
  const repository = getAccountDeletionRepository();
  if (!repository) {
    sendAccountDeletionUnavailable(res);
    return;
  }
  const userId = session.user.id;
  const rate = authLimiter.check(`account-deletion:${userId}`);
  if (!rate.allowed) {
    sendTooManyAttempts(res, rate.retryAfterSeconds);
    return;
  }

  const body = await readJsonBody(req);
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const result = await repository.requestDeletion({ userId, currentPassword });
  if (result.status === 'invalid_password') {
    sendJson(res, 400, { ok: false, error: 'Неверный пароль' });
    return;
  }
  if (result.status === 'not_found') {
    sendJson(res, 404, { ok: false, error: 'Аккаунт не найден' });
    return;
  }
  if (result.status === 'already_requested') {
    sendJson(res, 409, { ok: false, code: 'account_deletion_pending', error: 'Аккаунт уже ожидает удаления', deletionScheduledFor: result.scheduledFor });
    return;
  }

  await endAccountSessionConnections({ userId });
  // Friends' lists and open conversations switch to the anonymous name now.
  const hidden = await getUserStore().getUserById(userId);
  if (hidden) await broadcastUserProfileToFriends(hidden, request);
  sendJson(res, 200, { ok: true, deletionScheduledFor: result.scheduledFor }, { 'Set-Cookie': clearSessionCookie() });
}

async function handleRestoreAccount(req, res, request) {
  const repository = getAccountDeletionRepository();
  if (!repository) {
    sendAccountDeletionUnavailable(res);
    return;
  }
  const rate = authLimiter.check(`restore:${getClientIp(req, TRUST_PROXY)}`);
  if (!rate.allowed) {
    sendTooManyAttempts(res, rate.retryAfterSeconds);
    return;
  }

  const body = await readJsonBody(req);
  const login = normalizeLogin(body.login);
  const password = typeof body.password === 'string' ? body.password : '';
  const result = login && password
    ? await repository.restoreAccount({ login, password })
    : { status: 'invalid', userId: null };
  if (result.status === 'expired') {
    sendJson(res, 410, { ok: false, error: 'Аккаунт уже удалён' });
    return;
  }
  if (result.status !== 'restored') {
    sendJson(res, 401, { ok: false, error: 'Неверный логин или пароль' });
    return;
  }

  const user = await getUserStore().getUserById(result.userId);
  const device = await sessionDeviceFor(req);
  const session = await getUserStore().createSession({ userId: user.id, ...device });
  await recordAndAnnounceLogin({ userId: user.id, session, device, kind: 'login' });
  await broadcastUserProfileToFriends(user, request);
  sendJson(
    res,
    200,
    { ok: true, user: await reloadSelfUser(user) },
    { 'Set-Cookie': buildSessionCookie(session.token, SESSION_TTL_MS / 1000) }
  );
}

async function handleListSessions(req, res) {
  const session = await resolveSessionUser(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Требуется вход' });
    return;
  }
  const sessions = await getUserStore().listSessions({
    userId: session.user.id,
    currentTokenHash: session.session.tokenHash
  });
  sendJson(res, 200, { ok: true, sessions });
}

async function handleRevokeSession(req, res, sessionId) {
  const session = await resolveSessionUser(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Требуется вход' });
    return;
  }
  const publicId = typeof sessionId === 'string' ? sessionId.toLowerCase() : '';
  if (publicId && publicId === String(session.session.publicId).toLowerCase()) {
    sendJson(res, 400, { ok: false, error: 'Чтобы завершить этот сеанс, выйдите из аккаунта' });
    return;
  }
  const result = await getUserStore().revokeSession({ userId: session.user.id, publicId });
  if (result.status !== 'revoked') {
    sendJson(res, 404, { ok: false, error: 'Сеанс не найден' });
    return;
  }
  await endAccountSessionConnections({ userId: session.user.id, tokenHashes: [result.tokenHash] });
  sendJson(res, 200, { ok: true });
}

async function handleRevokeOtherSessions(req, res) {
  const session = await resolveSessionUser(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Требуется вход' });
    return;
  }
  const result = await getUserStore().revokeOtherSessions({
    userId: session.user.id,
    keepTokenHash: session.session.tokenHash
  });
  await endAccountSessionConnections({ userId: session.user.id, tokenHashes: result.tokenHashes });
  sendJson(res, 200, { ok: true, revoked: result.tokenHashes.length });
}

async function handleGenerateRecoveryCodes(req, res) {
  const session = await resolveSessionUser(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Требуется вход' });
    return;
  }
  // The password is the only secret guarding this, exactly as for a password change.
  const rate = authLimiter.check(`recovery-codes:${session.user.id}`);
  if (!rate.allowed) {
    sendTooManyAttempts(res, rate.retryAfterSeconds);
    return;
  }

  const body = await readJsonBody(req);
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const result = await getUserStore().generateRecoveryCodes({ userId: session.user.id, currentPassword });
  if (result.status === 'not_found') {
    sendJson(res, 404, { ok: false, error: 'Аккаунт не найден' });
    return;
  }
  if (result.status === 'invalid_password') {
    sendJson(res, 400, { ok: false, error: 'Неверный пароль' });
    return;
  }
  sendJson(
    res,
    200,
    {
      ok: true,
      codes: result.codes.map(formatRecoveryCode),
      recoveryCodes: { remaining: result.codes.length, generatedAt: result.generatedAt }
    },
    { 'Cache-Control': 'no-store' }
  );
}

async function handleRecoverAccount(req, res) {
  const clientIp = getClientIp(req, TRUST_PROXY);
  const ipRate = authLimiter.check(`recover:${clientIp}`);
  if (!ipRate.allowed) {
    sendTooManyAttempts(res, ipRate.retryAfterSeconds);
    return;
  }

  const body = await readJsonBody(req);
  const login = normalizeLogin(body.login);
  // Keyed on the login too, so spreading guesses across addresses does not help.
  const loginRate = login ? authLimiter.check(`recover-login:${login}`) : ipRate;
  if (!loginRate.allowed) {
    sendTooManyAttempts(res, loginRate.retryAfterSeconds);
    return;
  }
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (!isValidPassword(newPassword)) {
    sendJson(res, 400, { ok: false, error: 'Пароль должен быть не короче 8 символов' });
    return;
  }

  const result = await getUserStore().recoverWithCode({ login, code: body.code, newPassword });
  if (result.status !== 'recovered') {
    sendJson(res, 401, { ok: false, error: 'Неверный логин или код восстановления' });
    return;
  }

  await endAccountSessionConnections({ userId: result.user.id });
  const device = await sessionDeviceFor(req);
  const session = await getUserStore().createSession({ userId: result.user.id, ...device });
  await recordAndAnnounceLogin({ userId: result.user.id, session, device, kind: 'recovery' });
  sendJson(
    res,
    200,
    { ok: true, user: await reloadSelfUser(result.user), recoveryCodes: { remaining: result.remaining } },
    { 'Set-Cookie': buildSessionCookie(session.token, SESSION_TTL_MS / 1000) }
  );
}


function publicLobbyRoom(room) {
  return lobbyRoomView(room, presenceRooms.get(room.id)?.peers.size ?? 0);
}

function broadcastRoomUpdate(roomId, room) {
  const payload = publicLobbyRoom(room);
  const presence = presenceRooms.get(roomId);
  if (presence) broadcast(presence, { type: 'room-updated', room: payload });
  roomRuntime?.mirrorLegacyRoomEvent(roomId, { type: 'room-updated', room: payload });
  roomRuntime?.invalidateRecipientCache(roomId);
  roomRuntime?.scheduleSummaryBroadcast(roomId);
  return payload;
}

async function handleUploadRoomAvatar(req, res, roomId, request) {
  const room = await authorizeRoomMutation(req, res, roomId);
  if (!room) return;
  if (!checkAvatarUploadRate(res, room.ownerId)) return;

  const processed = await processAvatar(await readAvatarUpload(request));
  const avatarKey = createAvatarKey('room', room.id, processed.hash);
  await getAvatarStorage().save(avatarKey, processed.buffer);

  let result;
  try {
    result = await getRoomStore().swapRoomAvatar(roomId, avatarKey);
  } catch (error) {
    // Another request may already have committed the same content-addressed key.
    // Reconciliation removes a truly orphaned write without risking that live file.
    throw error;
  }
  if (!result.room) {
    if (room.avatarKey !== avatarKey) await removeAvatarBestEffort(avatarKey, request);
    sendJson(res, 404, { ok: false, error: 'Комната не найдена' });
    return;
  }
  if (result.previousAvatarKey !== avatarKey) {
    await removeAvatarBestEffort(result.previousAvatarKey, request);
  }
  sendJson(res, 200, { ok: true, room: broadcastRoomUpdate(roomId, result.room) });
}

async function handleDeleteRoomAvatar(req, res, roomId, request) {
  const room = await authorizeRoomMutation(req, res, roomId);
  if (!room) return;
  const result = await getRoomStore().swapRoomAvatar(roomId, null);
  if (!result.room) {
    sendJson(res, 404, { ok: false, error: 'Комната не найдена' });
    return;
  }
  await removeAvatarBestEffort(result.previousAvatarKey, request);
  sendJson(res, 200, { ok: true, room: broadcastRoomUpdate(roomId, result.room) });
}

async function openAvatarStream(key) {
  validateAvatarKey(key);
  const stream = getAvatarStorage().createReadStream(key);
  await new Promise((resolve, reject) => {
    stream.once('open', resolve);
    stream.once('error', reject);
  });
  return stream;
}

async function handleGetAvatar(res, key) {
  let stream;
  try {
    stream = await openAvatarStream(key);
  } catch (error) {
    if (error instanceof TypeError || error?.code === 'ENOENT') {
      sendJson(res, 404, { ok: false, error: 'Avatar not found' });
      return;
    }
    throw error;
  }
  res.writeHead(200, {
    ...baseHeaders(),
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Type': 'image/webp'
  });
  stream.pipe(res);
}

async function handleGetLinkPreviewImage(res, key) {
  let stream;
  try {
    stream = getLinkPreviewStorage().createReadStream(key);
    await new Promise((resolve, reject) => {
      stream.once('open', resolve);
      stream.once('error', reject);
    });
  } catch (error) {
    if (error instanceof TypeError || error?.code === 'ENOENT') {
      sendJson(res, 404, { ok: false, error: 'Image not found' });
      return;
    }
    throw error;
  }
  res.writeHead(200, {
    ...baseHeaders(),
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Type': 'image/webp'
  });
  stream.pipe(res);
}

// Accounts waiting to be deleted, and deleted ones, can no longer be written to
// or invited anywhere.
function isActiveAccount(user) {
  return Boolean(user && !user.deletionRequestedAt && !user.deletedAt);
}

// Finishes deletions whose grace period is over: rooms go to their heirs, rooms
// nobody inherits are torn down like an owner's delete, and the avatar file goes.
async function finalizeDueAccountDeletions(now = Date.now()) {
  const repository = getAccountDeletionRepository();
  if (!repository) return 0;
  let finished = 0;
  for (const userId of await repository.listDueDeletions({ now })) {
    try {
      const result = await repository.finalizeDeletion({ userId, now });
      if (result.status !== 'deleted') continue;
      finished += 1;
      await removeAvatarBestEffort(result.avatarKey);
      for (const { roomId } of result.transferredRooms) {
        const room = await getRoomStore().getRoom(roomId);
        if (room) broadcastRoomUpdate(roomId, room);
      }
      for (const { roomId, avatarKey } of result.deletedRooms) {
        await finishRoomDeletion(roomId, { avatarKey });
      }
    } catch (error) {
      getProcessLogger().error({ evt: LOG_EVENTS.ACCOUNT_DELETION_FAILED, err: error }, 'failed to finish an account deletion');
    }
  }
  return finished;
}

// An ended account session also loses what it still holds open: its sockets stop
// receiving account events and its voice seat goes at once, not when the LiveKit
// token expires. Only that peer's gate credentials are revoked, so the account's
// other devices stay connected, even in the same room. Without token hashes
// every socket of the account is closed (the password was replaced); without an
// account id the hashes alone pick the sockets (sign-out).
async function endAccountSessionConnections({ userId = null, tokenHashes = null }) {
  if (!wsRegistry || (!userId && !Array.isArray(tokenHashes))) return;
  const targets = wsRegistry.findAccountConnections(userId, tokenHashes);
  for (const connection of targets) {
    const activeVoice = connection.activeVoice;
    if (!activeVoice?.roomId || !activeVoice.peerId) continue;
    try {
      const peer = presenceRooms.get(activeVoice.roomId)?.peers.get(activeVoice.peerId);
      const principal = peer ? liveKitGatePrincipalForPeer(activeVoice.roomId, peer) : null;
      if (principal) {
        await getRoomStore().revokeLiveKitGateCredentialsForPeer({
          roomId: activeVoice.roomId,
          peerId: activeVoice.peerId,
          principal
        });
      }
      await roomRuntime?.leaveVoiceRoom(connection, activeVoice);
      await removeLiveKitParticipant(activeVoice.roomId, activeVoice.peerId);
    } catch (error) {
      getProcessLogger().error({ evt: LOG_EVENTS.ACCOUNT_SESSION_VOICE_END_FAILED, userId, err: error }, 'failed to end voice for an ended account session');
    }
  }
  wsRegistry.closeConnections(targets, SESSION_REVOKED_CLOSE_CODE, 'Session ended');
}

// --- Friends, requests, and direct messages -----------------------------

// Normalize a DM body without destroying multi-line formatting: collapse runs
// of horizontal whitespace, trim spaces around newlines, cap consecutive blank
// lines, then trim and length-limit.
function cleanDmText(value) {
  return String(value || '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 2000);
}

async function requireSessionUser(req, res) {
  const session = await resolveSessionUser(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Требуется вход' });
    return null;
  }
  return session.user;
}

function publicFriendEntry(entry) {
  return {
    user: entry.user,
    friendsSince: entry.friendsSince ?? null,
    online: isUserOnline(entry.user.id),
    unreadCount: entry.unreadCount,
    lastMessage: entry.lastMessage
  };
}

async function handleFriendsList(req, res) {
  const user = await requireSessionUser(req, res);
  if (!user) return;

  const [friends, requestCount] = await Promise.all([
    getFriendStore().listFriends(user.id),
    getFriendStore().countIncomingRequests(user.id)
  ]);
  sendJson(res, 200, {
    ok: true,
    friends: friends.map(publicFriendEntry),
    incomingRequestCount: requestCount
  });
}

async function handleFriendsSearch(req, res, url) {
  const user = await requireSessionUser(req, res);
  if (!user) return;

  const query = url.searchParams.get('q') || '';
  const [results, friendIds, requests] = await Promise.all([
    getFriendStore().searchUsers({ query, excludeUserId: user.id }),
    getFriendStore().getFriendIds(user.id),
    getFriendStore().listRequests(user.id)
  ]);

  const friendSet = new Set(friendIds);
  const outgoing = new Set(requests.outgoing.map((row) => row.user.id));
  const incoming = new Set(requests.incoming.map((row) => row.user.id));

  sendJson(res, 200, {
    ok: true,
    results: results.map((candidate) => ({
      user: candidate,
      online: isUserOnline(candidate.id),
      relationship: friendSet.has(candidate.id)
        ? 'friend'
        : outgoing.has(candidate.id)
          ? 'outgoing'
          : incoming.has(candidate.id)
            ? 'incoming'
            : 'none'
    }))
  });
}

async function handleFriendRequestsList(req, res) {
  const user = await requireSessionUser(req, res);
  if (!user) return;

  const requests = await getFriendStore().listRequests(user.id);
  sendJson(res, 200, { ok: true, ...requests });
}

async function handleSendFriendRequest(req, res) {
  const user = await requireSessionUser(req, res);
  if (!user) return;

  const rate = friendRequestLimiter.check(user.id);
  if (!rate.allowed) {
    sendJson(
      res,
      429,
      { ok: false, error: 'Слишком много заявок, попробуйте позже', retryAfterSeconds: rate.retryAfterSeconds },
      { 'Retry-After': String(rate.retryAfterSeconds) }
    );
    return;
  }

  const body = await readJsonBody(req);
  const targetUserId = cleanUuid(body.userId || body.addresseeUserId || '');
  const login = normalizeLogin(body.login || body.handle || '');
  if (!targetUserId && !login) {
    sendJson(res, 400, { ok: false, error: 'Неверный пользователь' });
    return;
  }

  const result = await getFriendStore().sendRequest({
    requesterId: user.id,
    addresseeLogin: login,
    addresseeUserId: targetUserId
  });
  switch (result.status) {
    case 'not_found':
      sendJson(res, 404, { ok: false, error: 'Пользователь не найден' });
      return;
    case 'self':
      sendJson(res, 400, { ok: false, error: 'Нельзя добавить себя' });
      return;
    case 'blocked':
      sendJson(res, 403, { ok: false, error: 'Заявку отправить нельзя' });
      return;
    case 'already_friends':
      sendJson(res, 200, { ok: true, status: 'already_friends', user: result.user });
      return;
    case 'already_sent':
      sendJson(res, 200, { ok: true, status: 'already_sent', user: result.user });
      return;
    case 'accepted':
      // Reverse request existed: both sides are now friends.
      broadcastToUser(result.user.id, { type: 'friend-accepted', userId: user.id });
      broadcastToUser(result.user.id, {
        type: 'notification.friend.accepted',
        dedupeKey: `friend-accepted:${result.user.id}:${user.id}`,
        user: notificationActor(user),
        context: { userId: user.id, relationship: 'friend' }
      });
      void sendFriendPush(result.user.id, 'friend.accepted', user, `friend-accepted:${result.user.id}:${user.id}`);
      sendJson(res, 200, { ok: true, status: 'accepted', user: result.user });
      return;
    default:
      broadcastToUser(result.user.id, { type: 'friend-request' });
      broadcastToUser(result.user.id, {
        type: 'notification.friend.request',
        dedupeKey: `friend-request:${result.requestId}`,
        requester: notificationActor(user),
        requestId: result.requestId
      });
      void sendFriendPush(result.user.id, 'friend.request', user, `friend-request:${result.requestId}`);
      sendJson(res, 201, { ok: true, status: 'sent', user: result.user });
  }
}

async function handleRespondFriendRequest(req, res, requestId, action) {
  const user = await requireSessionUser(req, res);
  if (!user) return;

  const id = cleanUuid(requestId);
  if (!id) {
    sendJson(res, 404, { ok: false, error: 'Заявка не найдена' });
    return;
  }

  const result = await getFriendStore().respondRequest({ userId: user.id, requestId: id, action });
  if (result.status === 'not_found') {
    sendJson(res, 404, { ok: false, error: 'Заявка не найдена' });
    return;
  }
  if (result.status === 'accepted') {
    broadcastToUser(result.requesterId, { type: 'friend-accepted', userId: user.id });
    broadcastToUser(result.requesterId, {
      type: 'notification.friend.accepted',
      dedupeKey: `friend-accepted:${result.requesterId}:${user.id}`,
      user: notificationActor(user),
      context: { userId: user.id, relationship: 'friend', requestId: id }
    });
    void sendFriendPush(result.requesterId, 'friend.accepted', user, `friend-accepted:${result.requesterId}:${user.id}`);
    sendJson(res, 200, { ok: true, status: 'accepted', user: result.user });
    return;
  }
  if (result.status === 'blocked') {
    sendJson(res, 409, { ok: false, code: 'relationship_blocked', error: 'Заявка больше недоступна' });
    return;
  }
  sendJson(res, 200, { ok: true, status: 'declined' });
}

async function handleCancelFriendRequest(req, res, requestId) {
  const user = await requireSessionUser(req, res);
  if (!user) return;

  const id = cleanUuid(requestId);
  if (!id) {
    sendJson(res, 404, { ok: false, error: 'Заявка не найдена' });
    return;
  }

  const result = await getFriendStore().cancelRequest({ userId: user.id, requestId: id });
  if (result.status === 'not_found') {
    sendJson(res, 404, { ok: false, error: 'Заявка не найдена' });
    return;
  }
  broadcastToUser(result.addresseeId, { type: 'friend-request' });
  sendJson(res, 200, { ok: true });
}

async function handleRemoveFriend(req, res, friendId) {
  const user = await requireSessionUser(req, res);
  if (!user) return;

  const id = cleanUuid(friendId);
  if (!id) {
    sendJson(res, 404, { ok: false, error: 'Друг не найден' });
    return;
  }

  const result = await getFriendStore().removeFriend({ userId: user.id, friendId: id });
  if (result.status === 'not_found') {
    sendJson(res, 404, { ok: false, error: 'Друг не найден' });
    return;
  }
  broadcastToUser(id, { type: 'friend-removed', userId: user.id });
  sendJson(res, 200, { ok: true });
}

async function handleBlockedList(req, res) {
  const user = await requireSessionUser(req, res);
  if (!user) return;
  const [blocked, users] = await Promise.all([
    getFriendStore().listBlockedUserIds(user.id),
    getFriendStore().listBlockedUsers(user.id)
  ]);
  sendJson(res, 200, { ok: true, blocked, users });
}

async function handleBlockUser(req, res, targetUserId) {
  const user = await requireSessionUser(req, res);
  if (!user) return;

  const id = cleanUuid(targetUserId);
  if (!id || id === user.id) {
    sendJson(res, 400, { ok: false, error: 'Нельзя заблокировать этого пользователя' });
    return;
  }

  const result = await getFriendStore().blockUser({ userId: user.id, targetId: id });
  if (result.status === 'not_found') {
    sendJson(res, 404, { ok: false, error: 'Пользователь не найден' });
    return;
  }
  if (result.status === 'invalid') {
    sendJson(res, 400, { ok: false, error: 'Нельзя заблокировать этого пользователя' });
    return;
  }
  // The blocked side is told the friendship ended, but never that a block was
  // applied — the UI on their end simply shows the person is no longer a friend.
  if (result.unfriended) broadcastToUser(id, { type: 'friend-removed', userId: user.id });
  sendJson(res, 200, { ok: true, status: result.status });
}

async function handleUnblockUser(req, res, targetUserId) {
  const user = await requireSessionUser(req, res);
  if (!user) return;

  const id = cleanUuid(targetUserId);
  if (!id) {
    sendJson(res, 404, { ok: false, error: 'Пользователь не найден' });
    return;
  }
  const result = await getFriendStore().unblockUser({ userId: user.id, targetId: id });
  if (result.status === 'not_found') {
    sendJson(res, 404, { ok: false, error: 'Пользователь не заблокирован' });
    return;
  }
  sendJson(res, 200, { ok: true });
}

async function handleDmThread(req, res, peerId) {
  const user = await requireSessionUser(req, res);
  if (!user) return;

  const id = cleanUuid(peerId);
  if (!id || id === user.id) {
    sendJson(res, 404, { ok: false, error: 'Диалог не найден' });
    return;
  }

  if (!(await getFriendStore().areFriends(user.id, id))) {
    sendJson(res, 403, { ok: false, error: 'Вы не друзья' });
    return;
  }

  const peer = await getUserStore().getUserById(id);
  if (!peer) {
    sendJson(res, 404, { ok: false, error: 'Пользователь не найден' });
    return;
  }

  const storedMessages = await getMessageService().direct.listThread({ userId: user.id, peerId: id });
  const messages = await Promise.all(storedMessages.map(async (message) => attachReplyProjection(
    'dm',
    await attachMediaProjection('dm', message),
    { userId: user.id, peerId: id }
  )));
  // Opening the thread clears the unread badge and lets the peer see the read.
  const read = await getMessageService().direct.markRead({ userId: user.id, peerId: id });
  if (read.count > 0) {
    broadcastToUser(id, { type: 'dm-read', userId: user.id });
  }

  const notifications = getNotificationStore();
  const muted = typeof notifications.isDmMuted === 'function'
    ? await notifications.isDmMuted({ userId: user.id, peerUserId: id })
    : false;
  sendJson(res, 200, { ok: true, peer: publicUser(peer), messages, muted });
}

async function handleSendDm(req, res, peerId) {
  const user = await requireSessionUser(req, res);
  if (!user) return;

  const id = cleanUuid(peerId);
  if (!id || id === user.id) {
    sendJson(res, 404, { ok: false, error: 'Диалог не найден' });
    return;
  }

  const rate = dmLimiter.check(user.id);
  if (!rate.allowed) {
    sendJson(
      res,
      429,
      { ok: false, error: 'Слишком много сообщений, попробуйте позже', retryAfterSeconds: rate.retryAfterSeconds },
      { 'Retry-After': String(rate.retryAfterSeconds) }
    );
    return;
  }

  if (!(await getFriendStore().areFriends(user.id, id))) {
    sendJson(res, 403, { ok: false, error: 'Вы не друзья' });
    return;
  }
  if (await getFriendStore().isBlockedBetween(user.id, id)) {
    sendJson(res, 403, { ok: false, code: 'relationship_blocked', error: 'Сообщение недоступно' });
    return;
  }
  if (!isActiveAccount(await getUserStore().getUserById(id))) {
    sendJson(res, 403, { ok: false, code: 'account_deleted', error: 'Аккаунт удалён' });
    return;
  }

  const body = await readJsonBody(req);
  const text = cleanDmText(body.text);
  const attachmentIds = normalizeAttachmentIds(body.attachmentIds);
  const replyToMessageId = body.replyTo == null ? '' : cleanUuid(body.replyTo?.messageId);
  const idempotencyKey = requestIdempotencyKey(req, body);
  if (attachmentIds === null) {
    sendJson(res, 400, { ok: false, error: 'Invalid attachments' });
    return;
  }
  if (body.replyTo != null && (!replyToMessageId || !release250FeatureEnabled('replies'))) {
    sendJson(res, 409, { ok: false, error: 'Reply target is unavailable' });
    return;
  }
  if (!text && attachmentIds.length === 0) {
    sendJson(res, 400, { ok: false, error: 'Пустое сообщение' });
    return;
  }

  const media = attachmentIds.length > 0 ? getMediaServices() : null;
  const replies = replyToMessageId ? createReplyRepository({ client: getRelease250Pool() }) : null;
  const delivery = getMessageDeliveryServices();
  let idempotencyLedgerKey = '';
  let replyPreview;
  if (attachmentIds.length > 0 && (!media || !release250FeatureEnabled('mediaUploads'))) {
    sendJson(res, 503, { ok: false, error: 'Media uploads are unavailable' });
    return;
  }
  const storedMessage = await getMessageService().direct.sendMessage({
    senderId: user.id,
    recipientId: id,
    body: text,
    replyToMessageId: replyToMessageId || null,
    beforeUnitOfWork: idempotencyKey && delivery
      ? async (client) => {
          const reservation = await delivery.idempotency.reserve(client, {
            actorType: 'account',
            actorId: user.id,
            conversation: { type: 'dm', id },
            key: idempotencyKey,
            fingerprint: messageFingerprint({ text, attachmentIds, replyToMessageId })
          });
          if (reservation.kind === 'replay') {
            return { replay: true, message: reservation.response.body?.message };
          }
          idempotencyLedgerKey = reservation.ledgerKey;
          return null;
        }
      : null,
    unitOfWork: attachmentIds.length > 0 || replyToMessageId || delivery
      ? async (client, inserted) => {
          if (replyToMessageId) {
            const target = await replies.lockDirectTarget({ userId: user.id, peerId: id, messageId: replyToMessageId, client });
            replyPreview = await requireReplyTarget({ message: target, visibility: true });
          }
          if (attachmentIds.length > 0) {
            await media.attachments.bindReady({
              ownerId: user.id,
              context: 'dm',
              messageId: inserted.id,
              attachmentIds
            }, client);
          }
          if (delivery) {
            await delivery.outbox.enqueue(client, {
              eventId: crypto.randomUUID(),
              type: 'message.created',
              conversation: { type: 'dm', id },
              messageId: inserted.id,
              message: inserted
            });
          }
          if (idempotencyLedgerKey) {
            await delivery.idempotency.complete(client, idempotencyLedgerKey, {
              body: { message: inserted },
              messageId: inserted.id,
              statusCode: 201
            });
          }
        }
      : null
  });
  const projectedBase = await attachMediaProjection('dm', storedMessage);
  const message = storedMessage.idempotencyReplay
    ? await attachReplyProjection('dm', projectedBase, { userId: user.id, peerId: id })
    : { ...projectedBase, replyPreview };
  // Deliver to the recipient and the sender's other tabs; clients dedupe by id.
  if (!storedMessage.idempotencyReplay && MESSAGE_DIRECT_EMIT_ENABLED) {
    broadcastToUser(id, { type: 'dm-message', message });
    await broadcastDmNotification(id, user, message);
    broadcastToUser(user.id, { type: 'dm-message', message });
  }
  if (!storedMessage.idempotencyReplay) {
    scheduleDirectLinkPreview({ messageId: storedMessage.id, senderId: user.id, recipientId: id, text });
  }
  sendJson(res, 201, { ok: true, message });
}

// The invited recipient accepts or declines a room invitation stored as a DM.
// The updated message fans out as a regular edit so both timelines converge.
async function handleRespondDmInvite(req, res, peerIdParam, messageId) {
  const user = await requireSessionUser(req, res);
  if (!user) return;

  const peerId = cleanUuid(peerIdParam);
  if (!peerId) {
    sendJson(res, 404, { ok: false, error: 'Диалог не найден' });
    return;
  }

  const body = await readJsonBody(req);
  const action = body.action === 'accept' ? 'accepted' : body.action === 'decline' ? 'declined' : '';
  if (!action) {
    sendJson(res, 400, { ok: false, error: 'Неверное действие' });
    return;
  }

  const current = await getMessageService().direct.getMessage(user.id, peerId, messageId);
  if (!current || !current.invite) {
    sendJson(res, 404, { ok: false, error: 'Приглашение не найдено' });
    return;
  }
  if (current.recipientId !== user.id) {
    sendJson(res, 403, { ok: false, error: 'Отвечать может только приглашённый' });
    return;
  }
  if (action === 'accepted' && !(await getRoom(current.invite.roomId))) {
    await expireRoomInvitations(current.senderId, current.invite.roomId);
    sendJson(res, 410, { ok: false, error: 'Комната больше не существует' });
    return;
  }

  const message = await getMessageService().direct.respondInvite({ messageId, recipientId: user.id, status: action });
  if (!message) {
    sendJson(res, 409, { ok: false, error: 'Приглашение уже обработано' });
    return;
  }

  const event = { type: 'dm.message.edited', message };
  broadcastToUser(peerId, event);
  broadcastToUser(user.id, event);
  sendJson(res, 200, { ok: true, message });
}

async function handleMarkDmRead(req, res, peerId) {
  const user = await requireSessionUser(req, res);
  if (!user) return;

  const id = cleanUuid(peerId);
  if (!id) {
    sendJson(res, 404, { ok: false, error: 'Диалог не найден' });
    return;
  }

  const body = await readJsonBody(req);
  if (typeof body.cursor === 'string' && body.cursor) {
    try {
      const result = await getHistoryServices().read.advanceDm({ cursor: body.cursor, peerId: id, userId: user.id });
      broadcastToUser(id, { type: 'dm-read', userId: user.id, cursor: body.cursor });
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, error.statusCode || 400, { ok: false, code: error.code || 'invalid_read_cursor', error: error.message });
    }
    return;
  }

  const result = await getMessageService().direct.markRead({ userId: user.id, peerId: id });
  if (result.count > 0) {
    broadcastToUser(id, { type: 'dm-read', userId: user.id });
  }
  sendJson(res, 200, { ok: true, count: result.count });
}

async function handleRingRoom(req, res, rawRoomId) {
  const user = await requireSessionUser(req, res);
  if (!user) return;
  const roomId = normalizeRoomId(rawRoomId);
  const body = await readJsonBody(req);
  const targetUserId = cleanUuid(body.userId);
  if (!roomId || !targetUserId || targetUserId === user.id) {
    sendJson(res, 400, { ok: false, error: 'Invalid ring target' });
    return;
  }

  // Presence is deliberately not required: you can invite a friend to a room
  // from the lobby before joining it yourself. The per-pair rate limit below
  // still bounds how often anyone can ring the same person.
  if (!(await getFriendStore().areFriends(user.id, targetUserId))) {
    sendJson(res, 403, { ok: false, error: 'You are not friends' });
    return;
  }
  if (await getFriendStore().isBlockedBetween(user.id, targetUserId)) {
    sendJson(res, 403, { ok: false, code: 'relationship_blocked', error: 'Invite is unavailable' });
    return;
  }
  if (!isActiveAccount(await getUserStore().getUserById(targetUserId))) {
    sendJson(res, 403, { ok: false, code: 'account_deleted', error: 'Invite is unavailable' });
    return;
  }

  const rate = ringLimiter.check(`${user.id}:${targetUserId}`);
  if (!rate.allowed) {
    sendJson(res, 429, { ok: false, error: 'Invite cooldown', retryAfterSeconds: rate.retryAfterSeconds }, {
      'Retry-After': String(rate.retryAfterSeconds)
    });
    return;
  }

  const room = await getRoomStore().getRoom(roomId);
  if (!room) {
    sendJson(res, 404, { ok: false, error: 'Room not found' });
    return;
  }
  const ringExpiresAt = Date.now() + RING_TTL_MS;
  const fromUser = notificationActor(user);
  const ringRoom = { id: room.id, name: room.name || '', emoji: room.emoji || '' };
  broadcastToUser(targetUserId, { type: 'ring.incoming', fromUser, room: ringRoom, expiresAt: ringExpiresAt });
  // Persist the invitation as a regular DM so both sides share one timeline
  // entry (with live status) instead of per-device local copies. The invitation
  // stays actionable while the room exists; the shorter expiry only bounds the
  // audible ring and its push notification.
  const inviteMessage = await getMessageService().direct.sendMessage({
    senderId: user.id,
    recipientId: targetUserId,
    body: room.name ? `Приглашение в комнату «${room.name}»` : 'Приглашение в комнату',
    metadata: { kind: 'room-invite', roomId: room.id, roomName: room.name || '', status: 'pending', expiresAt: null }
  });
  broadcastToUser(targetUserId, { type: 'dm-message', message: inviteMessage });
  broadcastToUser(user.id, { type: 'dm-message', message: inviteMessage });
  void queuePush(targetUserId, {
    type: 'ring',
    title: `${user.displayName || user.login || 'Друг'} зовёт вас`,
    body: room.name ? `Комната «${room.name}»` : 'Присоединиться к комнате',
    privateBody: 'Вас зовут в голосовую комнату.',
    tag: `ring:${user.id}:${roomId}`,
    dedupeKey: `ring:${user.id}:${roomId}:${ringExpiresAt}`,
    url: `/r/${encodeURIComponent(roomId)}`,
    expiresAt: ringExpiresAt
  }, { expiresAt: ringExpiresAt });
  sendJson(res, 200, { ok: true });
}

// --- Notification preferences -------------------------------------------

function handlePushConfig(_req, res) {
  sendJson(res, 200, getPushService().config);
}

function cleanPushSubscription(value) {
  const endpoint = cleanPushEndpoint(value?.endpoint);
  const p256dh = String(value?.keys?.p256dh || '').trim();
  const auth = String(value?.keys?.auth || '').trim();
  if (!endpoint || endpoint.length > 4096 || !p256dh || p256dh.length > 1024 || !auth || auth.length > 1024) return null;
  return { endpoint, keys: { p256dh, auth } };
}

function checkPushSubscriptionRate(res, userId) {
  const rate = pushSubscriptionLimiter.check(`push-subscription:${userId}`);
  if (rate.allowed) return true;
  sendJson(
    res,
    429,
    { ok: false, error: 'Too many push subscription changes', retryAfterSeconds: rate.retryAfterSeconds },
    { 'Retry-After': String(rate.retryAfterSeconds) }
  );
  return false;
}

async function handleCreatePushSubscription(req, res) {
  const user = await requireSessionUser(req, res);
  if (!user) return;
  if (!getPushService().config.enabled) {
    sendJson(res, 503, { ok: false, error: 'Push notifications are disabled' });
    return;
  }
  const body = await readJsonBody(req);
  const subscription = cleanPushSubscription(body.subscription);
  if (!subscription) {
    sendJson(res, 400, { ok: false, error: 'Invalid push subscription' });
    return;
  }
  if (!checkPushSubscriptionRate(res, user.id)) return;
  const stored = await getPushStore().upsert({
    userId: user.id,
    subscription,
    metadata: { userAgent: String(req.headers?.['user-agent'] || '').slice(0, 512) }
  });
  if (!stored) {
    sendJson(res, 409, { ok: false, error: 'Push endpoint belongs to another subscription' });
    return;
  }
  sendJson(res, 201, { ok: true });
}

async function handleDeletePushSubscription(req, res) {
  const user = await requireSessionUser(req, res);
  if (!user) return;
  const body = await readJsonBody(req);
  const endpoint = cleanPushEndpoint(body.endpoint);
  if (!endpoint) {
    sendJson(res, 400, { ok: false, error: 'Invalid push endpoint' });
    return;
  }
  if (!checkPushSubscriptionRate(res, user.id)) return;
  await getPushStore().remove({ userId: user.id, endpoint });
  sendJson(res, 200, { ok: true });
}

async function handleNotificationPreferences(req, res) {
  const user = await requireSessionUser(req, res);
  if (!user) return;

  const preferences = await getNotificationStore().getPreferences(user.id);
  sendJson(res, 200, { ok: true, preferences });
}

function sendNotificationMutationResult(res, result, { muted = null } = {}) {
  switch (result.status) {
    case 'not_found':
      sendJson(res, 404, { ok: false, error: 'Not found' });
      return;
    case 'self':
      sendJson(res, 400, { ok: false, error: 'Invalid notification target' });
      return;
    case 'temporary_room':
      sendJson(res, 403, { ok: false, error: 'Only saved rooms can be muted' });
      return;
    case 'not_saved_room':
      sendJson(res, 403, { ok: false, error: 'Room is not saved' });
      return;
    default:
      sendJson(res, 200, {
        ok: true,
        ...(muted === null ? {} : { muted }),
        preferences: result.preferences
      });
  }
}

function readRequiredBoolean(body, fieldName) {
  if (!body || typeof body[fieldName] !== 'boolean') {
    return { ok: false, error: `${fieldName} must be a boolean` };
  }
  return { ok: true, value: body[fieldName] };
}

async function handleSetDmMute(req, res, peerId) {
  const user = await requireSessionUser(req, res);
  if (!user) return;

  const id = cleanUuid(peerId);
  if (!id || id === user.id) {
    sendJson(res, id === user.id ? 400 : 404, { ok: false, error: 'Invalid notification target' });
    return;
  }

  const body = await readJsonBody(req);
  const muted = readRequiredBoolean(body, 'muted');
  if (!muted.ok) {
    sendJson(res, 400, { ok: false, error: muted.error });
    return;
  }

  const result = await getNotificationStore().setDmMute({ userId: user.id, peerUserId: id, muted: muted.value });
  sendNotificationMutationResult(res, result, { muted: muted.value });
}

async function handleSetRoomMute(req, res, rawRoomId) {
  const user = await requireSessionUser(req, res);
  if (!user) return;

  const roomId = normalizeRoomId(rawRoomId);
  if (!roomId) {
    sendJson(res, 404, { ok: false, error: 'Invalid notification target' });
    return;
  }

  const body = await readJsonBody(req);
  const muted = readRequiredBoolean(body, 'muted');
  if (!muted.ok) {
    sendJson(res, 400, { ok: false, error: muted.error });
    return;
  }

  const result = await getNotificationStore().setRoomMute({ userId: user.id, roomId, muted: muted.value });
  sendNotificationMutationResult(res, result, { muted: muted.value });
}

async function handleSetPrivateNotifications(req, res) {
  const user = await requireSessionUser(req, res);
  if (!user) return;

  const body = await readJsonBody(req);
  const privateNotifications = readRequiredBoolean(body, 'privateNotifications');
  if (!privateNotifications.ok) {
    sendJson(res, 400, { ok: false, error: privateNotifications.error });
    return;
  }

  const result = await getNotificationStore().setPrivateNotifications({
    userId: user.id,
    privateNotifications: privateNotifications.value
  });
  sendNotificationMutationResult(res, result);
}

async function publishPresenceStatusUpdate(user, result, request) {
  if (result.status !== 'updated') return;
  const presenceStatus = cleanPresenceStatus(result.preferences?.presenceStatus)
    || (result.preferences?.doNotDisturb ? 'dnd' : 'online');
  result.preferences = {
    ...result.preferences,
    doNotDisturb: presenceStatus === 'dnd',
    presenceStatus
  };
  wsRegistry?.setUserPresenceStatus(user.id, presenceStatus);
  const updatedUser = {
    ...user,
    doNotDisturb: presenceStatus === 'dnd',
    presenceStatus
  };
  broadcastToUser(user.id, {
    type: 'notification-settings-updated',
    preferences: result.preferences
  });
  await broadcastUserProfileToFriends(updatedUser, request);
}

async function handleSetNotificationSettings(req, res, request) {
  const user = await requireSessionUser(req, res);
  if (!user) return;

  const body = await readJsonBody(req);
  const dnd = readRequiredBoolean(body, 'dnd');
  if (!dnd.ok) {
    sendJson(res, 400, { ok: false, error: dnd.error });
    return;
  }

  const result = await getNotificationStore().setDoNotDisturb({
    userId: user.id,
    doNotDisturb: dnd.value
  });
  await publishPresenceStatusUpdate(user, result, request);
  sendNotificationMutationResult(res, result);
}

async function handleSetPresenceStatus(req, res, request) {
  const user = await requireSessionUser(req, res);
  if (!user) return;

  const body = await readJsonBody(req);
  const presenceStatus = cleanPresenceStatus(body?.status);
  if (!presenceStatus) {
    sendJson(res, 400, { ok: false, error: 'status must be one of: online, away, dnd, offline' });
    return;
  }
  if (body?.automatic !== undefined && typeof body.automatic !== 'boolean') {
    sendJson(res, 400, { ok: false, error: 'automatic must be a boolean' });
    return;
  }
  const automatic = body?.automatic === true;
  if (automatic && presenceStatus !== 'away' && presenceStatus !== 'online') {
    sendJson(res, 400, { ok: false, error: 'automatic presence can only transition between online and away' });
    return;
  }

  const result = await getNotificationStore().setPresenceStatus({
    automatic,
    userId: user.id,
    presenceStatus
  });
  await publishPresenceStatusUpdate(user, result, request);
  sendNotificationMutationResult(res, result);
}

async function handleDeleteDmMessage(req, res, peerIdParam, messageId) {
  const user = await requireSessionUser(req, res);
  if (!user) return;

  const peerId = cleanUuid(peerIdParam);
  if (!peerId) {
    sendJson(res, 404, { ok: false, error: 'Диалог не найден' });
    return;
  }

  const msg = await getMessageService().direct.getMessage(user.id, peerId, messageId);
  if (!msg) {
    sendJson(res, 404, { ok: false, error: 'Сообщение не найдено' });
    return;
  }

  // Only sender can delete own message (deletes for both)
  if (msg.senderId !== user.id) {
    sendJson(res, 403, { ok: false, error: 'Можно удалять только свои сообщения' });
    return;
  }

  const deleted = await getMessageService().direct.softDeleteMessage(messageId);
  if (!deleted) {
    sendJson(res, 404, { ok: false, error: 'Сообщение не найдено' });
    return;
  }

  // Each side indexes the event by the other participant's id.
  broadcastToUser(peerId, { type: 'dm.message.deleted', messageId, peerUserId: user.id });
  broadcastToUser(user.id, { type: 'dm.message.deleted', messageId, peerUserId: peerId });

  // If the deleted msg was unread for the other side, they may recalc, we can also send dm-read like bump?
  // For simplicity, let client re-fetch count on delete event if needed.

  sendJson(res, 200, { ok: true, deleted: true });
}

async function handleEditDmMessage(req, res, peerIdParam, messageId) {
  const user = await requireSessionUser(req, res);
  if (!user) return;

  const peerId = cleanUuid(peerIdParam);
  if (!peerId) {
    sendJson(res, 404, { ok: false, error: 'Диалог не найден' });
    return;
  }

  const body = await readJsonBody(req);
  const text = cleanDmText(body.text);
  if (!text) {
    sendJson(res, 400, { ok: false, error: 'Пустое сообщение' });
    return;
  }

  const current = await getMessageService().direct.getMessage(user.id, peerId, messageId);
  if (!current) {
    sendJson(res, 404, { ok: false, error: 'Сообщение не найдено' });
    return;
  }
  if (current.senderId !== user.id) {
    sendJson(res, 403, { ok: false, error: 'Можно редактировать только свои сообщения' });
    return;
  }
  if (current.invite) {
    sendJson(res, 403, { ok: false, error: 'Приглашение нельзя редактировать' });
    return;
  }

  const rate = dmLimiter.check(user.id);
  if (!rate.allowed) {
    sendJson(
      res,
      429,
      { ok: false, error: 'Слишком много сообщений, попробуйте позже', retryAfterSeconds: rate.retryAfterSeconds },
      { 'Retry-After': String(rate.retryAfterSeconds) }
    );
    return;
  }

  const message = await getMessageService().direct.editMessage({
    messageId,
    senderId: user.id,
    recipientId: peerId,
    body: text
  });
  if (!message) {
    sendJson(res, 404, { ok: false, error: 'Сообщение не найдено' });
    return;
  }

  scheduleDirectLinkPreview({ messageId, senderId: user.id, recipientId: peerId, text, edited: true });
  const event = { type: 'dm.message.edited', message };
  broadcastToUser(peerId, event);
  broadcastToUser(user.id, event);
  sendJson(res, 200, { ok: true, message });
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

function getPresencePeerCount() {
  return Array.from(presenceRooms.values()).reduce((count, room) => count + room.peers.size, 0);
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
    presenceRooms.clear();
    roomOccupancyQueue.clear();
    clearRoomOccupancyRetries();
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

  app.post('/api/auth/register', (request, reply) => runLegacyHandler(request, reply, handleRegister));
  app.post('/api/auth/login', (request, reply) => runLegacyHandler(request, reply, handleLogin));
  app.post('/api/auth/logout', (request, reply) => runLegacyHandler(request, reply, handleLogout));
  app.get('/api/auth/me', (request, reply) => runLegacyHandler(request, reply, handleMe));
  app.post('/api/auth/profile', (request, reply) => runLegacyHandler(request, reply, handleUpdateProfile));
  app.post('/api/auth/avatar', (request, reply) => runLegacyHandler(request, reply, handleUploadUserAvatar));
  app.delete('/api/auth/avatar', (request, reply) => runLegacyHandler(request, reply, handleDeleteUserAvatar));
  app.post('/api/auth/password', (request, reply) => runLegacyHandler(request, reply, handleChangePassword));
  app.post('/api/auth/recover', (request, reply) => runLegacyHandler(request, reply, handleRecoverAccount));
  app.get('/api/auth/security', (request, reply) => runLegacyHandler(request, reply, handleAccountSecurity));
  app.post('/api/auth/recovery-codes', (request, reply) => runLegacyHandler(request, reply, handleGenerateRecoveryCodes));
  app.get('/api/auth/sessions', (request, reply) => runLegacyHandler(request, reply, handleListSessions));
  app.post('/api/auth/sessions/revoke-others', (request, reply) => runLegacyHandler(request, reply, handleRevokeOtherSessions));
  app.delete('/api/auth/sessions/:sessionId', (request, reply) => runLegacyHandler(
    request,
    reply,
    (req, res) => handleRevokeSession(req, res, request.params.sessionId)
  ));
  app.post('/api/auth/recovery-codes/reminder/snooze', (request, reply) => runLegacyHandler(request, reply, handleSnoozeRecoveryCodesReminder));
  app.get('/api/auth/whats-new', (request, reply) => runLegacyHandler(request, reply, handleWhatsNew));
  app.post('/api/auth/whats-new/seen', (request, reply) => runLegacyHandler(request, reply, handleMarkWhatsNewSeen));
  app.post('/api/auth/app-prompt/seen', (request, reply) => runLegacyHandler(request, reply, handleMarkAppPromptSeen));
  app.get('/api/auth/login-alerts', (request, reply) => runLegacyHandler(request, reply, handleLoginAlerts));
  app.post('/api/auth/login-alerts/:alertId/confirm', (request, reply) => runLegacyHandler(
    request,
    reply,
    (req, res) => handleResolveLoginAlert(req, res, request.params.alertId, 'confirmed')
  ));
  app.post('/api/auth/login-alerts/:alertId/deny', (request, reply) => runLegacyHandler(
    request,
    reply,
    (req, res) => handleResolveLoginAlert(req, res, request.params.alertId, 'denied')
  ));
  app.get('/api/auth/account/deletion', (request, reply) => runLegacyHandler(request, reply, handleAccountDeletionPreview));
  app.post('/api/auth/account/deletion', (request, reply) => runLegacyHandler(request, reply, handleRequestAccountDeletion));
  app.post('/api/auth/account/restore', (request, reply) => runLegacyHandler(request, reply, handleRestoreAccount));
  app.post('/api/rooms/:roomId/avatar', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleUploadRoomAvatar(req, res, normalizeRoomId(request.params.roomId), request);
  }));
  app.delete('/api/rooms/:roomId/avatar', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleDeleteRoomAvatar(req, res, normalizeRoomId(request.params.roomId), request);
  }));
  app.get('/api/avatars/:key', (request, reply) => runLegacyHandler(request, reply, (_req, res) => {
    return handleGetAvatar(res, request.params.key);
  }));
  app.get('/api/link-previews/:key', (request, reply) => runLegacyHandler(request, reply, (_req, res) => {
    return handleGetLinkPreviewImage(res, request.params.key);
  }));

  app.get('/api/friends', (request, reply) => runLegacyHandler(request, reply, handleFriendsList));
  app.get('/api/friends/search', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    return handleFriendsSearch(req, res, url);
  }));
  app.get('/api/friends/requests', (request, reply) => runLegacyHandler(request, reply, handleFriendRequestsList));
  app.post('/api/friends/requests', (request, reply) => runLegacyHandler(request, reply, handleSendFriendRequest));
  app.post('/api/friends/requests/:id/accept', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleRespondFriendRequest(req, res, request.params.id, 'accept');
  }));
  app.post('/api/friends/requests/:id/decline', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleRespondFriendRequest(req, res, request.params.id, 'decline');
  }));
  app.delete('/api/friends/requests/:id', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleCancelFriendRequest(req, res, request.params.id);
  }));
  // Registered before /api/friends/:userId so the literal segment wins the match.
  app.get('/api/blocks', (request, reply) => runLegacyHandler(request, reply, handleBlockedList));
  app.put('/api/blocks/:userId', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleBlockUser(req, res, request.params.userId);
  }));
  app.delete('/api/blocks/:userId', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleUnblockUser(req, res, request.params.userId);
  }));
  app.delete('/api/friends/:userId', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleRemoveFriend(req, res, request.params.userId);
  }));
  app.get('/api/dm/:userId', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleDmThread(req, res, request.params.userId);
  }));
  app.post('/api/dm/:userId', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleSendDm(req, res, request.params.userId);
  }));
  app.post('/api/dm/:userId/invites/:messageId/respond', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleRespondDmInvite(req, res, request.params.userId, request.params.messageId);
  }));
  app.post('/api/dm/:userId/read', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleMarkDmRead(req, res, request.params.userId);
  }));
  app.post('/api/rooms/:roomId/ring', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleRingRoom(req, res, request.params.roomId);
  }));
  app.patch('/api/dm/:userId/messages/:messageId', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleEditDmMessage(req, res, request.params.userId, request.params.messageId);
  }));
  app.delete('/api/dm/:userId/messages/:messageId', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleDeleteDmMessage(req, res, request.params.userId, request.params.messageId);
  }));
  app.get('/api/notifications/preferences', (request, reply) => runLegacyHandler(request, reply, handleNotificationPreferences));
  app.put('/api/notifications/dm/:userId/mute', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleSetDmMute(req, res, request.params.userId);
  }));
  app.put('/api/notifications/room/:roomId/mute', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleSetRoomMute(req, res, request.params.roomId);
  }));
  app.put('/api/notifications/privacy', (request, reply) => runLegacyHandler(request, reply, handleSetPrivateNotifications));
  app.post('/api/notifications/settings', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleSetNotificationSettings(req, res, request);
  }));
  app.post('/api/presence/status', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleSetPresenceStatus(req, res, request);
  }));
  app.get('/api/push/config', (request, reply) => runLegacyHandler(request, reply, handlePushConfig));
  app.post('/api/push/subscriptions', (request, reply) => runLegacyHandler(request, reply, handleCreatePushSubscription));
  app.delete('/api/push/subscriptions', (request, reply) => runLegacyHandler(request, reply, handleDeletePushSubscription));

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
  server.once('close', clearRoomOccupancyRetries);
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
