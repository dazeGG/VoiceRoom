'use strict';

const crypto = require('node:crypto');
const { existsSync } = require('node:fs');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');
const { AccessToken, TrackSource } = require('livekit-server-sdk');

const { readEnvInt, readEnvBool } = require('./lib/config');
const {
  normalizeRoomId,
  normalizePeerId,
  normalizeSessionToken,
  cleanName,
  cleanStreamId,
  cleanScreenProfileId,
  cleanLiveKitUrl
} = require('./lib/validation');
const { createProofOfWork } = require('./lib/pow');
const { getClientIp, createRateLimiter } = require('./lib/rate-limit');

const PORT = readEnvInt('PORT', 3000, 1);
const STATIC_DIR = path.join(__dirname, 'dist');
const MAX_ROOM_PEERS = readEnvInt('MAX_ROOM_PEERS', 12, 1);
const MAX_ROOMS = readEnvInt('MAX_ROOMS', 100, 1);
const KEEPALIVE_MS = readEnvInt('SSE_KEEPALIVE_MS', 15000, 1000);
const BODY_LIMIT_BYTES = readEnvInt('BODY_LIMIT_BYTES', 65536, 1024);
const TRUST_PROXY = readEnvBool('TRUST_PROXY', false);
const LIVEKIT_TOKEN_TTL_SECONDS = readEnvInt('LIVEKIT_TOKEN_TTL_SECONDS', 21600, 60);
const ROOM_IDLE_TTL_MS = readEnvInt('ROOM_IDLE_TTL_MS', 900000, 1000);
const ROOM_CREATE_RATE_LIMIT = readEnvInt('ROOM_CREATE_RATE_LIMIT', 20, 0);
const ROOM_CREATE_RATE_WINDOW_MS = readEnvInt('ROOM_CREATE_RATE_WINDOW_MS', 60000, 1000);
const MAX_EMPTY_ROOMS_PER_IP = readEnvInt('MAX_EMPTY_ROOMS_PER_IP', 3, 0);
const ROOM_CREATE_POW_DIFFICULTY = Math.min(readEnvInt('ROOM_CREATE_POW_DIFFICULTY', 14, 0), 32);
const ROOM_CREATE_POW_TTL_MS = readEnvInt('ROOM_CREATE_POW_TTL_MS', 120000, 10000);

const rooms = new Map();
const pow = createProofOfWork({
  secret: crypto.randomBytes(32),
  difficulty: ROOM_CREATE_POW_DIFFICULTY,
  ttlMs: ROOM_CREATE_POW_TTL_MS
});
const roomCreateLimiter = createRateLimiter({
  limit: ROOM_CREATE_RATE_LIMIT,
  windowMs: ROOM_CREATE_RATE_WINDOW_MS
});

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

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

function pruneRooms(now = Date.now()) {
  for (const [roomId, room] of rooms) {
    if (room.peers.size === 0 && room.emptySince && now - room.emptySince > ROOM_IDLE_TTL_MS) {
      rooms.delete(roomId);
    }
  }
}

function countEmptyRoomsForIp(clientIp) {
  let count = 0;
  for (const room of rooms.values()) {
    if (room.creatorIp === clientIp && room.peers.size === 0 && room.emptySince) {
      count += 1;
    }
  }
  return count;
}

function createRoom(creatorIp) {
  pruneRooms();

  let roomId = createRoomId();
  while (rooms.has(roomId)) {
    roomId = createRoomId();
  }

  const now = Date.now();
  const room = {
    createdAt: now,
    creatorIp,
    emptySince: now,
    id: roomId,
    peers: new Map(),
    updatedAt: now
  };
  rooms.set(roomId, room);
  return room;
}

function getRoom(roomId) {
  pruneRooms();
  const room = rooms.get(roomId);
  if (!room) return null;

  room.updatedAt = Date.now();
  return room;
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
  const room = rooms.get(roomId);
  const peer = room?.peers.get(peerId);
  if (!room || !peer || !tokensMatch(peer.sessionToken, sessionToken)) return null;
  return { peer, room };
}

