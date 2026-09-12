'use strict';

const crypto = require('node:crypto');
const fastify = require('fastify');
const fastifyCookie = require('@fastify/cookie');
const fastifyMultipart = require('@fastify/multipart');
const fastifyWebsocket = require('@fastify/websocket');
const { buildRoomMembershipPresenceSnapshot, createConnectionRegistry } = require('./realtime/registry');
const { createWsHandler } = require('./realtime/ws-handler');
const {
  clearViewedScreenPeerReferences,
  createRoomRealtimeRuntime,
  resolveViewedScreenPeerId
} = require('./realtime/room-runtime');
const { buildServerEnvelope } = require('./realtime/envelope');
const { URL } = require('node:url');
const { RoomServiceClient, TrackSource } = require('livekit-server-sdk');

const { readEnvInt, readEnvBool, readMessageDeliveryMode, readDatabaseConfig, readUploadsDir } = require('./lib/config');
const {
  normalizeRoomId,
  normalizePeerId,
  normalizeSessionToken,
  cleanName,
  cleanDisplayName,
  cleanRoomName,
  cleanStreamId,
  cleanScreenProfileId,
  cleanLiveKitUrl,
  cleanPresenceStatus,
  isValidPassword,
  normalizeLogin
} = require('@voice-room/shared/validation');
const { createProofOfWork } = require('./lib/pow');
const { getClientIp, createRateLimiter } = require('./lib/rate-limit');
const { MAX_AVATAR_BYTES, createAvatarKey, processAvatar } = require('./lib/avatar-processing');
const { reconcileAvatarStorage } = require('./lib/avatar-reconciliation');
const { createAvatarStorage, validateAvatarKey } = require('./lib/avatar-storage');
const { avatarColorForPeerId, createRoomStore } = require('./lib/room-store');
const { createUserStore, hashSessionToken, publicUser } = require('./lib/user-store');
const { createGeoLocator } = require('./lib/geoip');
const { WHATS_NEW_VERSION, formatRecoveryCode } = require('@voice-room/shared/account-security');
const { createFriendStore } = require('./lib/friend-store');
const { createNotificationStore } = require('./lib/notification-store');
const { createPushStore } = require('./lib/push-store');
const { createPushService, resolvePushTtl, shouldDeliverPush } = require('./lib/push-service');
const { cleanPushEndpoint } = require('./lib/push-endpoint');
const { startApiListener } = require('./lib/listen');
const { assertMigrationReady, runMigrations } = require('./lib/migrate');
const { createRelease250Pool } = require('./lib/release-250-pool');
const {
  observeMaintenance,
  recordCredentialRevokeCleanupFailure,
  recordHttpRequest,
  recordMediaAuthorizationInvariantFailure,
  recordMediaPressure,
  renderPrometheus
} = require('./lib/metrics');
const { createCredentialBoundaryService } = require('./domains/admission/credential-boundary-service');
const { createLiveKitCredentialProvider } = require('./domains/admission/livekit-credential-provider');
const { createMembershipRepository } = require('./domains/membership/membership-repository');
const { createMembershipService } = require('./domains/membership/membership-service');
const { createMemberDirectoryService } = require('./domains/membership/member-directory-service');
const { registerMembershipRoutes } = require('./domains/membership/membership-routes');
const { createDirectMessageRepository } = require('./domains/messaging/direct-message-repository');
const { createDmHistoryRepository } = require('./domains/messaging/dm-history-repository');
const { createDmHistoryService } = require('./domains/messaging/dm-history-service');
const { registerDmHistoryRoutes } = require('./domains/messaging/dm-history-routes');
const { createMessageService } = require('./domains/messaging/message-service');
const { createMessageReadRepository } = require('./domains/messaging/message-read-repository');
const { createMessageReadService } = require('./domains/messaging/message-read-service');
const { createMessageIdempotencyRepository } = require('./domains/messaging/message-idempotency-repository');
const { createMessageOutboxRepository } = require('./domains/messaging/message-outbox-repository');
const { createMessageVisibilityService } = require('./domains/messaging/message-visibility-service');
const { createRoomHistoryRepository } = require('./domains/messaging/room-history-repository');
const { createRoomHistoryService } = require('./domains/messaging/room-history-service');
const { registerRoomHistoryRoutes } = require('./domains/messaging/room-history-routes');
const { createRoomMessageRepository } = require('./domains/messaging/room-message-repository');
const { createContentRepository } = require('./domains/messaging/content-repository');
const { createReplyRepository } = require('./domains/messaging/reply-repository');
const { requireReplyTarget } = require('./domains/messaging/reply-projector');
const { createReactionRepository } = require('./domains/messaging/reaction-repository');
const { createReactionService } = require('./domains/messaging/reaction-service');
const { createReactionRealtimeAdapter } = require('./domains/messaging/reaction-realtime-adapter');
const { registerReactionRoutes } = require('./domains/messaging/reaction-routes');
const { createPinRepository } = require('./domains/messaging/pin-repository');
const { createPinService } = require('./domains/messaging/pin-service');
const { registerPinRoutes } = require('./domains/messaging/pin-routes');
const { createInboxRepository } = require('./domains/notifications/inbox-repository');
const { createMentionRepository } = require('./domains/notifications/mention-repository');
const { createMentionEligibilityService } = require('./domains/notifications/mention-eligibility-service');
const { createNotificationOutboxRepository } = require('./domains/notifications/notification-outbox-repository');
const { createNotificationService } = require('./domains/notifications/notification-service');
const { registerNotificationRoutes } = require('./domains/notifications/notification-routes');
const { createModerationRepository } = require('./domains/moderation/moderation-repository');
const { createActiveBanService } = require('./domains/moderation/active-ban-service');
const { createModerationService } = require('./domains/moderation/moderation-service');
const { createMessageModerationService } = require('./domains/moderation/message-moderation-service');
const { registerModerationRoutes } = require('./domains/moderation/moderation-routes');
const { createAttachmentRepository } = require('./domains/media/attachment-repository');
const { createMediaJobRepository } = require('./domains/media/media-job-repository');
const { createMediaStorage } = require('./domains/media/storage');
const { createMediaPressureService } = require('./domains/media/media-pressure-service');
const { createMediaQuotaRepository } = require('./domains/media/media-quota-repository');
const { createMediaQuotaService } = require('./domains/media/media-quota-service');
const { createMediaService, MAX_UPLOAD_BYTES } = require('./domains/media/media-service');
const { createMediaVisibilityService } = require('./domains/media/media-visibility-service');
const { registerMediaRoutes } = require('./domains/media/media-routes');
const { createCursorCodec } = require('./platform/cursor-codec');
const { createRuntimeReadinessProvider } = require('./platform/runtime-readiness');
const { registerCapabilityRoutes } = require('./platform/capability-routes');
const { mentionUserIdsFromContent } = require('@voice-room/shared/mentions');

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
const LIVEKIT_TOKEN_TTL_SECONDS = readEnvInt('LIVEKIT_TOKEN_TTL_SECONDS', 21600, 60);
const LIVEKIT_GATE_PUBLIC_URL = cleanLiveKitUrl(process.env.LIVEKIT_GATE_PUBLIC_URL || process.env.LIVEKIT_URL || '');
const LIVEKIT_GATE_SECRET = (process.env.LIVEKIT_GATE_SECRET || '').trim();
const ROOM_IDLE_TTL_MS = readEnvInt('ROOM_IDLE_TTL_MS', 900000, 1000);
const ROOM_PRUNE_INTERVAL_MS = readEnvInt('ROOM_PRUNE_INTERVAL_MS', 60000, 0);
// Room history is kept until a message or its room is deleted. Both limits
// accept 0 as "no limit", which is the default: a room chat is a durable log,
// not a rolling window. Set them to a positive value to re-enable trimming.
const ROOM_CHAT_TTL_MS = readEnvInt('ROOM_CHAT_TTL_MS', 0, 0);
const ROOM_CHAT_MAX_MESSAGES = readEnvInt('ROOM_CHAT_MAX_MESSAGES', 0, 0);
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
// Cap concurrent realtime (WebSocket) connections per user so a single account
// cannot pin an unbounded number of keep-alive connections.
const MAX_REALTIME_STREAMS_PER_USER = readEnvInt('MAX_REALTIME_STREAMS_PER_USER', 8, 1);
const MAX_GUEST_STREAMS_PER_IP = readEnvInt('MAX_GUEST_STREAMS_PER_IP', 8, 1);
const WS_MAX_PAYLOAD_BYTES = readEnvInt('WS_MAX_PAYLOAD_BYTES', 64 * 1024, 1024);
const RETENTION_PURGE_INTERVAL_MS = readEnvInt('RETENTION_PURGE_INTERVAL_MS', 60 * 60 * 1000, 0);
const RETENTION_KEEP_DELETED_MS = readEnvInt('RETENTION_KEEP_DELETED_MS', 30 * 24 * 60 * 60 * 1000, 60000);
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

function getLogLevel(env = process.env) {
  const configured = (env.LOG_LEVEL || '').trim();
  if (configured) return configured;
  return env.NODE_ENV === 'production' ? 'info' : 'silent';
}

function createFastifyLoggerOptions(env = process.env) {
  const level = getLogLevel(env).toLowerCase();
  if (['false', 'off', 'none', 'silent'].includes(level)) return false;
  return { level };
}

function getRoomStore() {
  if (!roomStore) {
    roomStore = createRoomStore({
      maxMessagesPerRoom: ROOM_CHAT_MAX_MESSAGES,
      messageTtlMs: ROOM_CHAT_TTL_MS,
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
    console.error('Failed to refresh room pins after message mutation:', error);
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

function requestIdempotencyKey(req, body) {
  const value = req?.headers?.['idempotency-key'] ?? body?.idempotencyKey;
  const key = typeof value === 'string' ? value.trim() : '';
  return key.length >= 8 && key.length <= 160 ? key : '';
}

function messageFingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
    })().catch((error) => console.error('Failed to dispatch durable message event:', error));
  };
  client.on('notification', onNotification);
  client.on('error', (error) => console.error('Message delivery listener failed:', error));
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
        return isLiveKitGatePrincipal(principal) ? [principal] : [];
      }
      const room = await getRoom(roomId);
      if (!room || !guestIp) return [];
      return [...room.peers.values()]
        .filter((peer) => !peer.accountUserId && peer.ip === guestIp)
        .map((peer) => liveKitGatePrincipalForPeer(roomId, peer))
        .filter(isLiveKitGatePrincipal);
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

