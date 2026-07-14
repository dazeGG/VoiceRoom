'use strict';

const crypto = require('node:crypto');
const fastify = require('fastify');
const fastifyCookie = require('@fastify/cookie');
const fastifyMultipart = require('@fastify/multipart');
const fastifyWebsocket = require('@fastify/websocket');
const { createConnectionRegistry } = require('./realtime/registry');
const { createWsHandler } = require('./realtime/ws-handler');
const { createRoomRealtimeRuntime } = require('./realtime/room-runtime');
const { buildServerEnvelope } = require('./realtime/envelope');
const { URL } = require('node:url');
const { AccessToken, RoomServiceClient, TrackSource } = require('livekit-server-sdk');

const { readEnvInt, readEnvBool, readDatabaseConfig, readUploadsDir } = require('./lib/config');
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
const { createUserStore, publicUser } = require('./lib/user-store');
const { createFriendStore } = require('./lib/friend-store');
const { createNotificationStore } = require('./lib/notification-store');
const { createPushStore } = require('./lib/push-store');
const { createPushService, resolvePushTtl, shouldDeliverPush } = require('./lib/push-service');
const { cleanPushEndpoint } = require('./lib/push-endpoint');
const { startApiListener } = require('./lib/listen');
const { runMigrations } = require('./lib/migrate');
const {
  observeMaintenance,
  recordHttpRequest,
  renderPrometheus
} = require('./lib/metrics');

const API_PREFIX = '/api';
const HOST = (process.env.HOST || '127.0.0.1').trim();
const PORT = readEnvInt('PORT', 3000, 1);
const SOCKET_PATH = (process.env.SOCKET_PATH || '').trim();
const MAX_ROOM_PEERS = readEnvInt('MAX_ROOM_PEERS', 12, 1);
const MAX_ROOMS = readEnvInt('MAX_ROOMS', 100, 1);
const KEEPALIVE_MS = readEnvInt('SSE_KEEPALIVE_MS', 15000, 1000);
const BODY_LIMIT_BYTES = readEnvInt('BODY_LIMIT_BYTES', 65536, 1024);
const TRUST_PROXY = readEnvBool('TRUST_PROXY', false);
const LIVEKIT_TOKEN_TTL_SECONDS = readEnvInt('LIVEKIT_TOKEN_TTL_SECONDS', 21600, 60);
const ROOM_IDLE_TTL_MS = readEnvInt('ROOM_IDLE_TTL_MS', 900000, 1000);
const ROOM_PRUNE_INTERVAL_MS = readEnvInt('ROOM_PRUNE_INTERVAL_MS', 60000, 0);
const ROOM_CHAT_TTL_MS = readEnvInt('ROOM_CHAT_TTL_MS', 7 * 24 * 60 * 60 * 1000, 1000);
const ROOM_CHAT_MAX_MESSAGES = readEnvInt('ROOM_CHAT_MAX_MESSAGES', 500, 1);
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
const AUTH_RATE_LIMIT = readEnvInt('AUTH_RATE_LIMIT', 30, 0);
const AUTH_RATE_WINDOW_MS = readEnvInt('AUTH_RATE_WINDOW_MS', 60000, 1000);
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
// Desktop app downloads are served from the latest GitHub release of this repo.
// Metadata is cached server-side so visitors never hit GitHub's per-IP rate limit.
const DESKTOP_RELEASE_REPO = (process.env.DESKTOP_RELEASE_REPO || 'dazeGG/VoiceRoomDesktop').trim();
const DESKTOP_RELEASE_CACHE_MS = readEnvInt('DESKTOP_RELEASE_CACHE_MS', 600000, 1000);
const DESKTOP_RELEASE_TIMEOUT_MS = readEnvInt('DESKTOP_RELEASE_TIMEOUT_MS', 6000, 1000);

let roomStore = null;
let userStore = null;
let friendStore = null;
let notificationStore = null;
let pushStore = null;
let pushService = null;
let avatarStorage = null;

const presenceRooms = new Map();
let wsRegistry = null;
let roomRuntime = null;
const roomOccupancyQueue = new Map();

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

