'use strict';

const { normalizeRoomId, normalizePeerId, normalizeSessionToken, cleanName } = require('./validation');

const MAX_VISIBLE_ROOM_PEERS = 5;
const SUMMARY_COALESCE_MS = 75;

// Only commands the WS server actually handles are accepted here. Chat and DM
// sends still travel over HTTP (POST /api/rooms/:id/chat, POST /api/dm/:id), so
// room.chat.send / dm.send / dm.read are intentionally absent until Phase 6
// ports them to WS. Adding a type here without a handler makes the client
// believe a channel exists that the server silently drops.
const KNOWN_CLIENT_TYPES = new Set([
  'hello',
  'ping',
  'room.preview.subscribe',
  'room.preview.unsubscribe',
  'room.join',
  'room.leave',
  'room.peer.update'
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseClientEnvelope(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, code: 'empty_message' };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'invalid_json' };
  }

  if (!isPlainObject(parsed) || typeof parsed.type !== 'string' || !parsed.type.trim()) {
    return { ok: false, code: 'invalid_envelope' };
  }

  if (parsed.payload !== undefined && !isPlainObject(parsed.payload) && parsed.payload !== null) {
    return { ok: false, code: 'invalid_payload' };
  }

  return {
    ok: true,
    envelope: {
      id: typeof parsed.id === 'string' ? parsed.id : undefined,
      type: parsed.type.trim(),
      payload: parsed.payload === undefined ? {} : parsed.payload
    }
  };
}

function parseServerEnvelope(raw) {
  return parseClientEnvelope(raw);
}

function buildServerEnvelope(type, payload = {}, id) {
  const envelope = { type, payload };
  if (typeof id === 'string' && id) envelope.id = id;
  return envelope;
}

function buildServerErrorEnvelope(code, message, id) {
  const envelope = {
    type: 'error',
    error: { code, message }
  };
  if (typeof id === 'string' && id) envelope.id = id;
  return envelope;
}

function toRoomPeerSummary(peer, resolveAvatarColorKey) {
  const resolver = typeof resolveAvatarColorKey === 'function' ? resolveAvatarColorKey : () => '';
  return {
    id: peer.id,
    accountUserId: peer.accountUserId || undefined,
    avatarColorKey: peer.avatarColorKey || resolver(peer.id) || 'blurple',
    muted: Boolean(peer.muted),
    name: cleanName(peer.name)
  };
}

function buildRoomRealtimeSummary(room, peers, resolveAvatarColorKey) {
  const peerList = Array.isArray(peers) ? peers : [];
  const visiblePeers = peerList.slice(0, MAX_VISIBLE_ROOM_PEERS).map((peer) =>
    toRoomPeerSummary(peer, resolveAvatarColorKey)
  );
  const peerCount = peerList.length;

  return {
    roomId: room.roomId || room.id || '',
    name: room.name || '',
    emoji: room.emoji || '',
    roomColorKey: room.roomColorKey || 'blue',
    roomIconKey: room.roomIconKey || 'headphones',
    roomPresetKey: room.roomPresetKey || 'voice-blue',
    isStatic: Boolean(room.isStatic),
    relationship: room.relationship || 'owner',
    peers: peerCount,
    visiblePeers,
    hiddenPeerCount: Math.max(0, peerCount - visiblePeers.length),
    lastMessageAt: room.lastMessageAt ?? null,
    unreadCount: room.unreadCount ?? undefined
  };
}

function validateClientCommand(envelope) {
  if (!envelope || typeof envelope.type !== 'string') {
    return { ok: false, code: 'invalid_envelope' };
  }

  if (!KNOWN_CLIENT_TYPES.has(envelope.type)) {
    return { ok: false, code: 'unknown_type' };
  }

  const payload = isPlainObject(envelope.payload) ? envelope.payload : {};

  if (envelope.type === 'ping') {
    if (typeof payload.at !== 'number' || !Number.isFinite(payload.at)) {
      return { ok: false, code: 'invalid_ping' };
    }
  }

  if (envelope.type === 'room.preview.subscribe' || envelope.type === 'room.preview.unsubscribe') {
    if (!normalizeRoomId(payload.roomId)) return { ok: false, code: 'invalid_room_id' };
  }

  if (envelope.type === 'room.join' || envelope.type === 'room.leave') {
    if (!normalizeRoomId(payload.roomId)) return { ok: false, code: 'invalid_room_id' };
    if (!normalizePeerId(payload.peerId)) return { ok: false, code: 'invalid_peer_id' };
    if (!normalizeSessionToken(payload.sessionToken)) return { ok: false, code: 'invalid_session_token' };
  }

  if (envelope.type === 'room.join' && !cleanName(payload.name)) {
    return { ok: false, code: 'invalid_name' };
  }

  return { ok: true, envelope: { ...envelope, payload } };
}

module.exports = {
  MAX_VISIBLE_ROOM_PEERS,
  SUMMARY_COALESCE_MS,
  KNOWN_CLIENT_TYPES,
  parseClientEnvelope,
  parseServerEnvelope,
  buildServerEnvelope,
  buildServerErrorEnvelope,
  toRoomPeerSummary,
  buildRoomRealtimeSummary,
  validateClientCommand
};