function normalizeAttachmentIds(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 4) return null;
  const ids = value.map((id) => cleanUuid(id));
  return ids.every(Boolean) && new Set(ids).size === ids.length ? ids : null;
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
    credentialTtlMs: LIVEKIT_TOKEN_TTL_SECONDS * 1000
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
    console.error('Failed to send push notification:', error);
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
    console.error('Failed to broadcast DM notification:', error);
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

let desktopReleaseCache = { at: 0, data: null };
let desktopReleaseFetchPromise = null;
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
  return getUserStore().getSessionUser(token, Date.now(), {
    userAgent: String(req.headers?.['user-agent'] || ''),
    resolveLocation: () => getGeoLocator().locate(getClientIp(req, TRUST_PROXY))
  });
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
    console.error('Failed to record a sign-in:', error);
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
  return user?.id ? normalizePeerId(`auth-${user.id}`) : '';
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

function requestHost(req) {
  const host = req.headers?.host;
  return typeof host === 'string' ? host.toLowerCase() : '';
}

function originHost(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return '';
  }
}

function requestHasUnsafeMethod(req) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase());
}

function hasValidSameOrigin(req) {
  const host = requestHost(req);
  if (!host) return false;
  const origin = req.headers?.origin;
  if (typeof origin === 'string' && origin) return originHost(origin) === host;
  const referer = req.headers?.referer;
  if (typeof referer === 'string' && referer) return originHost(referer) === host;
  return true;
}

function rejectCrossOriginCookieWrite(req, res) {
  if (!requestHasUnsafeMethod(req)) return false;
  if (!getSessionToken(req)) return false;
  const hasBrowserOrigin = Boolean(req.headers?.origin || req.headers?.referer);
  if (!hasBrowserOrigin || hasValidSameOrigin(req)) return false;
  sendJson(res, 403, { ok: false, error: 'Cross-origin request rejected' });
  return true;
}

function getLiveKitRoomName(roomId) {
  const prefix = String(process.env.LIVEKIT_ROOM_PREFIX || 'voice-room-').replace(/[^A-Za-z0-9_.:-]/g, '-');
  return `${prefix}${roomId}`;
}

function getLiveKitConfig() {
  const url = cleanLiveKitUrl(process.env.LIVEKIT_INTERNAL_URL || process.env.LIVEKIT_URL || '');
  const gateUrl = cleanLiveKitUrl(LIVEKIT_GATE_PUBLIC_URL || url);
  const apiKey = process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_KEY.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET && process.env.LIVEKIT_API_SECRET.trim();
  const adminUrl = getLiveKitHttpUrl(url);
  const publicGateHttpUrl = getLiveKitHttpUrl(gateUrl);
  return {
    adminUrl,
    apiKey,
    apiSecret,
    enabled: Boolean(url && gateUrl && apiKey && apiSecret && adminUrl !== publicGateHttpUrl),
    gateSecret: LIVEKIT_GATE_SECRET,
    gateUrl,
    url
  };
}

function getLiveKitHttpUrl(url) {
  return String(url || '').replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
}

function createRoomId() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(10);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

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

function startPruneTimer(server, logger = console) {
  // Reap WS connections whose clients stopped heartbeating (half-open sockets
  // never emit 'close'), otherwise dead peers linger in rosters and friends
  // stay "online" forever.
  const wsTimer = setInterval(() => {
    try {
      wsRegistry?.pruneStale();
    } catch (error) {
      logger.error('WS prune timer failed:', error);
    }
  }, KEEPALIVE_MS);
  if (typeof wsTimer.unref === 'function') wsTimer.unref();
  server.once('close', () => clearInterval(wsTimer));

  if (ROOM_PRUNE_INTERVAL_MS <= 0) return null;

  const timer = setInterval(() => {
    void observeMaintenance('room_prune', () => pruneRooms()).catch((error) => {
      logger.error('Room prune timer failed:', error);
    });
    void observeMaintenance('session_prune', () => getUserStore().pruneSessions())
      .catch((error) => {
        logger.error('Session prune timer failed:', error);
      });
    void observeMaintenance('login_event_prune', () => getUserStore().pruneLoginEvents())
      .catch((error) => {
        logger.error('Sign-in history prune timer failed:', error);
      });
    if (RETENTION_PURGE_INTERVAL_MS > 0 && getRoomStore().purgeDeleted) {
      void observeMaintenance('retention_purge', () => getRoomStore().purgeDeleted({ olderThanMs: RETENTION_KEEP_DELETED_MS }))
        .catch((error) => {
          logger.error('Retention purge timer failed:', error);
        });
    }
  }, ROOM_PRUNE_INTERVAL_MS);

  if (typeof timer.unref === 'function') timer.unref();
  server.once('close', () => clearInterval(timer));
  return timer;
}

async function countRoomCreationQuotaRoomsForIp(clientIp) {
  return getRoomStore().countQuotaRoomsForIp(clientIp);
}

async function createRoomForRequest(creatorIp, { isStatic = false, ownerId = null, name = '' } = {}) {
  let roomId = createRoomId();
  while (getRoomStore().roomIdExists ? await getRoomStore().roomIdExists(roomId) : await getRoomStore().getRoom(roomId)) {
    roomId = createRoomId();
  }

  return getRoomStore().createRoomWithQuota({
    creatorIp,
    isStatic,
    ownerId,
    name,
    maxOwnedStaticRoomsPerUser: MAX_STATIC_ROOMS_PER_USER,
    maxRooms: MAX_ROOMS,
    maxTempRoomsPerIp: MAX_TEMP_ROOMS_PER_IP,
    roomId
  });
}

async function getRoom(roomId) {
  const room = await getRoomStore().getRoom(roomId);
  if (!room) return null;
  room.updatedAt = Date.now();
  return attachPresence(room);
}

function publicPeer(peer) {
  return {
    accountUserId: peer.accountUserId || '',
    avatarAccent: peer.avatarAccent || null,
    avatarColorKey: peer.avatarColorKey || avatarColorForPeerId(peer.id),
    avatarUrl: peer.avatarUrl || null,
    deafened: peer.deafened,
    id: peer.id,
    joinedAt: peer.joinedAt,
    muted: peer.muted,
    name: peer.name,
    screen: peer.screen,
    serverMuted: Boolean(peer.serverMuted),
    screenAudio: peer.screenAudio,
    screenProfileId: peer.screenProfileId,
    screenStreamId: peer.screenStreamId,
    viewedScreenPeerId: peer.viewedScreenPeerId
  };
}

function tokensMatch(expected, actual) {
  if (!expected || !actual || expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

function getAuthorizedPeer(roomId, peerId, sessionToken) {
  const room = presenceRooms.get(roomId);
  const peer = room?.peers.get(peerId);
  if (!room || !peer || !tokensMatch(peer.sessionToken, sessionToken)) return null;
  return { peer, room };
}

async function findRoomBan(roomId, userId, ip) {
  if (!roomId) return null;
  const service = getActiveBanService();
  if (service) return service.getActiveBan({ roomId, userId: userId || null, ip: ip || '' });
  if (typeof getRoomStore().findActiveRoomBan !== 'function') return null;
  return getRoomStore().findActiveRoomBan({ roomId, userId: userId || null, ip: ip || '' });
}

function sendRoomBanned(res, roomId) {
  sendJson(res, 403, { ok: false, code: 'room_banned', error: 'Вы заблокированы в этой комнате', roomId });
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
      console.error('Failed to retry room occupancy persistence:', error);
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
      console.error('Failed to persist room occupancy:', error);
    });
  } else {
    room.updatedAt = Date.now();
  }
}

function parseBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function cleanChatText(value) {
  // Preserve newlines for multiline chat (2.4.0); collapse only horizontal runs.
  // Cap consecutive blank lines and total lines; length cap remains.
  let text = String(value || '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const lines = text.split('\n');
  if (lines.length > 20) {
    text = lines.slice(0, 20).join('\n');
  }
  return text.slice(0, 500);
}

function publicChatMessage(message) {
  return {
    authorUserId: message.authorUserId || null,
    avatarAccent: message.avatarAccent || null,
    avatarColorKey: message.avatarColorKey || avatarColorForPeerId(message.peerId),
    avatarUrl: message.avatarUrl || (message.avatarKey
      ? `/api/avatars/${encodeURIComponent(message.avatarKey)}`
      : null),
    createdAt: message.createdAt,
    editedAt: message.editedAt || null,
    expiresAt: message.expiresAt,
    id: message.id,
    name: message.name,
    peerId: message.peerId,
    roomId: message.roomId,
    text: message.text,
    content: message.content,
    attachments: Array.isArray(message.attachments) ? message.attachments : [],
    replyTo: message.replyTo,
    replyPreview: message.replyPreview
  };
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

async function revokeIssuedAdmission({ boundary = getCredentialBoundary(), cause, credentialId, principal, recordFailure = recordCredentialRevokeCleanupFailure, req, roomId }) {
  try {
    const revoked = await boundary.revokeCredential({ credentialId, roomId, principal });
    if (revoked?.status !== 'revoked') {
      const error = new Error('Issued admission credential cleanup was refused');
      error.code = 'credential_revoke_cleanup_refused';
      throw error;
    }
  } catch (cleanupError) {
    recordFailure();
    req?.log?.error?.({ cleanupError, code: 'credential_revoke_cleanup_failed', roomId }, 'Issued admission credential cleanup failed');
    if (cause) throw new AggregateError([cause, cleanupError], 'Admission persistence and credential cleanup both failed', { cause });
    throw cleanupError;
  }
}

async function handleLiveKitToken(req, res) {
  const livekit = getLiveKitConfig();
  const body = await readJsonBody(req);
  const roomId = normalizeRoomId(body.roomId);
  const peerId = normalizePeerId(body.peerId);
  const sessionToken = normalizeSessionToken(body.sessionToken);
  const name = cleanName(body.name);
  const sessionUser = await resolveOptionalSessionUser(req);

  if (!roomId || !peerId || !sessionToken) {
    sendJson(res, 400, { ok: false, error: 'Invalid room, peer, or session token' });
    return;
  }

  const room = await getRoom(roomId);
  if (!room) {
    sendJson(res, 404, { ok: false, error: 'Комната не найдена' });
    return;
  }

  if (await findRoomBan(roomId, sessionUser?.id, getClientIp(req, TRUST_PROXY))) {
    sendRoomBanned(res, roomId);
    return;
  }

  const provider = getLiveKitCredentialProvider();
  if (!provider && !livekit.enabled) {
    sendJson(res, 503, {
      ok: false,
      error: 'LiveKit не настроен: проверьте LIVEKIT_URL, LIVEKIT_API_KEY и LIVEKIT_API_SECRET'
    });
    return;
  }
  if (!provider && (!livekit.gateSecret || livekit.gateSecret.length < 32)) {
    sendJson(res, 503, {
      ok: false,
      code: 'livekit_gate_unavailable',
      error: 'LiveKit gate is not configured'
    });
    return;
  }

  const existingPeer = room.peers.get(peerId);
  if (existingPeer && !tokensMatch(existingPeer.sessionToken, sessionToken)) {
    sendJson(res, 403, { ok: false, error: 'Сессия участника недействительна' });
    return;
  }
  const identityResult = await getRoomStore().getOrCreatePeerIdentity({ roomId, peerId, sessionToken, displayName: name, avatarColorKey: sessionAvatarColorKey(sessionUser) });
  if (identityResult.status === 'token_mismatch') {
    sendJson(res, 403, { ok: false, error: 'Сессия участника недействительна' });
    return;
  }
  const principal = getRoomStore().normalizeGatePrincipal({
    accountUserId: sessionUser?.id || null,
    guestPrincipalId: identityResult.identity?.id || '',
    roomId
  });
  if (!principal) {
    sendJson(res, 503, { ok: false, code: 'livekit_gate_principal_unavailable', error: 'LiveKit gate principal unavailable' });
    return;
  }
  let serverMuted;
  try {
    if (typeof getRoomStore().isRoomServerMuted !== 'function') {
      throw new Error('Server mute authority is unavailable');
    }
    serverMuted = await getRoomStore().isRoomServerMuted({ roomId, principal });
  } catch (error) {
    req?.log?.error?.({ err: error, roomId }, 'Failed to resolve persisted server mute before LiveKit admission');
    sendJson(res, 503, {
      ok: false,
      code: 'server_mute_unavailable',
      error: 'Voice moderation state is unavailable'
    });
    return;
  }
  const livekitRoom = getLiveKitRoomName(roomId);
  let memberships = null;
  if (sessionUser?.id) {
    memberships = getMembershipServices();
    if (!memberships) {
      sendJson(res, 503, { ok: false, code: 'membership_unavailable', error: 'Membership service unavailable' });
      return;
    }
  }

  if (!provider) {
    sendJson(res, 503, { ok: false, code: 'livekit_gate_unavailable', error: 'LiveKit gate unavailable' });
    return;
  }
  let issued = await provider.issueAdmission({
    canPublishMicrophone: !serverMuted,
    livekitRoom,
    name,
    peerId,
    principal,
    roomId
  });
  if (issued.status !== 'issued') {
    sendJson(res, 503, { ok: false, code: 'livekit_gate_credential_unavailable', error: 'LiveKit gate unavailable' });
    return;
  }
  try {
    const currentServerMuted = await getRoomStore().isRoomServerMuted({ roomId, principal });
    if (currentServerMuted !== serverMuted) {
      await revokeIssuedAdmission({ credentialId: issued.admission.gateCredentialId, principal, req, roomId });
      serverMuted = currentServerMuted;
      issued = await provider.issueAdmission({
        canPublishMicrophone: !serverMuted,
        livekitRoom,
        name,
        peerId,
        principal,
        roomId
      });
      if (issued.status !== 'issued') {
        sendJson(res, 503, { ok: false, code: 'livekit_gate_credential_unavailable', error: 'LiveKit gate unavailable' });
        return;
      }
    }
  } catch (error) {
    await revokeIssuedAdmission({ cause: error, credentialId: issued.admission.gateCredentialId, principal, req, roomId });
    throw error;
  }

  if (await findRoomBan(roomId, sessionUser?.id, getClientIp(req, TRUST_PROXY))) {
    await getCredentialBoundary().revokePrincipal({ principal, roomId });
    sendRoomBanned(res, roomId);
    return;
  }

  if (sessionUser?.id) {
    let persistedMembership;
    try {
      persistedMembership = await memberships.service.persistSuccessfulAdmission({
        roomId,
        userId: sessionUser.id,
        ip: getClientIp(req, TRUST_PROXY),
        admissionSucceeded: true
      });
    } catch (error) {
      await revokeIssuedAdmission({ cause: error, credentialId: issued.admission.gateCredentialId, principal, req, roomId });
      throw error;
    }
    if (persistedMembership.status !== 'active') {
      await revokeIssuedAdmission({ credentialId: issued.admission.gateCredentialId, principal, req, roomId });
      if (persistedMembership.status === 'banned') {
        sendRoomBanned(res, roomId);
      } else {
        sendJson(res, 503, { ok: false, code: 'membership_persist_failed', error: 'Membership unavailable' });
      }
      return;
    }
  }

  sendJson(res, 200, {
    ok: true,
    ...issued.admission
  });
}

function handlePowChallenge(req, res) {
  pow.prune();

  if (ROOM_CREATE_POW_DIFFICULTY <= 0) {
    sendJson(res, 200, { ok: true, required: false });
    return;
  }

  const now = Date.now();
  sendJson(res, 200, {
    ok: true,
    algorithm: 'sha256',
    challenge: pow.createChallenge(getClientIp(req, TRUST_PROXY), now),
    difficulty: ROOM_CREATE_POW_DIFFICULTY,
    expiresAt: now + ROOM_CREATE_POW_TTL_MS,
    required: true
  });
}

async function handleCreateRoom(req, res) {
  const rate = roomCreateLimiter.check(getClientIp(req, TRUST_PROXY));
  if (!rate.allowed) {
    sendJson(
      res,
      429,
      { ok: false, error: 'Too many rooms created, try again later' },
      { 'Retry-After': String(rate.retryAfterSeconds) }
    );
    return;
  }

  const body = await readJsonBody(req);
  const proof = pow.verify(getClientIp(req, TRUST_PROXY), body.proof);
  if (!proof.ok) {
    sendJson(res, proof.status, { ok: false, error: proof.error });
    return;
  }

  const clientIp = getClientIp(req, TRUST_PROXY);
  const isStatic = parseBoolean(body.isStatic);
  const name = cleanRoomName(body.name);
  // Persistent rooms are tied to the account that creates them so they can be
  // listed back from any device; temporary rooms stay ownerless.
  const session = isStatic ? await resolveSessionUser(req) : null;
  if (isStatic && !session) {
    sendJson(res, 401, { ok: false, error: 'Требуется вход для создания постоянной комнаты' });
    return;
  }
  const ownerId = session?.user?.id ?? null;
  const created = await createRoomForRequest(clientIp, {
    isStatic,
    ownerId,
    name
  });
  if (created.status === 'auth_required') {
    sendJson(res, 401, { ok: false, error: 'Требуется вход для создания постоянной комнаты' });
    return;
  }
  if (created.status === 'quota_exceeded') {
    sendJson(res, 429, {
      ok: false,
      error: isStatic
        ? 'Можно владеть максимум 3 постоянными комнатами'
        : 'Too many temporary rooms waiting from this IP, reuse one or try later'
    });
    return;
  }
  if (created.status === 'capacity_exceeded') {
    sendJson(res, 503, { ok: false, error: 'Room capacity is temporarily full' });
    return;
  }

  const room = created.room;
  sendJson(res, 201, {
    ok: true,
    avatarUrl: null,
    createdAt: room.createdAt,
    maxRooms: MAX_ROOMS,
    maxRoomPeers: MAX_ROOM_PEERS,
    isStatic: room.isStatic,
    name: room.name,
    owned: Boolean(room.ownerId),
    roomId: room.id
  });
}

// Shared auth + ownership gate for room mutations. Returns the room on success,
// or null after writing the appropriate error response (401/403/404).
async function authorizeRoomMutation(req, res, roomId) {
  const session = await resolveSessionUser(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Требуется вход' });
    return null;
  }
  const room = await getRoom(roomId);
  if (!room) {
    sendJson(res, 404, { ok: false, error: 'Комната не найдена' });
    return null;
  }
  if (!room.isStatic || room.ownerId !== session.user.id) {
    sendJson(res, 403, { ok: false, error: 'Недостаточно прав' });
    return null;
  }
  return room;
}

async function handleUpdateRoom(req, res, roomId) {
  const room = await authorizeRoomMutation(req, res, roomId);
  if (!room) return;

  const body = await readJsonBody(req);

  // Legacy visual fields are intentionally ignored during the deployment
  // transition; only the room name remains mutable.
  const nextName = body.name !== undefined ? cleanRoomName(body.name) : room.name;
  if (!nextName) {
    sendJson(res, 400, { ok: false, error: 'Дайте комнате название' });
    return;
  }
  const updated = await getRoomStore().updateRoom(roomId, {
    name: nextName
  });
  if (!updated) {
    // Lost a race with a concurrent delete (UPDATE matched 0 rows).
    sendJson(res, 404, { ok: false, error: 'Комната не найдена' });
    return;
  }

  const payload = publicLobbyRoom(updated);
  const presence = presenceRooms.get(roomId);
  if (presence) broadcast(presence, { type: 'room-updated', room: payload });
  roomRuntime?.mirrorLegacyRoomEvent(roomId, { type: 'room-updated', room: payload });
  roomRuntime?.invalidateRecipientCache(roomId);
  roomRuntime?.scheduleSummaryBroadcast(roomId);

  sendJson(res, 200, { ok: true, room: payload });
}

async function handleDeleteRoom(req, res, roomId, request) {
  const room = await authorizeRoomMutation(req, res, roomId);
  if (!room) return;

  const deleted = await getRoomStore().deleteRoom(roomId);
  if (!deleted) {
    // Lost a race with a concurrent delete (UPDATE matched 0 rows).
    sendJson(res, 404, { ok: false, error: 'Комната не найдена' });
    return;
  }

  // Broadcast after durable soft-delete, before presence teardown so the WS
  // writes are not racing socket close.
  const presence = presenceRooms.get(roomId);
  if (presence) broadcast(presence, { type: 'room-deleted', roomId });
  roomRuntime?.mirrorLegacyRoomEvent(roomId, { type: 'room-deleted', roomId });
  roomRuntime?.invalidateRecipientCache(roomId);
  // Invitations outlive the inviter's session now, so the deleted room is the
  // only thing left that can invalidate them.
  void expireRoomInvitations(null, roomId).catch((error) => {
    console.error('Failed to expire room invitations:', error);
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
  await removeAvatarBestEffort(deleted.avatarKey, request);

  sendJson(res, 200, { ok: true });
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
    { ok: true, user: publicUser(created.user) },
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

  const user = await getUserStore().verifyCredentials(login, password);
  if (!user) {
    sendJson(res, 401, { ok: false, error: 'Неверный логин или пароль' });
    return;
  }

  const device = await sessionDeviceFor(req);
  const session = await getUserStore().createSession({ userId: user.id, ...device });
  await recordAndAnnounceLogin({ userId: user.id, session, device, kind: 'login' });
  sendJson(
    res,
    200,
    { ok: true, user: publicUser(user) },
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

async function handleMe(req, res) {
  const session = await resolveSessionUser(req);
  sendJson(res, 200, { ok: true, user: session ? publicUser(session.user) : null });
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
  sendJson(res, 200, { ok: true, user: publicUser(user) });
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
  sendJson(res, 200, { ok: true, user: publicUser(result.user) });
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
  sendJson(res, 200, { ok: true, user: publicUser(result.user) });
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
    { ok: true, user: publicUser(result.user), recoveryCodes: { remaining: result.remaining } },
    { 'Set-Cookie': buildSessionCookie(session.token, SESSION_TTL_MS / 1000) }
  );
}


function publicLobbyRoom(room) {
  const result = {
    avatarUrl: room.avatarKey ? `/api/avatars/${encodeURIComponent(room.avatarKey)}` : null,
    createdAt: room.createdAt,
    emptySince: room.emptySince,
    isStatic: room.isStatic,
    name: room.name,
    peers: presenceRooms.get(room.id)?.peers.size ?? 0,
    relationship: room.relationship || 'owner',
    roomId: room.id
  };
  if (room.lastMessageAt !== undefined) result.lastMessageAt = room.lastMessageAt;
  if (Number.isFinite(room.unreadCount)) result.unreadCount = Math.max(0, room.unreadCount);
  return result;
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

async function handleAuthRooms(req, res) {
  const session = await resolveSessionUser(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Требуется вход' });
    return;
  }

  const rooms = await getRoomStore().listVisibleRoomsForUser(session.user.id);
  sendJson(res, 200, {
    ok: true,
    rooms: rooms.map(publicLobbyRoom)
  });
}

async function handleAddAuthRoom(req, res) {
  const session = await resolveSessionUser(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Требуется вход' });
    return;
  }

  const body = await readJsonBody(req);
  const roomId = normalizeRoomId(body.roomId || body.code || body.roomCode);
  if (!roomId) {
    sendJson(res, 400, { ok: false, error: 'Неверный код комнаты' });
    return;
  }

  const added = await getRoomStore().addRoomBookmarkForUser(session.user.id, roomId);
  if (added.status === 'not_found') {
    sendJson(res, 404, { ok: false, error: 'Комната не найдена' });
    return;
  }
  if (added.status === 'temporary_room') {
    sendJson(res, 400, { ok: false, error: 'В список можно добавить только постоянную комнату' });
    return;
  }

  roomRuntime?.invalidateRecipientCache(roomId);
  sendJson(res, 200, { ok: true, room: publicLobbyRoom(added.room) });
}

async function handleRemoveAuthRoom(req, res, rawRoomId) {
  const session = await resolveSessionUser(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Требуется вход' });
    return;
  }

  const roomId = normalizeRoomId(rawRoomId);
  if (!roomId) {
    sendJson(res, 404, { ok: false, error: 'Комната не найдена' });
    return;
  }

  const result = await getRoomStore().removeRoomBookmarkForUser(session.user.id, roomId);
  if (result.status === 'owner') {
    sendJson(res, 403, { ok: false, code: 'room_owner', error: 'Владелец управляет комнатой через настройки' });
    return;
  }
  roomRuntime?.invalidateRecipientCache(roomId);
  sendJson(res, 200, { ok: true, removed: result.removed });
}

async function handleMarkRoomChatRead(req, res, rawRoomId) {
  const user = await requireSessionUser(req, res);
  if (!user) return;
  const roomId = normalizeRoomId(rawRoomId);
  if (!roomId) {
    sendJson(res, 404, { ok: false, error: 'Комната не найдена' });
    return;
  }

  const body = await readJsonBody(req);
  if (typeof body.cursor === 'string' && body.cursor) {
    try {
      const result = await getHistoryServices().read.advanceRoom({ cursor: body.cursor, roomId, userId: user.id });
      await retireRoomNotifications(roomId, user.id, result.readThrough);
      await roomRuntime?.sendRoomSummaryToUser(roomId, user.id);
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, error.statusCode || 400, { ok: false, code: error.code || 'invalid_read_cursor', error: error.message });
    }
    return;
  }

  const lastReadAt = await getMessageService().room.markRoomChatRead(roomId, user.id);
  if (lastReadAt == null) {
    sendJson(res, 404, { ok: false, error: 'Комната не найдена' });
    return;
  }
  await retireRoomNotifications(roomId, user.id, lastReadAt);
  await roomRuntime?.sendRoomSummaryToUser(roomId, user.id);
  sendJson(res, 200, { ok: true, lastReadAt, unreadCount: 0 });
}

/**
 * Reading a room's chat retires the notifications it produced. They are two
 * records of the same event, and leaving them apart meant the bell still
 * claimed unread mentions for messages already read — and said so again after
 * every reload. Best-effort: a read that succeeded must not fail over this.
 */
async function retireRoomNotifications(roomId, userId, through) {
  try {
    // No release-2.5 pool means no inbox to retire; that is a quiet no-op, not
    // a TypeError logged on every read.
    const service = getNotificationServices()?.service;
    if (typeof service?.markRoomRead !== 'function') return;
    await service.markRoomRead({ userId, roomId, through: through ?? null });
  } catch (error) {
    console.error('Failed to retire room notifications:', error);
  }
}

async function handleRoomStatus(res, url) {
  const match = url.pathname.match(/^\/rooms\/([A-Za-z0-9_-]{3,48})$/);
  const roomId = match ? normalizeRoomId(match[1]) : '';

  if (!roomId) {
    sendJson(res, 404, { ok: false, exists: false, error: 'Room not found' });
    return;
  }

  const room = await getRoom(roomId);
  if (!room) {
    sendJson(res, 404, { ok: false, exists: false, error: 'Room not found', roomId });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    avatarUrl: room.avatarKey ? `/api/avatars/${encodeURIComponent(room.avatarKey)}` : null,
    createdAt: room.createdAt,
    exists: true,
    emptySince: room.emptySince,
    isStatic: room.isStatic,
    maxRoomPeers: MAX_ROOM_PEERS,
    name: room.name,
    peers: room.peers.size,
    roomId
  });
}

// Read-only snapshot of who is currently in a room. Powers the lobby's room
// preview ("how the room looks before you enter") without creating a peer.
async function handleRoomPeers(res, roomId) {
  const room = await getRoom(roomId);
  if (!room) {
    sendJson(res, 404, { ok: false, error: 'Room not found', roomId });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    roomId,
    peers: Array.from(room.peers.values()).map(publicPeer)
  });
}

const LEGACY_STATE_MUTATION_FIELDS = [
  'name',
  'muted',
  'deafened',
  'screen',
  'screenAudio',
  'screenProfileId',
  'screenStreamId',
  'viewedScreenPeerId'
];

async function handleState(req, res) {
  const body = await readJsonBody(req);
  const roomId = normalizeRoomId(body.roomId);
  const peerId = normalizePeerId(body.peerId);
  const sessionToken = normalizeSessionToken(body.sessionToken);
  const sessionUser = await resolveOptionalSessionUser(req);
  const clientIp = getClientIp(req, TRUST_PROXY);

  // Moderation invalidates and removes the peer before its next state write.
  // Check request identity first so the client still receives the stable ban
  // contract instead of the generic invalid-session response.
  if (await findRoomBan(roomId, sessionUser?.id, clientIp)) {
    sendRoomBanned(res, roomId);
    return;
  }

  const authorized = getAuthorizedPeer(roomId, peerId, sessionToken);

  if (!authorized) {
    sendJson(res, 403, { ok: false, error: 'Invalid peer session' });
    return;
  }

  const { peer } = authorized;

  if (await findRoomBan(roomId, peer.accountUserId, peer.ip)) {
    sendRoomBanned(res, roomId);
    return;
  }

  // A session token identifies the logical peer, not the current transport.
  // Keeping HTTP writes would let a superseded tab mutate the replacement
  // peer. WebSocket updates carry the active connection lease; this legacy
  // route remains read-only for compatibility and introspection.
  if (LEGACY_STATE_MUTATION_FIELDS.some((field) => Object.hasOwn(body, field))) {
    sendJson(res, 409, {
      ok: false,
      code: 'state_updates_require_websocket',
      error: 'Peer state updates require the active WebSocket connection'
    });
    return;
  }

  sendJson(res, 200, { ok: true, peer: publicPeer(peer) });
}

async function handleRoomChatList(res, roomId) {
  const room = await getRoom(roomId);
  if (!room) {
    sendJson(res, 404, { ok: false, error: 'Room not found', roomId });
    return;
  }

  const storedMessages = await getMessageService().room.listMessages(roomId, { limit: 100 });
  const messages = await Promise.all(storedMessages.map(async (message) => attachReplyProjection(
    'room',
    await attachMediaProjection('room', message),
    { roomId }
  )));
  sendJson(res, 200, {
    ok: true,
    messages: messages.map(publicChatMessage),
    roomId
  });
}

async function handleRoomChatPost(req, res, roomId) {
  const room = await getRoom(roomId);
  const clientIp = getClientIp(req, TRUST_PROXY);
  const body = await readJsonBody(req);
  const requestedPeerId = normalizePeerId(body.peerId);
  const sessionToken = normalizeSessionToken(body.sessionToken);
  const sessionUser = await resolveOptionalSessionUser(req);
  const requestedName = cleanName(body.name);
  let text = cleanChatText(body.text);
  let content;
  let mentionUserIds = [];
  if (body.content != null) {
    if (!release250FeatureEnabled('engagement')) {
      sendJson(res, 409, { ok: false, error: 'Structured messages are unavailable' });
      return;
    }
    try {
      const prepared = createContentRepository().prepareWrite({ content: body.content, text });
      content = prepared.content;
      text = prepared.text;
      const mentions = mentionUserIdsFromContent(content, { creatorUserId: sessionUser?.id || '' });
      if (!mentions.ok) {
        sendJson(res, 422, { ok: false, code: mentions.code, error: 'Invalid mention target' });
        return;
      }
      mentionUserIds = mentions.userIds;
    } catch {
      sendJson(res, 400, { ok: false, code: 'invalid_message_content', error: 'Invalid message content' });
      return;
    }
  }
  const attachmentIds = normalizeAttachmentIds(body.attachmentIds);
  const replyToMessageId = body.replyTo == null ? '' : cleanUuid(body.replyTo?.messageId);
  const idempotencyKey = requestIdempotencyKey(req, body);

  if (!room) {
    sendJson(res, 404, { ok: false, error: 'Room not found', roomId });
    return;
  }

  if (await findRoomBan(roomId, sessionUser?.id, clientIp)) {
    sendRoomBanned(res, roomId);
    return;
  }

  if (attachmentIds === null) {
    sendJson(res, 400, { ok: false, error: 'Invalid attachments' });
    return;
  }
  if (body.replyTo != null && (!replyToMessageId || !release250FeatureEnabled('replies'))) {
    sendJson(res, 409, { ok: false, error: 'Reply target is unavailable' });
    return;
  }

  if (!text && attachmentIds.length === 0) {
    sendJson(res, 400, { ok: false, error: 'Invalid chat message' });
    return;
  }

  const rate = roomChatLimiter.check(`${clientIp}:${roomId}`);
  if (!rate.allowed) {
    sendJson(
      res,
      429,
      { ok: false, error: 'Too many chat messages', retryAfterSeconds: rate.retryAfterSeconds },
      { 'Retry-After': String(rate.retryAfterSeconds) }
    );
    return;
  }

  const authenticatedPeerId = requestedPeerId ? '' : sessionChatPeerId(sessionUser);
  let peerId = requestedPeerId || authenticatedPeerId;
  let avatarColorKey = sessionAvatarColorKey(sessionUser) || avatarColorForPeerId(peerId);
  const activePeer = requestedPeerId ? room.peers.get(requestedPeerId) : null;
  if (activePeer) {
    if (!tokensMatch(activePeer.sessionToken, sessionToken)) {
      sendJson(res, 403, { ok: false, error: 'Invalid peer session' });
      return;
    }
    if (await findRoomBan(roomId, activePeer.accountUserId, activePeer.ip || clientIp)) {
      sendRoomBanned(res, roomId);
      return;
    }
    peerId = activePeer.id;
    if (sessionAvatarColorKey(sessionUser)) activePeer.avatarColorKey = sessionAvatarColorKey(sessionUser);
    avatarColorKey = activePeer.avatarColorKey || avatarColorForPeerId(peerId);
  } else if (!sessionUser) {
    sendJson(res, 403, { ok: false, error: 'Active room presence or login required' });
    return;
  }

  let authorUser = sessionUser;
  if (!authorUser && activePeer?.accountUserId) {
    try {
      authorUser = await getUserStore().getUserById(activePeer.accountUserId);
    } catch (error) {
      console.error('Failed to resolve room chat author profile:', error);
    }
  }

  const name = sessionDisplayName(authorUser) || activePeer?.name || requestedName;
  const authorUserId = authorUser?.id || activePeer?.accountUserId || null;
  const media = attachmentIds.length > 0 ? getMediaServices() : null;
  const replies = replyToMessageId ? createReplyRepository({ client: getRelease250Pool() }) : null;
  const notifications = getNotificationServices();
  const delivery = getMessageDeliveryServices();
  let idempotencyLedgerKey = '';
  let replyPreview;
  let replyTargetUserId = null;
  if (attachmentIds.length > 0 && (!authorUserId || !media || !release250FeatureEnabled('mediaUploads'))) {
    sendJson(res, 503, { ok: false, error: 'Media uploads are unavailable' });
    return;
  }
  const now = Date.now();
  const message = await getMessageService().room.appendMessage(roomId, {
    createdAt: now,
    expiresAt: ROOM_CHAT_TTL_MS > 0 ? now + ROOM_CHAT_TTL_MS : null,
    id: crypto.randomUUID?.() || crypto.randomBytes(16).toString('hex'),
    avatarColorKey,
    name,
    peerId,
    text,
    content,
    authorUserId,
    replyToMessageId: replyToMessageId || null,
    beforeUnitOfWork: idempotencyKey && delivery
      ? async (client) => {
          const reservation = await delivery.idempotency.reserve(client, {
            actorType: authorUserId ? 'account' : 'guest',
            actorId: authorUserId || peerId,
            conversation: { type: 'room', id: roomId },
            key: idempotencyKey,
            fingerprint: messageFingerprint({ text, content, attachmentIds, replyToMessageId })
          });
          if (reservation.kind === 'replay') {
            return { replay: true, message: reservation.response.body?.message };
          }
          idempotencyLedgerKey = reservation.ledgerKey;
          return null;
        }
      : null,
    unitOfWork: attachmentIds.length > 0 || replyToMessageId || mentionUserIds.length > 0 || delivery
      ? async (client, inserted) => {
          if (replyToMessageId) {
            const target = await replies.lockRoomTarget({ roomId, messageId: replyToMessageId, client });
            replyPreview = await requireReplyTarget({ message: target, visibility: true });
            replyTargetUserId = target?.authorUserId || null;
          }
          if (attachmentIds.length > 0) {
            await media.attachments.bindReady({
              ownerId: authorUserId,
              context: 'room',
              messageId: inserted.id,
              attachmentIds
            }, client);
          }
          if (
            authorUserId
            && notifications
            && release250FeatureEnabled('engagement')
            && (mentionUserIds.length > 0 || replyTargetUserId)
          ) {
            await notifications.service.createAddressedForMessage({
              roomId,
              messageId: inserted.id,
              creatorUserId: authorUserId,
              targetUserIds: mentionUserIds,
              replyTargetUserId,
              body: text,
              client
            });
          }
          if (delivery) {
            const deliveryMessage = {
              ...inserted,
              name,
              avatarAccent: authorUser?.avatarAccent || activePeer?.avatarAccent || null,
              avatarColorKey,
              avatarKey: authorUser?.avatarKey || null,
              avatarUrl: authorUser?.avatarKey
                ? `/api/avatars/${encodeURIComponent(authorUser.avatarKey)}`
                : activePeer?.avatarUrl || null
            };
            await delivery.outbox.enqueue(client, {
              eventId: crypto.randomUUID(),
              type: 'message.created',
              conversation: { type: 'room', id: roomId },
              messageId: inserted.id,
              message: deliveryMessage
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

  if (!message) {
    sendJson(res, 400, { ok: false, error: 'Invalid chat message' });
    return;
  }

  const projectedBase = await attachMediaProjection('room', message);
  const projectedMessage = message.idempotencyReplay
    ? await attachReplyProjection('room', projectedBase, { roomId })
    : { ...projectedBase, replyPreview };
  const publicMessage = {
    ...projectedMessage,
    name,
    avatarAccent: authorUser?.avatarAccent || activePeer?.avatarAccent || null,
    avatarColorKey,
    avatarUrl: authorUser?.avatarKey
      ? `/api/avatars/${encodeURIComponent(authorUser.avatarKey)}`
      : activePeer?.avatarUrl || null
  };
  if (!message.idempotencyReplay && MESSAGE_DIRECT_EMIT_ENABLED) roomRuntime?.broadcastChatMessage(roomId, publicMessage);
  sendJson(res, 201, { ok: true, message: publicChatMessage(publicMessage) });
}

async function removeLiveKitParticipant(roomId, peerId) {
  const livekit = getLiveKitConfig();
  if (!livekit.enabled) return;
  const service = new RoomServiceClient(livekit.adminUrl, livekit.apiKey, livekit.apiSecret);
  try {
    await service.removeParticipant(getLiveKitRoomName(roomId), peerId);
  } catch (error) {
    if (!/not.?found/i.test(String(error?.message || ''))) {
      console.error('Failed to remove moderated LiveKit participant:', error);
    }
  }
}

// Server mute is enforced at the SFU, not just in the client: microphone is
// removed from the participant's allowed sources while screen sharing and data
// remain intact, and the live microphone track is muted immediately. A failed
// mute falls back to disconnecting the participant; the durable row then keeps
// microphone out of every freshly issued admission token.
function resolveServerMutePermission(currentPermission = {}, muted) {
  const declaredSources = Array.isArray(currentPermission.canPublishSources)
    ? currentPermission.canPublishSources
    : [];
  const currentSources = declaredSources.length > 0
    ? declaredSources
    : [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO];
  const canPublishSources = muted
    ? currentSources.filter((source) => source !== TrackSource.MICROPHONE)
    : [...new Set([...currentSources, TrackSource.MICROPHONE])];
  return { ...currentPermission, canPublishSources };
}

async function setLiveKitParticipantMuted(roomId, peerId, muted) {
  const livekit = getLiveKitConfig();
  if (!livekit.enabled) return;
  const service = new RoomServiceClient(livekit.adminUrl, livekit.apiKey, livekit.apiSecret);
  const roomName = getLiveKitRoomName(roomId);
  try {
    const participant = await service.getParticipant(roomName, peerId);
    // Preserve every unrelated grant. A microphone moderation action must not
    // widen subscriptions/data grants or revoke screen-share publication.
    await service.updateParticipant(
      roomName,
      peerId,
      undefined,
      resolveServerMutePermission(participant?.permission || {}, muted)
    );
    if (muted) {
      // Microphone only — a moderator mute must not silence the participant's
      // screen-share audio.
      const microphoneTracks = (participant?.tracks || [])
        .filter((track) => track.source === TrackSource.MICROPHONE && !track.muted);
      for (const track of microphoneTracks) {
        await service.mutePublishedTrack(roomName, peerId, track.sid, true);
      }
    }
  } catch (error) {
    if (/not.?found/i.test(String(error?.message || ''))) return { status: 'offline' };
    console.error('Failed to apply LiveKit server mute:', error);
    if (muted) {
      try {
        await service.removeParticipant(roomName, peerId);
        return { status: 'disconnected' };
      } catch (disconnectError) {
        throw new AggregateError([error, disconnectError], 'LiveKit server mute and disconnect both failed', { cause: error });
      }
    }
    throw error;
  }
  return { status: 'applied' };
}

function liveKitGatePrincipalForPeer(roomId, peer) {
  return getRoomStore().normalizeGatePrincipal({
    accountUserId: peer.accountUserId || null,
    guestPrincipalId: peer.gateGuestPrincipalId || '',
    roomId
  });
}

function isLiveKitGatePrincipal(principal) {
  return (principal?.principalType === 'account' || principal?.principalType === 'guest')
    && typeof principal.principalId === 'string'
    && principal.principalId.trim().length > 0;
}

async function runModeratedPeerCleanup(room, peer, type, { gateAlreadyRevoked, ownershipFinalized }) {
  let failure = null;
  if (!ownershipFinalized && !gateAlreadyRevoked && typeof getRoomStore().revokeLiveKitGatePeer === 'function') {
    try {
      await getRoomStore().revokeLiveKitGatePeer({
        roomId: room.id,
        peerId: peer.id,
        accountUserId: peer.accountUserId || null,
        guestPrincipalId: peer.gateGuestPrincipalId || ''
      });
    } catch (error) {
      failure = error;
    }
  }
  const event = { type, roomId: room.id, peerId: peer.id };
  sendEvent(peer, event);
  if (peer.accountUserId) broadcastToUser(peer.accountUserId, event);
  for (const connection of wsRegistry?.connections.values() || []) {
    if (connection.activeVoice?.roomId !== room.id || connection.activeVoice?.peerId !== peer.id) continue;
    connection.activeVoice = null;
    connection.previewRoomIds.delete(room.id);
    wsRegistry.unregisterConnectionForRoom(connection, room.id);
  }
  if (!ownershipFinalized) {
    closePeer(room.id, peer.id, peer.transport?.id, type === 'room.banned' ? 'banned' : 'kicked');
  }
  if (typeof getRoomStore().invalidatePeerIdentity === 'function') {
    try {
      await getRoomStore().invalidatePeerIdentity({ roomId: room.id, peerId: peer.id });
    } catch (error) {
      failure ||= error;
    }
  }
  if (!ownershipFinalized) {
    try {
      await removeLiveKitParticipant(room.id, peer.id);
    } catch (error) {
      failure ||= error;
    }
  }
  if (failure) {
    failure.ownershipFinalized = true;
    throw failure;
  }
  return { finalized: true };
}

async function finalizeModeratedPeers(
  room,
  peers,
  type,
  { gateAlreadyRevoked = false, beforeFinalize = null } = {}
) {
  let prerequisitePromise = null;
  let prerequisiteResult = null;
  const peerById = new Map(peers.map((peer) => [peer.id, peer]));
  const ensurePrerequisite = async () => {
    if (!beforeFinalize) return null;
    prerequisitePromise ||= Promise.resolve().then(beforeFinalize);
    prerequisiteResult = await prerequisitePromise;
    return prerequisiteResult;
  };
  await roomRuntime.finalizeReconnectPeers({
    roomId: room.id,
    peerIds: peers.map((peer) => peer.id),
    reason: type,
    finalizePeer: async ({ peerId, peer: ownedPeer, ownershipFinalized }) => {
      await ensurePrerequisite();
      const target = ownedPeer || peerById.get(peerId);
      return runModeratedPeerCleanup(room, target, type, { gateAlreadyRevoked, ownershipFinalized });
    }
  });
  return prerequisiteResult;
}

async function disconnectModeratedPeer(room, peer, type, { gateAlreadyRevoked = false } = {}) {
  await finalizeModeratedPeers(room, [peer], type, { gateAlreadyRevoked });
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
      console.error('Failed to end voice for an ended account session:', error);
    }
  }
  wsRegistry.closeConnections(targets, SESSION_REVOKED_CLOSE_CODE, 'Session ended');
}

async function handleKickRoomPeer(req, res, roomId) {
  const room = await authorizeRoomMutation(req, res, roomId);
  if (!room) return;
  const body = await readJsonBody(req);
  const peerId = normalizePeerId(body.peerId);
  const peer = peerId ? room.peers.get(peerId) : null;
  if (!peer) {
    sendJson(res, 404, { ok: false, error: 'Участник не найден' });
    return;
  }
  if (peer.accountUserId && peer.accountUserId === room.ownerId) {
    sendJson(res, 400, { ok: false, error: 'Нельзя исключить владельца комнаты' });
    return;
  }
  await disconnectModeratedPeer(room, peer, 'room.kicked');
  sendJson(res, 200, { ok: true });
}

// Owner-only microphone mute. `muted` in the body picks the direction so the
// menu can toggle without tracking which endpoint to call.
async function handleServerMuteRoomPeer(req, res, roomId) {
  const room = await authorizeRoomMutation(req, res, roomId);
  if (!room) return;
  const body = await readJsonBody(req);
  const peerId = normalizePeerId(body.peerId);
  const peer = peerId ? room.peers.get(peerId) : null;
  if (!peer) {
    sendJson(res, 404, { ok: false, error: 'Участник не найден' });
    return;
  }
  if (peer.accountUserId && peer.accountUserId === room.ownerId) {
    sendJson(res, 400, { ok: false, error: 'Нельзя выключить микрофон владельцу комнаты' });
    return;
  }
  const muted = body.muted !== false;

  const principal = liveKitGatePrincipalForPeer(room.id, peer);
  if (!isLiveKitGatePrincipal(principal)) {
    sendJson(res, 400, { ok: false, error: 'Участник не поддерживает модерацию микрофона' });
    return;
  }

  const store = getRoomStore();
  const result = muted
    ? await store.setRoomServerMute({ roomId: room.id, principal, mutedBy: room.ownerId })
    : await store.clearRoomServerMute({ roomId: room.id, principal });
  if (result.status === 'invalid') {
    sendJson(res, 400, { ok: false, error: 'Участник не поддерживает модерацию микрофона' });
    return;
  }

  peer.serverMuted = muted;
  // Muting also forces the local flag on; lifting it does not unmute for them,
  // the participant decides when to speak again.
  if (muted) peer.muted = true;

  await setLiveKitParticipantMuted(room.id, peer.id, muted);

  const event = { type: 'peer-updated', peer: publicPeer(peer) };
  broadcast(room, event);
  roomRuntime?.mirrorLegacyRoomEvent(room.id, event);
  sendEvent(peer, { type: 'room.server-mute', roomId: room.id, peerId: peer.id, muted });
  sendJson(res, 200, { ok: true, muted });
}

async function handleBanRoomPeer(req, res, roomId) {
  const room = await authorizeRoomMutation(req, res, roomId);
  if (!room) return;
  const body = await readJsonBody(req);
  const peerId = normalizePeerId(body.peerId);
  const peer = peerId ? room.peers.get(peerId) : null;
  if (!peer) {
    sendJson(res, 404, { ok: false, error: 'Участник не найден' });
    return;
  }
  if (peer.accountUserId && peer.accountUserId === room.ownerId) {
    sendJson(res, 400, { ok: false, error: 'Нельзя заблокировать владельца комнаты' });
    return;
  }
  // An authenticated participant is a durable account identity. Do not also
  // attach their current IP to the ban: users behind the same NAT (including
  // the room owner) would otherwise be blocked and disconnected as collateral.
  // Guests have no account identity, so their ban remains IP-scoped.
  const bannedUserId = peer.accountUserId || null;
  const bannedIp = bannedUserId ? '' : (peer.ip || '');
  const matchingPeers = [...room.peers.values()].filter((candidate) => bannedUserId
    ? candidate.accountUserId === bannedUserId
    : Boolean(bannedIp && candidate.ip === bannedIp)
  );
  const livekit = getLiveKitConfig();
  const strictGateConfigured = livekit.enabled && livekit.gateSecret?.length >= 32;
  if (!strictGateConfigured) {
    let result = null;
    try {
      await finalizeModeratedPeers(room, matchingPeers, 'room.banned', {
        beforeFinalize: async () => {
          try {
            result = await getRoomStore().createRoomBan({
              roomId,
              userId: bannedUserId,
              ip: bannedIp,
              maxBans: MAX_ROOM_BANS
            });
          } catch (error) {
            error.rollbackTerminal = true;
            throw error;
          }
          if (result.status === 'cap_exceeded') {
            const error = new Error('room_ban_limit');
            error.code = 'room_ban_limit';
            error.rollbackTerminal = true;
            throw error;
          }
          if (!result.ban) {
            const error = new Error('room_ban_failed');
            error.code = 'room_ban_failed';
            error.rollbackTerminal = true;
            throw error;
          }
          return result;
        }
      });
    } catch (error) {
      if (error?.code === 'room_ban_limit') {
        sendJson(res, 409, { ok: false, code: 'room_ban_limit', error: 'Достигнут лимит блокировок комнаты' });
        return;
      }
      if (error?.code === 'room_ban_failed') {
        sendJson(res, 409, { ok: false, error: 'Не удалось сохранить блокировку' });
        return;
      }
      if (!result?.ban) {
        sendJson(res, 500, { ok: false, error: 'Не удалось сохранить блокировку' });
        return;
      }
      // The ban is durable and peer teardown is best-effort but terminal. The
      // cleanup routine continues close/invalidate/remove even if revoke fails.
      req?.log?.warn?.({ code: 'room_ban_peer_cleanup_failed' }, 'Banned peer cleanup finished with errors');
    }
    sendJson(res, 201, { ok: true, banId: result.ban.id });
    return;
  }
  const principals = [];
  for (const candidate of matchingPeers) {
    const principal = liveKitGatePrincipalForPeer(roomId, candidate);
    if (!isLiveKitGatePrincipal(principal)) {
      sendJson(res, 500, { ok: false, code: 'livekit_gate_principal_missing', error: 'Не удалось отозвать доступ участника' });
      return;
    }
    principals.push(principal);
  }
  if (principals.length === 0 || typeof getRoomStore().createRoomBanWithLiveKitGateRevocations !== 'function') {
    sendJson(res, 500, { ok: false, code: 'livekit_gate_revoke_unavailable', error: 'Не удалось отозвать доступ участника' });
    return;
  }
  let result = null;
  try {
    await finalizeModeratedPeers(room, matchingPeers, 'room.banned', {
      gateAlreadyRevoked: true,
      beforeFinalize: async () => {
        try {
          result = await getRoomStore().createRoomBanWithLiveKitGateRevocations({
            roomId,
            userId: bannedUserId,
            ip: bannedIp,
            maxBans: MAX_ROOM_BANS,
            principals
          });
        } catch (error) {
          error.rollbackTerminal = true;
          throw error;
        }
        if (result.status === 'cap_exceeded') {
          const error = new Error('room_ban_limit');
          error.code = 'room_ban_limit';
          error.rollbackTerminal = true;
          throw error;
        }
        if (!result.ban || !Array.isArray(result.revocations) || result.revocations.length === 0) {
          const error = new Error('room_ban_failed');
          error.code = 'room_ban_failed';
          error.rollbackTerminal = true;
          throw error;
        }
        return result;
      }
    });
  } catch (error) {
    if (error?.code === 'room_ban_limit') {
      sendJson(res, 409, { ok: false, code: 'room_ban_limit', error: 'Достигнут лимит блокировок комнаты' });
      return;
    }
    if (error?.code === 'room_ban_failed') {
      sendJson(res, 409, { ok: false, error: 'Не удалось сохранить блокировку' });
      return;
    }
    if (!result?.ban) {
      sendJson(res, 500, { ok: false, error: 'Не удалось сохранить блокировку' });
      return;
    }
    req?.log?.warn?.({ code: 'room_ban_peer_cleanup_failed' }, 'Banned peer cleanup finished with errors');
  }
  sendJson(res, 201, { ok: true, banId: result.ban.id });
}

async function handleUndoRoomBan(req, res, roomId, banId) {
  const room = await authorizeRoomMutation(req, res, roomId);
  if (!room) return;
  const deleted = await getRoomStore().deleteRoomBan({ roomId, banId });
  if (deleted.status !== 'deleted') {
    sendJson(res, 404, { ok: false, error: 'Блокировка не найдена' });
    return;
  }
  sendJson(res, 200, { ok: true });
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

// UUIDs from path params; reject anything that can't be one so a bad value
// doesn't reach the DB as a parameterized-but-nonsensical lookup.
function cleanUuid(value) {
  const id = String(value || '').trim();
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id) ? id : '';
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

async function handleDeleteRoomChatMessage(req, res, roomId, messageId) {
  const room = await getRoom(roomId);
  if (!room) {
    sendJson(res, 404, { ok: false, error: 'Room not found', roomId });
    return;
  }
  const body = await readJsonBody(req);
  const requestedPeerId = normalizePeerId(body.peerId);
  const sessionToken = normalizeSessionToken(body.sessionToken);
  const sessionUser = await resolveOptionalSessionUser(req);

  // Load the message (must not be deleted)
  const msg = await getMessageService().room.getMessage(roomId, messageId);
  if (!msg) {
    sendJson(res, 404, { ok: false, error: 'Message not found' });
    return;
  }

  // Permission:
  // - guest peer session matches the message peerId, or
  // - logged in authorUserId matches current, or
  // - current user is owner of static room
  const isPeerAuthor = requestedPeerId && requestedPeerId === msg.peerId;
  const isAccountAuthor = sessionUser && msg.authorUserId && sessionUser.id === msg.authorUserId;
  const isRoomOwner = sessionUser && room.isStatic && room.ownerId === sessionUser.id;

  if (isPeerAuthor) {
    // verify guest token
    const activePeer = room.peers.get(requestedPeerId);
    if (!activePeer || !tokensMatch(activePeer.sessionToken, sessionToken)) {
      sendJson(res, 403, { ok: false, error: 'Invalid peer session' });
      return;
    }
  } else if (!isAccountAuthor && !isRoomOwner) {
    sendJson(res, 403, { ok: false, error: 'Not allowed to delete this message' });
    return;
  }
  // Only owners allowed on non-static? Per plan: only static have moderation.
  if (isRoomOwner && !room.isStatic) {
    sendJson(res, 403, { ok: false, error: 'Moderation only for static rooms' });
    return;
  }

  const deleted = await getMessageService().room.softDeleteMessage(roomId, messageId);
  if (!deleted) {
    sendJson(res, 404, { ok: false, error: 'Message not found' });
    return;
  }

  // Realtime delete notification to both voice peers and preview subscribers.
  // Use the room-detail WS envelope directly: legacy peer broadcast only accepts
  // legacy event names and treats unknown events as transport failures.
  const delEvent = buildServerEnvelope('room.chat.deleted', { roomId, messageId });
  roomRuntime?.broadcastRoomDetail?.(roomId, delEvent);
  await refreshPinsAfterMessageMutation(roomId, 'message-deleted', messageId);

  sendJson(res, 200, { ok: true, deleted: true });
}

async function handleEditRoomChatMessage(req, res, roomId, messageId) {
  const room = await getRoom(roomId);
  if (!room) {
    sendJson(res, 404, { ok: false, error: 'Room not found', roomId });
    return;
  }

  const clientIp = getClientIp(req, TRUST_PROXY);
  const body = await readJsonBody(req);
  const sessionUser = await resolveOptionalSessionUser(req);
  if (await findRoomBan(roomId, sessionUser?.id, clientIp)) {
    sendRoomBanned(res, roomId);
    return;
  }

  const text = cleanChatText(body.text);
  if (!text) {
    sendJson(res, 400, { ok: false, error: 'Invalid chat message' });
    return;
  }

  const requestedPeerId = normalizePeerId(body.peerId);
  const sessionToken = normalizeSessionToken(body.sessionToken);
  const current = await getMessageService().room.getMessage(roomId, messageId);
  if (!current) {
    sendJson(res, 404, { ok: false, error: 'Message not found' });
    return;
  }

  const isPeerAuthor = Boolean(requestedPeerId && requestedPeerId === current.peerId);
  const isAccountAuthor = Boolean(sessionUser && current.authorUserId && sessionUser.id === current.authorUserId);
  if (isAccountAuthor) {
    // The account id is durable ownership. It also lets a signed-in author edit
    // after their transient room peer session has disconnected or rotated.
  } else if (isPeerAuthor) {
    const activePeer = room.peers.get(requestedPeerId);
    if (!activePeer || !tokensMatch(activePeer.sessionToken, sessionToken)) {
      sendJson(res, 403, { ok: false, error: 'Invalid peer session' });
      return;
    }
    if (await findRoomBan(roomId, activePeer.accountUserId, activePeer.ip || clientIp)) {
      sendRoomBanned(res, roomId);
      return;
    }
  } else {
    // Deliberately no owner/moderator override: editing always belongs to the
    // original author, even in a static room.
    sendJson(res, 403, { ok: false, error: 'Not allowed to edit this message' });
    return;
  }

  const rate = roomChatLimiter.check(`${clientIp}:${roomId}`);
  if (!rate.allowed) {
    sendJson(
      res,
      429,
      { ok: false, error: 'Too many chat messages', retryAfterSeconds: rate.retryAfterSeconds },
      { 'Retry-After': String(rate.retryAfterSeconds) }
    );
    return;
  }

  const message = await getMessageService().room.editMessage(roomId, messageId, text);
  if (!message) {
    sendJson(res, 404, { ok: false, error: 'Message not found' });
    return;
  }

  const publicMessage = publicChatMessage(message);
  roomRuntime?.broadcastRoomDetail?.(
    roomId,
    buildServerEnvelope('room.chat.edited', { roomId, message: publicMessage })
  );
  await refreshPinsAfterMessageMutation(roomId, 'message-edited', messageId);
  sendJson(res, 200, { ok: true, message: publicMessage });
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

  const event = { type: 'dm.message.edited', message };
  broadcastToUser(peerId, event);
  broadcastToUser(user.id, event);
  sendJson(res, 200, { ok: true, message });
}

function pickReleaseAsset(assets, patterns) {
  for (const pattern of patterns) {
    const found = assets.find((asset) => pattern.test(asset.name || ''));
    if (found && found.browser_download_url) {
      return { url: found.browser_download_url, size: Number(found.size) || 0 };
    }
  }
  return null;
}

function normalizeRelease(release) {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  return {
    version: String(release.tag_name || '').replace(/^v/, ''),
    htmlUrl: typeof release.html_url === 'string' ? release.html_url : '',
    assets: {
      'mac-arm64': pickReleaseAsset(assets, [/-mac-arm64\.dmg$/i]),
      'mac-x64': pickReleaseAsset(assets, [/-mac-x64\.dmg$/i]),
      // Prefer the NSIS installer; fall back to the portable build.
      'win-x64': pickReleaseAsset(assets, [/-win-x64-setup\.exe$/i, /-win-x64\.exe$/i])
    }
  };
}

async function fetchLatestRelease() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'voice-room-web',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  const token = process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DESKTOP_RELEASE_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://api.github.com/repos/${DESKTOP_RELEASE_REPO}/releases/latest`,
      { headers, signal: controller.signal }
    );
    if (!response.ok) {
      throw new Error(`GitHub responded ${response.status}`);
    }
    return normalizeRelease(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

async function handleDesktopLatest(res) {
  const now = Date.now();
  if (desktopReleaseCache.data && now - desktopReleaseCache.at < DESKTOP_RELEASE_CACHE_MS) {
    sendJson(res, 200, { ok: true, ...desktopReleaseCache.data }, { 'Cache-Control': 'public, max-age=300' });
    return;
  }

  try {
    if (!desktopReleaseFetchPromise) {
      desktopReleaseFetchPromise = fetchLatestRelease().finally(() => {
        desktopReleaseFetchPromise = null;
      });
    }
    const data = await desktopReleaseFetchPromise;
    desktopReleaseCache = { at: now, data };
    sendJson(res, 200, { ok: true, ...data }, { 'Cache-Control': 'public, max-age=300' });
  } catch (error) {
    // Serve stale metadata if we have any; the binaries are still valid.
    if (desktopReleaseCache.data) {
      sendJson(res, 200, { ok: true, ...desktopReleaseCache.data }, { 'Cache-Control': 'public, max-age=60' });
      return;
    }
    console.error('Failed to fetch desktop release:', error.message);
    sendJson(res, 502, { ok: false, error: 'Не удалось получить данные о релизе' });
  }
}

function getApiRoutePath(pathname) {
  if (pathname === API_PREFIX) return '/';
  if (pathname.startsWith(`${API_PREFIX}/`)) return pathname.slice(API_PREFIX.length);
  return null;
}

function attachFastifyRequestBody(request) {
  request.raw.body = request.body;
  return request.raw;
}

function getRequestRouteLabel(request) {
  return request.routeOptions?.url || request.routerPath || request.url || 'unknown';
}

function logHttpRequest(request, statusCode, durationMs) {
  const route = getRequestRouteLabel(request);
  if (route === '/api/healthz') return;
  request.log?.info?.({
    method: request.method,
    route,
    statusCode,
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
    if (rejectCrossOriginCookieWrite(req, res)) return;
    await handler(req, res, request);
  } catch (error) {
    const status = error.statusCode || 500;
    const message = error.publicMessage || (status >= 500 ? 'Internal server error' : error.message);
    if (status >= 500) {
      request.log?.error?.({ err: error }, 'legacy handler failed') || console.error(error);
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
  realtimeClearTimeout = globalThis.clearTimeout
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
    disableRequestLogging: true,
    logger: createFastifyLoggerOptions(),
    trustProxy: TRUST_PROXY
  });

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
    }
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
    clearTimeout: realtimeClearTimeout
  });

  const wsHandler = createWsHandler({
    registry: wsRegistry,
    roomRuntime,
    resolveSessionUser,
    getFriendIds: (userId) => getFriendStore().getFriendIds(userId),
    isUserOnline,
    getClientIp: (req) => getClientIp(req, TRUST_PROXY)
  });

  app.setNotFoundHandler((request, reply) => {
    reply.headers(baseHeaders()).code(404).send({ ok: false, error: 'Not found' });
  });

  app.get('/api/healthz', (request, reply) => runLegacyHandler(request, reply, async (req, res) => {
    let readiness;
    try {
      readiness = activeReadinessProvider.getSnapshot();
    } catch {
      sendJson(res, 503, {
        ok: false,
        code: 'readiness_unavailable',
        error: 'Readiness snapshot unavailable'
      });
      return;
    }
    const livekit = getLiveKitConfig();
    sendJson(res, 200, {
      livekit: livekit.enabled,
      livekitUrl: livekit.url || null,
      ok: true,
      capabilityManifest: {
        contractVersion: readiness?.manifest?.contractVersion || null,
        schemaVersion: readiness?.manifest?.schemaVersion || null,
        digest: readiness?.manifest?.digest || null,
        path: readiness?.manifest?.path || null,
        replicaConsensus: readiness?.replica?.reason || (readiness?.replicaConsensus ? 'agree' : 'disagree'),
        manifestRawSha256: readiness?.manifest?.digest || null
      },
      maxRooms: MAX_ROOMS,
      rooms: await getRoomStore().countRooms(),
      peers: getPresencePeerCount()
    });
  }));

  app.get('/api/metrics', (request, reply) => {
    const readiness = (() => {
      try {
        return activeReadinessProvider.getSnapshot();
      } catch {
        return null;
      }
    })();
    const body = renderPrometheus({
      activeWs: wsRegistry?.connections?.size || 0,
      activeGuestWs: getActiveGuestWsCount(),
      presenceRooms: presenceRooms.size,
      presencePeers: getPresencePeerCount(),
      capabilityReadiness: readiness?.features || {}
    });
    reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(body);
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

  app.get('/api/pow-challenge', (request, reply) => runLegacyHandler(request, reply, handlePowChallenge));
  app.get('/api/desktop/latest', (request, reply) => runLegacyHandler(request, reply, (_req, res) => handleDesktopLatest(res)));
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
  app.get('/api/auth/rooms', (request, reply) => runLegacyHandler(request, reply, handleAuthRooms));
  app.post('/api/auth/rooms', (request, reply) => runLegacyHandler(request, reply, handleAddAuthRoom));
  app.delete('/api/auth/rooms/:roomId', (request, reply) => runLegacyHandler(
    request,
    reply,
    (req, res) => handleRemoveAuthRoom(req, res, request.params.roomId)
  ));
  app.post('/api/rooms', (request, reply) => runLegacyHandler(request, reply, handleCreateRoom));
  app.put('/api/rooms/:roomId', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleUpdateRoom(req, res, normalizeRoomId(request.params.roomId));
  }));
  app.delete('/api/rooms/:roomId', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleDeleteRoom(req, res, normalizeRoomId(request.params.roomId), request);
  }));
  app.post('/api/rooms/:roomId/avatar', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleUploadRoomAvatar(req, res, normalizeRoomId(request.params.roomId), request);
  }));
  app.delete('/api/rooms/:roomId/avatar', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleDeleteRoomAvatar(req, res, normalizeRoomId(request.params.roomId), request);
  }));
  app.post('/api/rooms/:roomId/kick', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleKickRoomPeer(req, res, normalizeRoomId(request.params.roomId));
  }));
  app.post('/api/rooms/:roomId/server-mute', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleServerMuteRoomPeer(req, res, normalizeRoomId(request.params.roomId));
  }));
  app.post('/api/rooms/:roomId/ban', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleBanRoomPeer(req, res, normalizeRoomId(request.params.roomId));
  }));
  app.delete('/api/rooms/:roomId/bans/:banId', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleUndoRoomBan(req, res, normalizeRoomId(request.params.roomId), request.params.banId);
  }));
  app.get('/api/avatars/:key', (request, reply) => runLegacyHandler(request, reply, (_req, res) => {
    return handleGetAvatar(res, request.params.key);
  }));
  app.get('/api/rooms/:roomId', (request, reply) => runLegacyHandler(request, reply, (_req, res) => {
    const roomId = normalizeRoomId(request.params.roomId);
    return handleRoomStatus(res, new URL(`/rooms/${roomId}`, 'http://localhost'));
  }));
  app.get('/api/rooms/:roomId/peers', (request, reply) => runLegacyHandler(request, reply, (_req, res) => {
    return handleRoomPeers(res, normalizeRoomId(request.params.roomId));
  }));
  app.get('/api/rooms/:roomId/chat', (request, reply) => runLegacyHandler(request, reply, (_req, res) => {
    return handleRoomChatList(res, normalizeRoomId(request.params.roomId));
  }));
  app.post('/api/rooms/:roomId/chat', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleRoomChatPost(req, res, normalizeRoomId(request.params.roomId));
  }));
  app.post('/api/rooms/:roomId/read', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleMarkRoomChatRead(req, res, request.params.roomId);
  }));
  app.patch('/api/rooms/:roomId/chat/:messageId', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleEditRoomChatMessage(req, res, normalizeRoomId(request.params.roomId), request.params.messageId);
  }));
  app.delete('/api/rooms/:roomId/chat/:messageId', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleDeleteRoomChatMessage(req, res, normalizeRoomId(request.params.roomId), request.params.messageId);
  }));
  app.post('/api/livekit-token', (request, reply) => runLegacyHandler(request, reply, handleLiveKitToken));
  app.post('/api/state', (request, reply) => runLegacyHandler(request, reply, handleState));

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

