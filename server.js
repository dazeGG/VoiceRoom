'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');

const PORT = readEnvInt('PORT', 3000, 1);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_ROOM_PEERS = readEnvInt('MAX_ROOM_PEERS', 8, 1);
const MAX_ROOMS = readEnvInt('MAX_ROOMS', 100, 1);
const KEEPALIVE_MS = readEnvInt('SSE_KEEPALIVE_MS', 15000, 1000);
const BODY_LIMIT_BYTES = readEnvInt('BODY_LIMIT_BYTES', 65536, 1024);
const TURN_TTL_SECONDS = readEnvInt('TURN_TTL_SECONDS', 900, 60);
const ROOM_IDLE_TTL_MS = readEnvInt('ROOM_IDLE_TTL_MS', 900000, 1000);
const ROOM_CREATE_RATE_LIMIT = readEnvInt('ROOM_CREATE_RATE_LIMIT', 20, 0);
const ROOM_CREATE_RATE_WINDOW_MS = readEnvInt('ROOM_CREATE_RATE_WINDOW_MS', 60000, 1000);
const DEFAULT_STUN_URLS = 'stun:stun.l.google.com:19302';

const rooms = new Map();
const roomCreateRates = new Map();

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

function readEnvInt(name, fallback, min) {
  const value = Number.parseInt(process.env[name] || String(fallback), 10);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

function baseHeaders() {
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      "base-uri 'none'",
      "connect-src 'self' https: wss: stun: turn: turns:",
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

function normalizeRoomId(value) {
  if (typeof value !== 'string') return '';
  const roomId = value.trim();
  return /^[A-Za-z0-9_-]{3,48}$/.test(roomId) ? roomId : '';
}

function normalizePeerId(value) {
  if (typeof value !== 'string') return '';
  const peerId = value.trim();
  return /^[A-Za-z0-9_-]{8,80}$/.test(peerId) ? peerId : '';
}

function normalizeSessionToken(value) {
  if (typeof value !== 'string') return '';
  const token = value.trim();
  return /^[A-Za-z0-9_-]{32,128}$/.test(token) ? token : '';
}

function cleanName(value) {
  if (typeof value !== 'string') return 'Guest';
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return 'Guest';
  return compact.slice(0, 40);
}

function cleanStreamId(value) {
  if (typeof value !== 'string') return '';
  const streamId = value.trim();
  return /^[A-Za-z0-9_.:-]{1,120}$/.test(streamId) ? streamId : '';
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

function getClientIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  const forwardedValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const forwardedIp = String(forwardedValue || '').split(',')[0].trim();
  return forwardedIp || req.socket.remoteAddress || 'unknown';
}

function checkRoomCreateRate(req, now = Date.now()) {
  if (ROOM_CREATE_RATE_LIMIT <= 0 || ROOM_CREATE_RATE_WINDOW_MS <= 0) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  for (const [clientIp, entry] of roomCreateRates) {
    if (now - entry.startedAt > ROOM_CREATE_RATE_WINDOW_MS) {
      roomCreateRates.delete(clientIp);
    }
  }

  const clientIp = getClientIp(req);
  const current = roomCreateRates.get(clientIp);
  if (!current || now - current.startedAt >= ROOM_CREATE_RATE_WINDOW_MS) {
    roomCreateRates.set(clientIp, { count: 1, startedAt: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  current.count += 1;
  const retryAfterSeconds = Math.ceil((ROOM_CREATE_RATE_WINDOW_MS - (now - current.startedAt)) / 1000);
  return {
    allowed: current.count <= ROOM_CREATE_RATE_LIMIT,
    retryAfterSeconds
  };
}

function createRoom() {
  pruneRooms();

  let roomId = createRoomId();
  while (rooms.has(roomId)) {
    roomId = createRoomId();
  }

  const now = Date.now();
  const room = {
    createdAt: now,
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
    id: peer.id,
    joinedAt: peer.joinedAt,
    muted: peer.muted,
    name: peer.name,
    screen: peer.screen,
    screenAudio: peer.screenAudio,
    screenStreamId: peer.screenStreamId
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
  for (const peer of room.peers.values()) {
    if (peer.id !== exceptPeerId) {
      sendEvent(peer, message);
    }
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

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getPublicHost(req) {
  const explicitTurnHost = process.env.TURN_HOST && process.env.TURN_HOST.trim();
  if (explicitTurnHost) return explicitTurnHost;

  const explicitPublicHost = process.env.PUBLIC_HOSTNAME && process.env.PUBLIC_HOSTNAME.trim();
  if (explicitPublicHost) return explicitPublicHost;

  const forwardedHost = req.headers['x-forwarded-host'];
  const rawHost = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost || req.headers.host || '';
  return rawHost.split(',')[0].trim().replace(/:\d+$/, '');
}

function buildIceConfig(req) {
  const iceServers = [];
  const stunUrls = parseList(process.env.STUN_URLS || DEFAULT_STUN_URLS);

  if (stunUrls.length > 0) {
    iceServers.push({ urls: stunUrls });
  }

  const turnSecret = process.env.TURN_SECRET && process.env.TURN_SECRET.trim();
  const turnHost = getPublicHost(req);
  if (turnSecret && turnHost) {
    const expiresAt = Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS;
    const username = `${expiresAt}:voice`;
    const credential = crypto.createHmac('sha1', turnSecret).update(username).digest('base64');
    const port = process.env.TURN_PORT || '3478';
    iceServers.push({
      urls: [
        `turn:${turnHost}:${port}?transport=udp`,
        `turn:${turnHost}:${port}?transport=tcp`
      ],
      username,
      credential
    });
  }

  return {
    iceServers,
    iceTransportPolicy: process.env.ICE_TRANSPORT_POLICY || 'all',
    maxRoomPeers: MAX_ROOM_PEERS,
    turnTtlSeconds: TURN_TTL_SECONDS
  };
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
    id: peerId,
    joinedAt: Date.now(),
    muted: false,
    name,
    screen: false,
    screenAudio: false,
    screenStreamId: '',
    sessionToken,
    res
  };
  room.peers.set(peerId, peer);
  room.emptySince = 0;
  room.updatedAt = peer.joinedAt;

  sendEvent(peer, {
    type: 'hello',
    iceConfig: buildIceConfig(req),
    peer: publicPeer(peer),
    peers: existingPeers,
    roomId
  });
  broadcast(room, { type: 'peer-joined', peer: publicPeer(peer) }, peerId);

  const keepalive = setInterval(() => {
    sendEvent(peer, { type: 'ping', at: Date.now() });
  }, KEEPALIVE_MS);

  req.on('close', () => {
    clearInterval(keepalive);
    closePeer(roomId, peerId, res);
  });
}

function handleConfig(req, res, url) {
  const roomId = normalizeRoomId(url.searchParams.get('room'));
  const peerId = normalizePeerId(url.searchParams.get('peer'));
  const sessionToken = normalizeSessionToken(url.searchParams.get('token'));

  if (!roomId || !peerId || !sessionToken) {
    sendJson(res, 401, { ok: false, error: 'Peer session is required' });
    return;
  }

  if (!getAuthorizedPeer(roomId, peerId, sessionToken)) {
    sendJson(res, 403, { ok: false, error: 'Invalid peer session' });
    return;
  }

  sendJson(res, 200, buildIceConfig(req));
}

async function handleCreateRoom(req, res) {
  const rate = checkRoomCreateRate(req);
  if (!rate.allowed) {
    sendJson(
      res,
      429,
      { ok: false, error: 'Too many rooms created, try again later' },
      { 'Retry-After': String(rate.retryAfterSeconds) }
    );
    return;
  }

  await readJsonBody(req);
  pruneRooms();
  if (rooms.size >= MAX_ROOMS) {
    sendJson(res, 503, { ok: false, error: 'Room capacity is temporarily full' });
    return;
  }

  const room = createRoom();
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

async function handleSignal(req, res) {
  const body = await readJsonBody(req);
  const roomId = normalizeRoomId(body.roomId);
  const from = normalizePeerId(body.from);
  const to = normalizePeerId(body.to);
  const sessionToken = normalizeSessionToken(body.sessionToken);
  const signalType = typeof body.signalType === 'string' ? body.signalType : '';
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : null;

  if (!roomId || !from || !to || !sessionToken || !signalType || !payload) {
    sendJson(res, 400, { ok: false, error: 'Invalid signal payload' });
    return;
  }

  const authorized = getAuthorizedPeer(roomId, from, sessionToken);
  if (!authorized) {
    sendJson(res, 403, { ok: false, error: 'Invalid peer session' });
    return;
  }

  const { room } = authorized;
  const target = room?.peers.get(to);
  if (!target) {
    sendJson(res, 404, { ok: false, error: 'Peer is no longer in the room' });
    return;
  }

  sendEvent(target, {
    type: 'signal',
    from,
    signalType,
    payload
  });
  sendJson(res, 200, { ok: true });
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
  if (Object.hasOwn(body, 'screen')) {
    peer.screen = Boolean(body.screen);
  }
  if (Object.hasOwn(body, 'screenAudio')) {
    peer.screenAudio = Boolean(body.screenAudio);
  }
  if (Object.hasOwn(body, 'screenStreamId')) {
    peer.screenStreamId = cleanStreamId(body.screenStreamId);
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

  const resolvedPath = path.resolve(PUBLIC_DIR, `.${pathname}`);
  if (!resolvedPath.startsWith(`${PUBLIC_DIR}${path.sep}`) && resolvedPath !== path.join(PUBLIC_DIR, 'index.html')) {
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
  res.writeHead(statusCode, {
    ...baseHeaders(),
    'Cache-Control': 'no-cache',
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
      sendJson(res, 200, {
        ok: true,
        maxRooms: MAX_ROOMS,
        rooms: rooms.size,
        peers: Array.from(rooms.values()).reduce((count, room) => count + room.peers.size, 0)
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/config') {
      handleConfig(req, res, url);
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

    if (req.method === 'POST' && url.pathname === '/signal') {
      await handleSignal(req, res);
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
});
