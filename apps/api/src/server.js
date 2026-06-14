'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const { URL } = require('node:url');
const { AccessToken, TrackSource } = require('livekit-server-sdk');

const { readEnvInt, readEnvBool, readDatabaseConfig } = require('./lib/config');
const {
  normalizeRoomId,
  normalizePeerId,
  normalizeSessionToken,
  cleanName,
  cleanStreamId,
  cleanScreenProfileId,
  cleanLiveKitUrl
} = require('@voice-room/shared/validation');
const { createProofOfWork } = require('./lib/pow');
const { getClientIp, createRateLimiter } = require('./lib/rate-limit');
const { createRoomStore } = require('./lib/room-store');
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
const MAX_EMPTY_ROOMS_PER_IP = readEnvInt('MAX_EMPTY_ROOMS_PER_IP', 3, 0);
const ROOM_CREATE_POW_DIFFICULTY = Math.min(readEnvInt('ROOM_CREATE_POW_DIFFICULTY', 14, 0), 32);
const ROOM_CREATE_POW_TTL_MS = readEnvInt('ROOM_CREATE_POW_TTL_MS', 120000, 10000);
// Desktop app downloads are served from the latest GitHub release of this repo.
// Metadata is cached server-side so visitors never hit GitHub's per-IP rate limit.
const DESKTOP_RELEASE_REPO = (process.env.DESKTOP_RELEASE_REPO || 'dazeGG/VoiceRoomDesktop').trim();
const DESKTOP_RELEASE_CACHE_MS = readEnvInt('DESKTOP_RELEASE_CACHE_MS', 600000, 1000);
const DESKTOP_RELEASE_TIMEOUT_MS = readEnvInt('DESKTOP_RELEASE_TIMEOUT_MS', 6000, 1000);

let roomStore = null;
const presenceRooms = new Map();
const roomChatStreams = new Map();

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

function sendSse(res, message) {
  if (!res || res.writableEnded || !res.writable) return false;
  try {
    res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
    return true;
  } catch {
    return false;
  }
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
  for (const [roomId, subscribers] of roomChatStreams) {
    const room = await getRoomStore().getRoom(roomId);
    if (room) continue;
    for (const subscriber of subscribers) {
      try {
        subscriber.end();
      } catch {
        // Ignore cleanup failures.
      }
    }
    roomChatStreams.delete(roomId);
    presenceRooms.delete(roomId);
  }
}

function startPruneTimer(server, logger = console) {
  if (ROOM_PRUNE_INTERVAL_MS <= 0) return null;

  const timer = setInterval(() => {
    void pruneRooms().catch((error) => {
      logger.error('Room prune timer failed:', error);
    });
  }, ROOM_PRUNE_INTERVAL_MS);

  if (typeof timer.unref === 'function') timer.unref();
  server.once('close', () => clearInterval(timer));
  return timer;
}

async function countRoomCreationQuotaRoomsForIp(clientIp) {
  return getRoomStore().countQuotaRoomsForIp(clientIp);
}