async function closeStores(logger = console) {
  await Promise.allSettled([
    roomStore?.close?.(),
    userStore?.close?.(),
    friendStore?.close?.(),
    notificationStore?.close?.(),
    pushStore?.close?.(),
    membershipPool?.end?.()
  ]).then((results) => {
    for (const result of results) {
      if (result.status === 'rejected') logger.error('Failed to close store:', result.reason);
    }
  });
  membershipPool = null;
  membershipServices = null;
}

function installGracefulShutdown(server, { logger = console, exit = process.exit, timeoutMs = 8000 } = {}) {
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info?.(`Received ${signal}; shutting down gracefully`);
    const timeout = setTimeout(() => {
      logger.error?.('Graceful shutdown timed out; exiting');
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
      logger.error?.('Graceful shutdown failed:', error);
      exit(1);
    }
  }

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

async function bootstrap({ env = process.env, logger = console, exit = process.exit } = {}) {
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
      maxMessagesPerRoom: ROOM_CHAT_MAX_MESSAGES,
      messageTtlMs: ROOM_CHAT_TTL_MS,
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
      logger.info?.(`Removed ${reconciliation.removed} orphaned avatar file(s)`);
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
    logger.error('Voice Room API failed to bootstrap:', error.message);
    if (exit === process.exit && typeof process !== 'undefined') {
      process.exitCode = 1;
    }
    exit(1);
    return null;
  }
}

if (require.main === module) {
  void bootstrap();
}

module.exports = {
  __private: {
    pruneRooms,
    revokeIssuedAdmission,
    resolveServerMutePermission,
    resolveCursorHmacKeys,
    resolveRealtimeReconnectLeaseMs
  },
  bootstrap,
  closeStores,
  createApiApp,
  createApiServer
};