function getFriendStore() {
  if (!friendStore) {
    friendStore = createFriendStore({});
  }
  return friendStore;
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
    if (!shouldDeliverPush(preferences, context)) return;
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
  const url = cleanLiveKitUrl(process.env.LIVEKIT_URL || '');
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
  return getUserStore().getSessionUser(token);
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
  const url = cleanLiveKitUrl(process.env.LIVEKIT_URL || '');
  const apiKey = process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_KEY.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET && process.env.LIVEKIT_API_SECRET.trim();
  return {
    apiKey,
    apiSecret,
    enabled: Boolean(url && apiKey && apiSecret),
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
  if (!roomId || typeof getRoomStore().findActiveRoomBan !== 'function') return null;
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
      if (roomOccupancyQueue.get(roomId) === transition) roomOccupancyQueue.delete(roomId);
    },
    () => {
      if (roomOccupancyQueue.get(roomId) === transition) roomOccupancyQueue.delete(roomId);
    }
  );
  return transition;
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

function closePeer(roomId, peerId, transportId, reason = 'left') {
  const room = presenceRooms.get(roomId);
  if (!room) return;

  const current = room.peers.get(peerId);
  if (!current || !transportId || current.transport?.id !== transportId) return;

  current.closed = true;
  room.peers.delete(peerId);
  if (!current.replaced) {
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
    text: message.text
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

async function handleLiveKitToken(req, res) {
  const livekit = getLiveKitConfig();
  if (!livekit.enabled) {
    sendJson(res, 503, {
      ok: false,
      error: 'LiveKit не настроен: проверьте LIVEKIT_URL, LIVEKIT_API_KEY и LIVEKIT_API_SECRET'
    });
    return;
  }

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

  const livekitRoom = getLiveKitRoomName(roomId);
  const token = new AccessToken(livekit.apiKey, livekit.apiSecret, {
    identity: peerId,
    metadata: JSON.stringify({ roomId }),
    name,
    ttl: LIVEKIT_TOKEN_TTL_SECONDS
  });
  token.addGrant({
    canPublish: true,
    canPublishData: true,
    canPublishSources: [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
    canSubscribe: true,
    room: livekitRoom,
    roomJoin: true
  });

  sendJson(res, 200, {
    ok: true,
    room: livekitRoom,
    token: await token.toJwt(),
    ttlSeconds: LIVEKIT_TOKEN_TTL_SECONDS,
    url: livekit.url
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
  await removeAvatarBestEffort(deleted.avatarKey, request);

  // Broadcast after durable soft-delete, before presence teardown so the WS
  // writes are not racing socket close.
  const presence = presenceRooms.get(roomId);
  if (presence) broadcast(presence, { type: 'room-deleted', roomId });
  roomRuntime?.mirrorLegacyRoomEvent(roomId, { type: 'room-deleted', roomId });
  roomRuntime?.invalidateRecipientCache(roomId);

  // Belt-and-suspenders: force-close active peers after the signal. Clients
  // also self-exit on room-deleted, so this only matters for missed events.
  if (presence) {
    for (const peer of Array.from(presence.peers.values())) {
      closePeer(roomId, peer.id, peer.transport?.id, 'deleted');
    }
  }

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

  const session = await getUserStore().createSession({ userId: created.user.id });
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

  const session = await getUserStore().createSession({ userId: user.id });
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
  }
  sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
}

async function handleMe(req, res) {
  const session = await resolveSessionUser(req);
  sendJson(res, 200, { ok: true, user: session ? publicUser(session.user) : null });
}

async function handleUpdateProfile(req, res) {
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

function refreshActiveUserAvatar(user) {
  if (!user?.id) return;
  const avatarUrl = user.avatarKey ? `/api/avatars/${encodeURIComponent(user.avatarKey)}` : null;
  for (const [roomId, room] of presenceRooms) {
    for (const peer of room.peers.values()) {
      if (peer.accountUserId !== user.id) continue;
      peer.avatarAccent = user.avatarAccent || null;
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
  refreshActiveUserAvatar(result.user);
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
  refreshActiveUserAvatar(result.user);
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

  sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
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

async function handleMarkRoomChatRead(req, res, rawRoomId) {
  const user = await requireSessionUser(req, res);
  if (!user) return;
  const roomId = normalizeRoomId(rawRoomId);
  if (!roomId) {
    sendJson(res, 404, { ok: false, error: 'Комната не найдена' });
    return;
  }

  const lastReadAt = await getRoomStore().markRoomChatRead(roomId, user.id);
  if (lastReadAt == null) {
    sendJson(res, 404, { ok: false, error: 'Комната не найдена' });
    return;
  }
  await roomRuntime?.sendRoomSummaryToUser(roomId, user.id);
  sendJson(res, 200, { ok: true, lastReadAt, unreadCount: 0 });
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

  const { peer, room } = authorized;

  if (await findRoomBan(roomId, peer.accountUserId, peer.ip)) {
    sendRoomBanned(res, roomId);
    return;
  }

  if (Object.hasOwn(body, 'name')) {
    peer.name = cleanName(body.name);
  }
  if (Object.hasOwn(body, 'muted')) {
    peer.muted = Boolean(body.muted);
  }
  if (Object.hasOwn(body, 'deafened')) {
    peer.deafened = Boolean(body.deafened);
  }
  if (Object.hasOwn(body, 'screen')) {
    peer.screen = Boolean(body.screen);
  }
  if (Object.hasOwn(body, 'screenAudio')) {
    peer.screenAudio = Boolean(body.screenAudio);
  }
  if (Object.hasOwn(body, 'screenProfileId')) {
    peer.screenProfileId = cleanScreenProfileId(body.screenProfileId);
  }
  if (Object.hasOwn(body, 'screenStreamId')) {
    peer.screenStreamId = cleanStreamId(body.screenStreamId);
  }
  if (Object.hasOwn(body, 'viewedScreenPeerId')) {
    peer.viewedScreenPeerId = normalizePeerId(body.viewedScreenPeerId) || '';
  }

  broadcast(room, { type: 'peer-updated', peer: publicPeer(peer) });
  roomRuntime?.mirrorLegacyRoomEvent(roomId, { type: 'peer-updated', peer: publicPeer(peer) });
  roomRuntime?.scheduleSummaryBroadcast(roomId);
  sendJson(res, 200, { ok: true, peer: publicPeer(peer) });
}

async function handleRoomChatList(res, roomId) {
  const room = await getRoom(roomId);
  if (!room) {
    sendJson(res, 404, { ok: false, error: 'Room not found', roomId });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    messages: (await getRoomStore().listMessages(roomId, { limit: 100 })).map(publicChatMessage),
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
  const name = sessionDisplayName(sessionUser) || cleanName(body.name);
  const text = cleanChatText(body.text);

  if (!room) {
    sendJson(res, 404, { ok: false, error: 'Room not found', roomId });
    return;
  }

  if (await findRoomBan(roomId, sessionUser?.id, clientIp)) {
    sendRoomBanned(res, roomId);
    return;
  }

  if (!text) {
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

  const now = Date.now();
  const message = await getRoomStore().appendMessage(roomId, {
    createdAt: now,
    expiresAt: now + ROOM_CHAT_TTL_MS,
    id: crypto.randomUUID?.() || crypto.randomBytes(16).toString('hex'),
    avatarColorKey,
    name,
    peerId,
    text,
    authorUserId: sessionUser ? sessionUser.id : (activePeer?.accountUserId || null)
  });

  if (!message) {
    sendJson(res, 400, { ok: false, error: 'Invalid chat message' });
    return;
  }

  const publicMessage = {
    ...message,
    avatarAccent: sessionUser?.avatarAccent || activePeer?.avatarAccent || null,
    avatarColorKey,
    avatarUrl: sessionUser?.avatarKey
      ? `/api/avatars/${encodeURIComponent(sessionUser.avatarKey)}`
      : activePeer?.avatarUrl || null
  };
  roomRuntime?.broadcastChatMessage(roomId, publicMessage);
  sendJson(res, 201, { ok: true, message: publicChatMessage(publicMessage) });
}

async function removeLiveKitParticipant(roomId, peerId) {
  const livekit = getLiveKitConfig();
  if (!livekit.enabled) return;
  const service = new RoomServiceClient(getLiveKitHttpUrl(livekit.url), livekit.apiKey, livekit.apiSecret);
  try {
    await service.removeParticipant(getLiveKitRoomName(roomId), peerId);
  } catch (error) {
    if (!/not.?found/i.test(String(error?.message || ''))) {
      console.error('Failed to remove moderated LiveKit participant:', error);
    }
  }
}

async function disconnectModeratedPeer(room, peer, type) {
  const event = { type, roomId: room.id, peerId: peer.id };
  sendEvent(peer, event);
  if (peer.accountUserId) broadcastToUser(peer.accountUserId, event);
  for (const connection of wsRegistry?.connections.values() || []) {
    if (connection.activeVoice?.roomId !== room.id || connection.activeVoice?.peerId !== peer.id) continue;
    connection.activeVoice = null;
    connection.previewRoomIds.delete(room.id);
    wsRegistry.unregisterConnectionForRoom(connection, room.id);
  }
  closePeer(room.id, peer.id, peer.transport?.id, type === 'room.banned' ? 'banned' : 'kicked');
  if (typeof getRoomStore().invalidatePeerIdentity === 'function') {
    await getRoomStore().invalidatePeerIdentity({ roomId: room.id, peerId: peer.id });
  }
  await removeLiveKitParticipant(room.id, peer.id);
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
  const result = await getRoomStore().createRoomBan({
    roomId,
    userId: bannedUserId,
    ip: bannedIp,
    maxBans: MAX_ROOM_BANS
  });
  if (result.status === 'cap_exceeded') {
    sendJson(res, 409, { ok: false, code: 'room_ban_limit', error: 'Достигнут лимит блокировок комнаты' });
    return;
  }
  if (!result.ban) {
    sendJson(res, 409, { ok: false, error: 'Не удалось сохранить блокировку' });
    return;
  }
  const matchingPeers = [...room.peers.values()].filter((candidate) => bannedUserId
    ? candidate.accountUserId === bannedUserId
    : Boolean(bannedIp && candidate.ip === bannedIp)
  );
  for (const candidate of matchingPeers) {
    await disconnectModeratedPeer(room, candidate, 'room.banned');
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

  const messages = await getFriendStore().listThread({ userId: user.id, peerId: id });
  // Opening the thread clears the unread badge and lets the peer see the read.
  const read = await getFriendStore().markRead({ userId: user.id, peerId: id });
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

  const body = await readJsonBody(req);
  const text = cleanDmText(body.text);
  if (!text) {
    sendJson(res, 400, { ok: false, error: 'Пустое сообщение' });
    return;
  }

  const message = await getFriendStore().sendMessage({ senderId: user.id, recipientId: id, body: text });
  // Deliver to the recipient and the sender's other tabs; clients dedupe by id.
  broadcastToUser(id, { type: 'dm-message', message });
  await broadcastDmNotification(id, user, message);
  broadcastToUser(user.id, { type: 'dm-message', message });
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

  const current = await getFriendStore().getMessage(user.id, peerId, messageId);
  if (!current || !current.invite) {
    sendJson(res, 404, { ok: false, error: 'Приглашение не найдено' });
    return;
  }
  if (current.recipientId !== user.id) {
    sendJson(res, 403, { ok: false, error: 'Отвечать может только приглашённый' });
    return;
  }

  const message = await getFriendStore().respondInvite({ messageId, recipientId: user.id, status: action });
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

  const result = await getFriendStore().markRead({ userId: user.id, peerId: id });
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

  const presence = presenceRooms.get(roomId);
  const senderIsActive = Boolean(presence && Array.from(presence.peers.values()).some((peer) => peer.accountUserId === user.id));
  if (!senderIsActive) {
    sendJson(res, 403, { ok: false, error: 'Join the room before inviting friends' });
    return;
  }
  if (!(await getFriendStore().areFriends(user.id, targetUserId))) {
    sendJson(res, 403, { ok: false, error: 'You are not friends' });
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
  const expiresAt = Date.now() + RING_TTL_MS;
  const fromUser = notificationActor(user);
  const ringRoom = { id: room.id, name: room.name || '', emoji: room.emoji || '' };
  broadcastToUser(targetUserId, { type: 'ring.incoming', fromUser, room: ringRoom, expiresAt });
  // Persist the invitation as a regular DM so both sides share one timeline
  // entry (with live status) instead of per-device local copies.
  const inviteMessage = await getFriendStore().sendMessage({
    senderId: user.id,
    recipientId: targetUserId,
    body: room.name ? `Приглашение в комнату «${room.name}»` : 'Приглашение в комнату',
    metadata: { kind: 'room-invite', roomId: room.id, roomName: room.name || '', status: 'pending', expiresAt }
  });
  broadcastToUser(targetUserId, { type: 'dm-message', message: inviteMessage });
  broadcastToUser(user.id, { type: 'dm-message', message: inviteMessage });
  void queuePush(targetUserId, {
    type: 'ring',
    title: `${user.displayName || user.login || 'Друг'} зовёт вас`,
    body: room.name ? `Комната «${room.name}»` : 'Присоединиться к комнате',
    privateBody: 'Вас зовут в голосовую комнату.',
    tag: `ring:${user.id}:${roomId}`,
    dedupeKey: `ring:${user.id}:${roomId}:${expiresAt}`,
    url: `/r/${encodeURIComponent(roomId)}`,
    expiresAt
  }, { expiresAt });
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
  const msg = await getRoomStore().getMessage(roomId, messageId);
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

  const deleted = await getRoomStore().softDeleteMessage(roomId, messageId);
  if (!deleted) {
    sendJson(res, 404, { ok: false, error: 'Message not found' });
    return;
  }

  // Realtime delete notification to both voice peers and preview subscribers.
  // Use the room-detail WS envelope directly: legacy peer broadcast only accepts
  // legacy event names and treats unknown events as transport failures.
  const delEvent = buildServerEnvelope('room.chat.deleted', { roomId, messageId });
  roomRuntime?.broadcastRoomDetail?.(roomId, delEvent);

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
  const current = await getRoomStore().getMessage(roomId, messageId);
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

  const message = await getRoomStore().editMessage(roomId, messageId, text);
  if (!message) {
    sendJson(res, 404, { ok: false, error: 'Message not found' });
    return;
  }

  const publicMessage = publicChatMessage(message);
  roomRuntime?.broadcastRoomDetail?.(
    roomId,
    buildServerEnvelope('room.chat.edited', { roomId, message: publicMessage })
  );
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

  const msg = await getFriendStore().getMessage(user.id, peerId, messageId);
  if (!msg) {
    sendJson(res, 404, { ok: false, error: 'Сообщение не найдено' });
    return;
  }

  // Only sender can delete own message (deletes for both)
  if (msg.senderId !== user.id) {
    sendJson(res, 403, { ok: false, error: 'Можно удалять только свои сообщения' });
    return;
  }

  const deleted = await getFriendStore().softDeleteMessage(messageId);
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

  const current = await getFriendStore().getMessage(user.id, peerId, messageId);
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

  const message = await getFriendStore().editMessage({
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

function createApiApp({ store = null, users = null, friends = null, notifications = null, pushes = null, push = null, avatars = null } = {}) {
  if (store) roomStore = store;
  if (users) userStore = users;
  if (friends) friendStore = friends;
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
    limits: { fileSize: MAX_AVATAR_BYTES, files: 1, parts: 2 }
  });
  app.register(fastifyWebsocket, { options: { maxPayload: WS_MAX_PAYLOAD_BYTES } });

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
    findRoomBan
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
    const livekit = getLiveKitConfig();
    sendJson(res, 200, {
      livekit: livekit.enabled,
      livekitUrl: livekit.url || null,
      ok: true,
      maxRooms: MAX_ROOMS,
      rooms: await getRoomStore().countRooms(),
      peers: getPresencePeerCount()
    });
  }));

  app.get('/api/metrics', (request, reply) => {
    const body = renderPrometheus({
      activeWs: wsRegistry?.connections?.size || 0,
      activeGuestWs: getActiveGuestWsCount(),
      presenceRooms: presenceRooms.size,
      presencePeers: getPresencePeerCount()
    });
    reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(body);
  });

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
  app.get('/api/auth/rooms', (request, reply) => runLegacyHandler(request, reply, handleAuthRooms));
  app.post('/api/auth/rooms', (request, reply) => runLegacyHandler(request, reply, handleAddAuthRoom));
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
  return server;
}

async function closeStores(logger = console) {
  await Promise.allSettled([
    roomStore?.close?.(),
    userStore?.close?.(),
    friendStore?.close?.(),
    notificationStore?.close?.(),
    pushStore?.close?.()
  ]).then((results) => {
    for (const result of results) {
      if (result.status === 'rejected') logger.error('Failed to close store:', result.reason);
    }
  });
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
    await runMigrations({ databaseUrl: database.url, logger });
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
      avatars: avatarStorage
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
  bootstrap,
  closeStores,
  createApiApp,
  createApiServer
};
