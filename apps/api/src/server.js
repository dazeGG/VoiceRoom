'use strict';

const crypto = require('node:crypto');
const fastify = require('fastify');
const fastifyCookie = require('@fastify/cookie');
const fastifyWebsocket = require('@fastify/websocket');
const { createConnectionRegistry } = require('./realtime/registry');
const { createWsHandler } = require('./realtime/ws-handler');
const { createRoomRealtimeRuntime } = require('./realtime/room-runtime');
const { URL } = require('node:url');
const { AccessToken, TrackSource } = require('livekit-server-sdk');

const { readEnvInt, readEnvBool, readDatabaseConfig } = require('./lib/config');
const {
  normalizeRoomId,
  normalizePeerId,
  normalizeSessionToken,
  cleanName,
  cleanDisplayName,
  cleanRoomName,
  cleanRoomColorKey,
  cleanRoomEmoji,
  cleanRoomIconKey,
  cleanRoomPresetKey,
  getRoomPreset,
  cleanStreamId,
  cleanScreenProfileId,
  cleanLiveKitUrl,
  isValidPassword,
  normalizeLogin
} = require('@voice-room/shared/validation');
const { createProofOfWork } = require('./lib/pow');
const { getClientIp, createRateLimiter } = require('./lib/rate-limit');
const { avatarColorForPeerId, createRoomStore } = require('./lib/room-store');
const { createUserStore, publicUser } = require('./lib/user-store');
const { createFriendStore } = require('./lib/friend-store');
const { startApiListener } = require('./lib/listen');
const { runMigrations } = require('./lib/migrate');

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
// Cap concurrent realtime (WebSocket) connections per user so a single account
// cannot pin an unbounded number of keep-alive connections.
const MAX_REALTIME_STREAMS_PER_USER = readEnvInt('MAX_REALTIME_STREAMS_PER_USER', 8, 1);
// Desktop app downloads are served from the latest GitHub release of this repo.
// Metadata is cached server-side so visitors never hit GitHub's per-IP rate limit.
const DESKTOP_RELEASE_REPO = (process.env.DESKTOP_RELEASE_REPO || 'dazeGG/VoiceRoomDesktop').trim();
const DESKTOP_RELEASE_CACHE_MS = readEnvInt('DESKTOP_RELEASE_CACHE_MS', 600000, 1000);
const DESKTOP_RELEASE_TIMEOUT_MS = readEnvInt('DESKTOP_RELEASE_TIMEOUT_MS', 6000, 1000);

let roomStore = null;
let userStore = null;
let friendStore = null;

const presenceRooms = new Map();
let wsRegistry = null;
let roomRuntime = null;

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

function isUserOnline(userId) {
  return Boolean(wsRegistry && wsRegistry.connectionCount(userId) > 0);
}