async function createRoomForRequest(creatorIp, isStatic = false) {
  await pruneRooms();

  let roomId = createRoomId();
  while (await getRoomStore().getRoom(roomId)) {
    roomId = createRoomId();
  }

  return getRoomStore().createRoomWithQuota({
    creatorIp,
    isStatic,
    maxQuotaRoomsPerIp: MAX_EMPTY_ROOMS_PER_IP,
    maxRooms: MAX_ROOMS,
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
  const sent = sendSse(peer?.res, message);
  if (!sent && peer) peer.closed = true;
  return sent;
}

function broadcast(room, message, exceptPeerId = '') {
  const failedPeers = [];
  for (const peer of room.peers.values()) {
    if (peer.id !== exceptPeerId) {
      const sent = sendEvent(peer, message);
      if (!sent) failedPeers.push(peer);
    }
  }

  for (const peer of failedPeers) {
    closePeer(room.id, peer.id, peer.res, 'lost');
  }
}

function closePeer(roomId, peerId, res, reason = 'left') {
  const room = presenceRooms.get(roomId);
  if (!room) return;

  const current = room.peers.get(peerId);
  if (!current || current.res !== res) return;

  current.closed = true;
  room.peers.delete(peerId);
  if (!current.replaced) {
    broadcast(room, { type: 'peer-left', peerId, reason });
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
    createdAt: message.createdAt,
    expiresAt: message.expiresAt,
    id: message.id,
    name: message.name,
    peerId: message.peerId,
    roomId: message.roomId,
    text: message.text
  };
}

function getChatSubscribers(roomId) {
  let subscribers = roomChatStreams.get(roomId);
  if (!subscribers) {
    subscribers = new Set();
    roomChatStreams.set(roomId, subscribers);
  }
  return subscribers;
}

function broadcastChat(roomId, message) {
  const subscribers = roomChatStreams.get(roomId);
  if (!subscribers || subscribers.size === 0) return;

  const payload = { type: 'chat-message', message: publicChatMessage(message) };
  const failed = [];
  for (const res of subscribers) {
    if (!sendSse(res, payload)) {
      failed.push(res);
    }
  }
  for (const res of failed) {
    subscribers.delete(res);
  }
  if (subscribers.size === 0) {
    roomChatStreams.delete(roomId);
  }
}

async function readJsonBody(req) {
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

async function handleEvents(req, res, url) {
  const roomId = normalizeRoomId(url.searchParams.get('room'));
  const peerId = normalizePeerId(url.searchParams.get('peer'));
  const sessionToken = normalizeSessionToken(url.searchParams.get('token'));
  const name = cleanName(url.searchParams.get('name'));

  if (!roomId || !peerId || !sessionToken) {
    sendJson(res, 400, { ok: false, error: 'Invalid room, peer, or session token' });
    return;
  }

  const room = await getRoom(roomId);
  if (!room) {
    res.writeHead(200, {
      ...baseHeaders(),
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no'
    });
    res.write(`event: message\ndata: ${JSON.stringify({ type: 'room-not-found', roomId })}\n\n`);
    res.end();
    return;
  }

  const reconnecting = room.peers.has(peerId);
  const previous = room.peers.get(peerId);
  if (previous && !tokensMatch(previous.sessionToken, sessionToken)) {
    sendJson(res, 403, { ok: false, error: 'Invalid peer session' });
    return;
  }

  if (!reconnecting && room.peers.size >= MAX_ROOM_PEERS) {
    res.writeHead(200, {
      ...baseHeaders(),
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no'
    });
    res.write(`event: message\ndata: ${JSON.stringify({ type: 'room-full', maxRoomPeers: MAX_ROOM_PEERS })}\n\n`);
    res.end();
    return;
  }

  const existingPeers = Array.from(room.peers.values())
    .filter((peer) => peer.id !== peerId)
    .map(publicPeer);

  if (previous) {
    previous.closed = true;
    previous.replaced = true;
    previous.res.end();
  }

  res.writeHead(200, {
    ...baseHeaders(),
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream; charset=utf-8',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();
  res.write(': connected\n\n');

  const peer = {
    closed: false,
    deafened: previous?.deafened ?? false,
    id: peerId,
    joinedAt: previous?.joinedAt ?? Date.now(),
    muted: previous?.muted ?? false,
    name: reconnecting ? (previous?.name ?? name) : name,
    screen: previous?.screen ?? false,
    screenAudio: previous?.screenAudio ?? false,
    screenProfileId: previous?.screenProfileId ?? '',
    screenStreamId: previous?.screenStreamId ?? '',
    viewedScreenPeerId: previous?.viewedScreenPeerId ?? '',
    sessionToken,
    res
  };
  room.peers.set(peerId, peer);
  room.updatedAt = peer.joinedAt;
  await getRoomStore().markRoomActive(roomId, peer.joinedAt);

  sendEvent(peer, {
    type: 'hello',
    peer: publicPeer(peer),
    peers: existingPeers,
    roomId
  });
  if (!reconnecting) {
    broadcast(room, { type: 'peer-joined', peer: publicPeer(peer) }, peerId);
  }

  const keepalive = setInterval(() => {
    const sent = sendEvent(peer, { type: 'ping', at: Date.now() });
    if (!sent) {
      clearInterval(keepalive);
      closePeer(roomId, peerId, res, 'lost');
    }
  }, KEEPALIVE_MS);

  req.on('close', () => {
    clearInterval(keepalive);
    closePeer(roomId, peerId, res);
  });
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
  const created = await createRoomForRequest(clientIp, parseBoolean(body.isStatic));
  if (created.status === 'quota_exceeded') {
    sendJson(res, 429, {
      ok: false,
      error: 'Too many rooms waiting from this IP, reuse one or try later'
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
    maxRooms: MAX_ROOMS,
    maxRoomPeers: MAX_ROOM_PEERS,
    isStatic: room.isStatic,
    roomId: room.id
  });
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
    exists: true,
    emptySince: room.emptySince,
    isStatic: room.isStatic,
    maxRoomPeers: MAX_ROOM_PEERS,
    peers: room.peers.size,
    roomId
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

async function handleRoomChatStream(req, res, roomId) {
  const room = await getRoom(roomId);
  if (!room) {
    res.writeHead(200, {
      ...baseHeaders(),
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no'
    });
    sendSse(res, { type: 'room-not-found', roomId });
    res.end();
    return;
  }

  res.writeHead(200, {
    ...baseHeaders(),
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream; charset=utf-8',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();
  res.write(': connected\n\n');

  const subscribers = getChatSubscribers(roomId);
  subscribers.add(res);

  const keepalive = setInterval(() => {
    if (!sendSse(res, { type: 'ping', at: Date.now() })) {
      clearInterval(keepalive);
      subscribers.delete(res);
      if (subscribers.size === 0) {
        roomChatStreams.delete(roomId);
      }
    }
  }, KEEPALIVE_MS);

  req.on('close', () => {
    clearInterval(keepalive);
    subscribers.delete(res);
    if (subscribers.size === 0) {
      roomChatStreams.delete(roomId);
    }
  });
}

async function handleRoomChatPost(req, res, roomId) {
  await pruneRooms();
  const room = await getRoom(roomId);
  const clientIp = getClientIp(req, TRUST_PROXY);
  const body = await readJsonBody(req);
  const requestedPeerId = normalizePeerId(body.peerId);
  const sessionToken = normalizeSessionToken(body.sessionToken);
  const name = cleanName(body.name);
  const text = cleanChatText(body.text);

  if (!room || !text) {
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

  let peerId = requestedPeerId || `chat-${crypto.randomBytes(12).toString('hex')}`;
  const activePeer = requestedPeerId ? room.peers.get(requestedPeerId) : null;
  if (activePeer) {
    if (!tokensMatch(activePeer.sessionToken, sessionToken)) {
      sendJson(res, 403, { ok: false, error: 'Invalid peer session' });
      return;
    }
    peerId = activePeer.id;
  }

  const now = Date.now();
  const message = await getRoomStore().appendMessage(roomId, {
    createdAt: now,
    expiresAt: now + ROOM_CHAT_TTL_MS,
    id: crypto.randomUUID?.() || crypto.randomBytes(16).toString('hex'),
    name,
    peerId,
    text
  });

  if (!message) {
    sendJson(res, 400, { ok: false, error: 'Invalid chat message' });
    return;
  }

  broadcastChat(roomId, message);
  sendJson(res, 201, { ok: true, message: publicChatMessage(message) });
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

function createApiServer({ store = null } = {}) {
  if (store) roomStore = store;
  return http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const routePath = getApiRoutePath(url.pathname);
    if (!routePath) {
      sendJson(res, 404, { ok: false, error: 'Not found' });
      return;
    }

    if (req.method === 'GET' && routePath === '/healthz') {
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
      return;
    }

    if (req.method === 'GET' && routePath === '/pow-challenge') {
      handlePowChallenge(req, res);
      return;
    }

    if (req.method === 'GET' && routePath === '/desktop/latest') {
      await handleDesktopLatest(res);
      return;
    }

    if (req.method === 'POST' && routePath === '/rooms') {
      await handleCreateRoom(req, res);
      return;
    }

    if (req.method === 'GET' && routePath.startsWith('/rooms/')) {
      const chatMatch = routePath.match(/^\/rooms\/([A-Za-z0-9_-]{3,48})\/chat\/stream$/);
      if (chatMatch) {
        await handleRoomChatStream(req, res, normalizeRoomId(chatMatch[1]));
        return;
      }

      const listMatch = routePath.match(/^\/rooms\/([A-Za-z0-9_-]{3,48})\/chat$/);
      if (listMatch) {
        await handleRoomChatList(res, normalizeRoomId(listMatch[1]));
        return;
      }

      await handleRoomStatus(res, new URL(routePath, url));
      return;
    }

    if (req.method === 'GET' && routePath === '/events') {
      await handleEvents(req, res, url);
      return;
    }

    if (req.method === 'POST' && routePath === '/livekit-token') {
      await handleLiveKitToken(req, res);
      return;
    }

    if (req.method === 'POST' && routePath === '/state') {
      await handleState(req, res);
      return;
    }

    if (req.method === 'POST') {
      const chatMatch = routePath.match(/^\/rooms\/([A-Za-z0-9_-]{3,48})\/chat$/);
      if (chatMatch) {
        await handleRoomChatPost(req, res, normalizeRoomId(chatMatch[1]));
        return;
      }
    }

    sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    const status = error.statusCode || 500;
    const message = error.publicMessage || (status >= 500 ? 'Internal server error' : error.message);
    if (status >= 500) {
      console.error(error);
    }
    if (!res.headersSent) {
      sendJson(res, status, { ok: false, error: message });
    } else {
      res.end();
    }
  }
  });
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
    const server = createApiServer({ store: roomStore });
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
  createApiServer
};
