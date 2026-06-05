'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_ROOM_PEERS = Number.parseInt(process.env.MAX_ROOM_PEERS || '8', 10);
const KEEPALIVE_MS = Number.parseInt(process.env.SSE_KEEPALIVE_MS || '15000', 10);
const BODY_LIMIT_BYTES = Number.parseInt(process.env.BODY_LIMIT_BYTES || '65536', 10);
const TURN_TTL_SECONDS = Number.parseInt(process.env.TURN_TTL_SECONDS || '43200', 10);
const ROOM_IDLE_TTL_MS = Number.parseInt(process.env.ROOM_IDLE_TTL_MS || '900000', 10);
const DEFAULT_STUN_URLS = 'stun:stun.l.google.com:19302';

const rooms = new Map();

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

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
      "script-src 'self'",
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
  const name = cleanName(url.searchParams.get('name'));

  if (!roomId || !peerId) {
    sendJson(res, 400, { ok: false, error: 'Invalid room or peer id' });
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

  const previous = room.peers.get(peerId);
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
  broadcast(room, { type: 'peer-joined', peer: publicPeer(peer) }, peerId);

  const keepalive = setInterval(() => {
    sendEvent(peer, { type: 'ping', at: Date.now() });
  }, KEEPALIVE_MS);

  req.on('close', () => {
    clearInterval(keepalive);
    closePeer(roomId, peerId, res);
  });
}

async function handleCreateRoom(req, res) {
  await readJsonBody(req);
  const room = createRoom();
  sendJson(res, 201, {
    ok: true,
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
  const signalType = typeof body.signalType === 'string' ? body.signalType : '';
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : null;

  if (!roomId || !from || !to || !signalType || !payload) {
    sendJson(res, 400, { ok: false, error: 'Invalid signal payload' });
    return;
  }

  const room = rooms.get(roomId);
  const sender = room?.peers.get(from);
  const target = room?.peers.get(to);
  if (!room || !sender || !target) {
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
  const room = roomId && rooms.get(roomId);
  const peer = room && room.peers.get(peerId);

  if (!room || !peer) {
    sendJson(res, 404, { ok: false, error: 'Peer is no longer in the room' });
    return;
  }

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
        rooms: rooms.size,
        peers: Array.from(rooms.values()).reduce((count, room) => count + room.peers.size, 0)
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/config') {
      sendJson(res, 200, buildIceConfig(req));
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