function sendEvent(peer, message) {
  if (!peer || peer.closed || !peer.res.writable) return false;
  try {
    peer.res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
    return true;
  } catch (error) {
    peer.closed = true;
    return false;
  }
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
  const room = rooms.get(roomId);
  if (!room) return;

  const current = room.peers.get(peerId);
  if (!current || current.res !== res) return;

  current.closed = true;
  room.peers.delete(peerId);
  if (!current.replaced) {
    broadcast(room, { type: 'peer-left', peerId, reason });
  }

  if (room.peers.size === 0) {
    room.emptySince = Date.now();
    room.updatedAt = room.emptySince;
  } else {
    room.updatedAt = Date.now();
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

  const room = getRoom(roomId);
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
    name,
    screen: previous?.screen ?? false,
    screenAudio: previous?.screenAudio ?? false,
    screenProfileId: previous?.screenProfileId ?? '',
    screenStreamId: previous?.screenStreamId ?? '',
    viewedScreenPeerId: previous?.viewedScreenPeerId ?? '',
    sessionToken,
    res
  };
  room.peers.set(peerId, peer);
  room.emptySince = 0;
  room.updatedAt = peer.joinedAt;

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

  const room = getRoom(roomId);
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

  pruneRooms();
  const clientIp = getClientIp(req, TRUST_PROXY);
  if (MAX_EMPTY_ROOMS_PER_IP > 0 && countEmptyRoomsForIp(clientIp) >= MAX_EMPTY_ROOMS_PER_IP) {
    sendJson(res, 429, {
      ok: false,
      error: 'Too many empty rooms created from this IP, join one or try later'
    });
    return;
  }

  if (rooms.size >= MAX_ROOMS) {
    sendJson(res, 503, { ok: false, error: 'Room capacity is temporarily full' });
    return;
  }

  const room = createRoom(clientIp);
  sendJson(res, 201, {
    ok: true,
    maxRooms: MAX_ROOMS,
    maxRoomPeers: MAX_ROOM_PEERS,
    roomId: room.id
  });
}

function handleRoomStatus(res, url) {
  const match = url.pathname.match(/^\/rooms\/([A-Za-z0-9_-]{3,48})$/);
  const roomId = match ? normalizeRoomId(match[1]) : '';

  if (!roomId) {
    sendJson(res, 404, { ok: false, exists: false, error: 'Room not found' });
    return;
  }

  const room = getRoom(roomId);
  if (!room) {
    sendJson(res, 404, { ok: false, exists: false, error: 'Room not found', roomId });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    createdAt: room.createdAt,
    exists: true,
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

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  let statusCode = 200;

  if (pathname === '/') {
    pathname = '/index.html';
  } else if (pathname.startsWith('/r/')) {
    const match = pathname.match(/^\/r\/([A-Za-z0-9_-]{3,48})\/?$/);
    const roomId = match ? normalizeRoomId(match[1]) : '';
    pruneRooms();
    statusCode = roomId && rooms.has(roomId) ? 200 : 404;
    pathname = '/index.html';
  }

  const resolvedPath = path.resolve(STATIC_DIR, `.${pathname}`);
  if (!resolvedPath.startsWith(`${STATIC_DIR}${path.sep}`) && resolvedPath !== path.join(STATIC_DIR, 'index.html')) {
    sendJson(res, 403, { ok: false, error: 'Forbidden' });
    return;
  }

  let data;
  try {
    data = await fs.readFile(resolvedPath);
  } catch (error) {
    sendJson(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  const ext = path.extname(resolvedPath);
  // Vite emits content-hashed filenames under /assets/, safe to cache forever.
  const cacheControl = pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(statusCode, {
    ...baseHeaders(),
    'Cache-Control': cacheControl,
    'Content-Type': mimeTypes[ext] || 'application/octet-stream'
  });
  if (req.method === 'HEAD') {
    res.end();
  } else {
    res.end(data);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/healthz') {
      pruneRooms();
      const livekit = getLiveKitConfig();
      sendJson(res, 200, {
        livekit: livekit.enabled,
        livekitUrl: livekit.url || null,
        ok: true,
        maxRooms: MAX_ROOMS,
        rooms: rooms.size,
        peers: Array.from(rooms.values()).reduce((count, room) => count + room.peers.size, 0)
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/pow-challenge') {
      handlePowChallenge(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/rooms') {
      await handleCreateRoom(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/rooms/')) {
      handleRoomStatus(res, url);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      await handleEvents(req, res, url);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/livekit-token') {
      await handleLiveKitToken(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/state') {
      await handleState(req, res);
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      await serveStatic(req, res, url);
      return;
    }

    sendJson(res, 405, { ok: false, error: 'Method not allowed' }, { Allow: 'GET, HEAD, POST' });
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

server.listen(PORT, () => {
  console.log(`Voice chat is listening on http://localhost:${PORT}`);
  if (!existsSync(path.join(STATIC_DIR, 'index.html'))) {
    console.warn('Client build not found in dist/. Run "npm run build" (production) or use "npm run dev:web" (development).');
  }
});