function broadcastToUser(userId, message) {
  if (!wsRegistry) return 0;
  return wsRegistry.broadcastAccountEvent(userId, message);
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
const pow = createProofOfWork({
  secret: crypto.randomBytes(32),
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
      "img-src 'self' data:",
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
  if (ROOM_PRUNE_INTERVAL_MS <= 0) return null;

  const timer = setInterval(() => {
    void pruneRooms().catch((error) => {
      logger.error('Room prune timer failed:', error);
    });
    void getUserStore()
      .pruneSessions()
      .catch((error) => {
        logger.error('Session prune timer failed:', error);
      });
  }, ROOM_PRUNE_INTERVAL_MS);

  if (typeof timer.unref === 'function') timer.unref();
  server.once('close', () => clearInterval(timer));
  return timer;
}

async function countRoomCreationQuotaRoomsForIp(clientIp) {
  return getRoomStore().countQuotaRoomsForIp(clientIp);
}

async function createRoomForRequest(creatorIp, { isStatic = false, ownerId = null, name = '', emoji = '', roomColorKey = '', roomIconKey = '', roomPresetKey = '' } = {}) {
  await pruneRooms();

  let roomId = createRoomId();
  while (await getRoomStore().getRoom(roomId)) {
    roomId = createRoomId();
  }

  return getRoomStore().createRoomWithQuota({
    creatorIp,
    isStatic,
    ownerId,
    name,
    emoji,
    roomColorKey,
    roomIconKey,
    roomPresetKey,
    maxOwnedStaticRoomsPerUser: MAX_STATIC_ROOMS_PER_USER,
    maxRooms: MAX_ROOMS,
    maxTempRoomsPerIp: MAX_TEMP_ROOMS_PER_IP,
    roomId
  });
}

async function getRoom(roomId) {
  await pruneRooms();
  const room = await getRoomStore().getRoom(roomId);
  if (!room) return null;
  room.updatedAt = Date.now();
  return attachPresence(room);
}

function publicPeer(peer) {
  return {
    accountUserId: peer.accountUserId || '',
    avatarColorKey: peer.avatarColorKey || avatarColorForPeerId(peer.id),
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
    void getRoomStore().markRoomEmpty(roomId).catch((error) => {
      console.error('Failed to mark room empty:', error);
    });
  } else {
    room.updatedAt = Date.now();
  }
}

function parseBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function cleanChatText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function publicChatMessage(message) {
  return {
    avatarColorKey: message.avatarColorKey || avatarColorForPeerId(message.peerId),
    createdAt: message.createdAt,
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
  const requestedPresetKey = cleanRoomPresetKey(body.roomPresetKey || body.presetKey || body.roomPreset);
  const requestedPreset = getRoomPreset(requestedPresetKey);
  const emoji = requestedPreset?.emoji || cleanRoomEmoji(body.emoji);
  const roomIconKey = requestedPreset?.iconKey || cleanRoomIconKey(body.roomIconKey);
  const roomColorKey = requestedPreset?.colorKey || cleanRoomColorKey(body.roomColorKey);
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
    name,
    emoji,
    roomColorKey,
    roomIconKey,
    roomPresetKey: requestedPresetKey
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
    createdAt: room.createdAt,
    emoji: room.emoji,
    roomColorKey: room.roomColorKey,
    roomIconKey: room.roomIconKey,
    roomPresetKey: room.roomPresetKey,
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

  // Reject unknown icon/color/preset keys before touching the DB. The clean*
  // helpers normalize a known key to itself and an unknown one to '', so a
  // non-empty input that cleans to '' means the caller sent something the
  // CHECK constraints would reject — return a clean 400 instead of an SQL error.
  if (typeof body.roomPresetKey === 'string' && body.roomPresetKey && !cleanRoomPresetKey(body.roomPresetKey)) {
    sendJson(res, 400, { ok: false, error: 'Неизвестный пресет комнаты' });
    return;
  }
  if (typeof body.roomIconKey === 'string' && body.roomIconKey && !cleanRoomIconKey(body.roomIconKey)) {
    sendJson(res, 400, { ok: false, error: 'Неизвестная иконка комнаты' });
    return;
  }
  if (typeof body.roomColorKey === 'string' && body.roomColorKey && !cleanRoomColorKey(body.roomColorKey)) {
    sendJson(res, 400, { ok: false, error: 'Неизвестный цвет комнаты' });
    return;
  }
  if (typeof body.emoji === 'string' && body.emoji && !cleanRoomEmoji(body.emoji)) {
    sendJson(res, 400, { ok: false, error: 'Неизвестный эмодзи комнаты' });
    return;
  }

  // Merge with the authorized room so omitted fields keep their current values.
  // A newly provided preset drives icon/color/emoji so the curated combination
  // stays consistent. Without a new preset, explicit visual fields are partial
  // updates over the stored room instead of being overwritten by the old preset.
  const nextName = body.name !== undefined ? cleanRoomName(body.name) : room.name;
  if (!nextName) {
    sendJson(res, 400, { ok: false, error: 'Дайте комнате название' });
    return;
  }
  const requestedPreset = body.roomPresetKey !== undefined ? getRoomPreset(body.roomPresetKey) : null;
  const updated = await getRoomStore().updateRoom(roomId, {
    name: nextName,
    emoji: requestedPreset?.emoji || (body.emoji !== undefined ? cleanRoomEmoji(body.emoji) : room.emoji),
    roomIconKey: requestedPreset?.iconKey || (body.roomIconKey !== undefined ? cleanRoomIconKey(body.roomIconKey) : room.roomIconKey),
    roomColorKey: requestedPreset?.colorKey || (body.roomColorKey !== undefined ? cleanRoomColorKey(body.roomColorKey) : room.roomColorKey),
    roomPresetKey: body.roomPresetKey !== undefined ? cleanRoomPresetKey(body.roomPresetKey) : cleanRoomPresetKey(room.roomPresetKey)
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

async function handleDeleteRoom(req, res, roomId) {
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
  return {
    createdAt: room.createdAt,
    emoji: room.emoji,
    roomColorKey: room.roomColorKey,
    roomIconKey: room.roomIconKey,
    roomPresetKey: room.roomPresetKey,
    emptySince: room.emptySince,
    isStatic: room.isStatic,
    name: room.name,
    peers: presenceRooms.get(room.id)?.peers.size ?? 0,
    relationship: room.relationship || 'owner',
    roomId: room.id
  };
}

async function handleAuthRooms(req, res) {
  const session = await resolveSessionUser(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Требуется вход' });
    return;
  }

  await pruneRooms();
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

  await pruneRooms();
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
    createdAt: room.createdAt,
    emoji: room.emoji,
    roomColorKey: room.roomColorKey,
    roomIconKey: room.roomIconKey,
    roomPresetKey: room.roomPresetKey,
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
  const authorized = getAuthorizedPeer(roomId, peerId, sessionToken);

  if (!authorized) {
    sendJson(res, 403, { ok: false, error: 'Invalid peer session' });
    return;
  }

  const { peer, room } = authorized;

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
  await pruneRooms();
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
  await pruneRooms();
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
  let peerId = requestedPeerId || authenticatedPeerId || `chat-${crypto.randomBytes(12).toString('hex')}`;
  let avatarColorKey = sessionAvatarColorKey(sessionUser) || avatarColorForPeerId(peerId);
  const activePeer = requestedPeerId ? room.peers.get(requestedPeerId) : null;
  if (activePeer) {
    if (!tokensMatch(activePeer.sessionToken, sessionToken)) {
      sendJson(res, 403, { ok: false, error: 'Invalid peer session' });
      return;
    }
    peerId = activePeer.id;
    if (sessionAvatarColorKey(sessionUser)) activePeer.avatarColorKey = sessionAvatarColorKey(sessionUser);
    avatarColorKey = activePeer.avatarColorKey || avatarColorForPeerId(peerId);
  } else if (requestedPeerId && sessionToken) {
    const identityResult = await getRoomStore().getOrCreatePeerIdentity({ roomId, peerId: requestedPeerId, sessionToken, displayName: name, avatarColorKey: sessionAvatarColorKey(sessionUser) });
    if (identityResult.status === 'token_mismatch') {
      sendJson(res, 403, { ok: false, error: 'Invalid peer session' });
      return;
    }
    avatarColorKey = identityResult.identity?.avatarColorKey || avatarColorKey;
  }

  const now = Date.now();
  const message = await getRoomStore().appendMessage(roomId, {
    createdAt: now,
    expiresAt: now + ROOM_CHAT_TTL_MS,
    id: crypto.randomUUID?.() || crypto.randomBytes(16).toString('hex'),
    avatarColorKey,
    name,
    peerId,
    text
  });

  if (!message) {
    sendJson(res, 400, { ok: false, error: 'Invalid chat message' });
    return;
  }

  const publicMessage = { ...message, avatarColorKey };
  roomRuntime?.broadcastChatMessage(roomId, publicMessage);
  sendJson(res, 201, { ok: true, message: publicChatMessage(publicMessage) });
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
      sendJson(res, 200, { ok: true, status: 'accepted', user: result.user });
      return;
    default:
      broadcastToUser(result.user.id, { type: 'friend-request' });
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

  sendJson(res, 200, { ok: true, peer: publicUser(peer), messages });
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
  broadcastToUser(user.id, { type: 'dm-message', message });
  sendJson(res, 201, { ok: true, message });
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
    const data = await fetchLatestRelease();
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

async function runLegacyHandler(request, reply, handler) {
  reply.hijack();
  const req = attachFastifyRequestBody(request);
  const res = reply.raw;

  try {
    if (rejectCrossOriginCookieWrite(req, res)) return;
    await handler(req, res, request);
  } catch (error) {
    const status = error.statusCode || 500;
    const message = error.publicMessage || (status >= 500 ? 'Internal server error' : error.message);
    if (status >= 500) {
      console.error(error);
    }
    if (!res.headersSent) {
      sendJson(res, status, { ok: false, error: message });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}

function createApiApp({ store = null, users = null, friends = null } = {}) {
  if (store) roomStore = store;
  if (users) userStore = users;
  if (friends) friendStore = friends;

  const app = fastify({
    bodyLimit: BODY_LIMIT_BYTES,
    logger: false,
    trustProxy: TRUST_PROXY
  });

  app.register(fastifyCookie, { hook: 'onRequest' });
  app.register(fastifyWebsocket);

  wsRegistry = createConnectionRegistry({
    maxConnectionsPerUser: MAX_REALTIME_STREAMS_PER_USER,
    keepaliveMs: KEEPALIVE_MS,
    isUserOnline,
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
    broadcast,
    closePeer,
    avatarColorForPeerId,
    MAX_ROOM_PEERS,
    tokensMatch,
    sessionAvatarColorKey
  });

  const wsHandler = createWsHandler({
    registry: wsRegistry,
    roomRuntime,
    resolveSessionUser,
    getFriendIds: (userId) => getFriendStore().getFriendIds(userId),
    isUserOnline
  });

  app.setNotFoundHandler((request, reply) => {
    reply.headers(baseHeaders()).code(404).send({ ok: false, error: 'Not found' });
  });

  app.get('/api/healthz', (request, reply) => runLegacyHandler(request, reply, async (req, res) => {
    await pruneRooms();
    const livekit = getLiveKitConfig();
    sendJson(res, 200, {
      livekit: livekit.enabled,
      livekitUrl: livekit.url || null,
      ok: true,
      maxRooms: MAX_ROOMS,
      rooms: await getRoomStore().countRooms(),
      peers: Array.from(presenceRooms.values()).reduce((count, room) => count + room.peers.size, 0)
    });
  }));

  app.get('/api/pow-challenge', (request, reply) => runLegacyHandler(request, reply, handlePowChallenge));
  app.get('/api/desktop/latest', (request, reply) => runLegacyHandler(request, reply, (_req, res) => handleDesktopLatest(res)));
  app.post('/api/auth/register', (request, reply) => runLegacyHandler(request, reply, handleRegister));
  app.post('/api/auth/login', (request, reply) => runLegacyHandler(request, reply, handleLogin));
  app.post('/api/auth/logout', (request, reply) => runLegacyHandler(request, reply, handleLogout));
  app.get('/api/auth/me', (request, reply) => runLegacyHandler(request, reply, handleMe));
  app.post('/api/auth/profile', (request, reply) => runLegacyHandler(request, reply, handleUpdateProfile));
  app.post('/api/auth/password', (request, reply) => runLegacyHandler(request, reply, handleChangePassword));
  app.get('/api/auth/rooms', (request, reply) => runLegacyHandler(request, reply, handleAuthRooms));
  app.post('/api/auth/rooms', (request, reply) => runLegacyHandler(request, reply, handleAddAuthRoom));
  app.post('/api/rooms', (request, reply) => runLegacyHandler(request, reply, handleCreateRoom));
  app.put('/api/rooms/:roomId', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleUpdateRoom(req, res, normalizeRoomId(request.params.roomId));
  }));
  app.delete('/api/rooms/:roomId', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleDeleteRoom(req, res, normalizeRoomId(request.params.roomId));
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
  app.post('/api/dm/:userId/read', (request, reply) => runLegacyHandler(request, reply, (req, res) => {
    return handleMarkDmRead(req, res, request.params.userId);
  }));

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
    const server = createApiServer({ store: roomStore, users: userStore, friends: friendStore });
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
  createApiApp,
  createApiServer
};
