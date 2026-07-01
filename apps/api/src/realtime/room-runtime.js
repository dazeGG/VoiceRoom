'use strict';

const { SUMMARY_COALESCE_MS } = require('@voice-room/shared/realtime');
const {
  normalizeRoomId,
  normalizePeerId,
  normalizeSessionToken,
  cleanName,
  cleanStreamId,
  cleanScreenProfileId
} = require('@voice-room/shared/validation');
const { buildServerEnvelope, buildServerErrorEnvelope } = require('./envelope');
const { buildRoomRealtimeSummaryFromLobbyRoom, createSummaryCoalescer } = require('./summary');
const { createWsTransport } = require('./peer-transport');
const { legacyPeerMessageToWs } = require('./legacy-events');

function createRoomRealtimeRuntime(deps) {
  const {
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
  } = deps;

  const recipientCache = new Map();

  async function resolveSummaryRecipients(roomId) {
    const cached = recipientCache.get(roomId);
    if (cached && Date.now() - cached.at < 30000) return cached.userIds;

    const userIds = new Set();
    try {
      const stored = await getRoomStore().listSummaryRecipientUserIds(roomId);
      for (const id of stored) userIds.add(id);
    } catch (error) {
      console.error('Failed to resolve summary recipients:', error);
    }

    const presence = presenceRooms.get(roomId);
    if (presence) {
      for (const peer of presence.peers.values()) {
        if (peer.accountUserId) userIds.add(peer.accountUserId);
      }
    }

    const ids = [...userIds];
    recipientCache.set(roomId, { userIds: ids, at: Date.now() });
    return ids;
  }

  function invalidateRecipientCache(roomId) {
    if (roomId) recipientCache.delete(roomId);
  }

  async function flushSummary(roomId) {
    const dbRoom = await getRoomStore().getRoom(roomId);
    if (!dbRoom) return;
    const presence = presenceRooms.get(roomId);
    const peers = presence ? Array.from(presence.peers.values()).map(publicPeer) : [];
    const summary = buildRoomRealtimeSummaryFromLobbyRoom(publicLobbyRoom(dbRoom), peers, avatarColorForPeerId);
    const envelope = buildServerEnvelope('room.summary', { room: summary });
    const recipients = await resolveSummaryRecipients(roomId);
    for (const userId of recipients) {
      wsRegistry.sendToUser(userId, envelope);
    }
  }

  const summaryCoalescer = createSummaryCoalescer({
    delayMs: SUMMARY_COALESCE_MS,
    flush: (roomId) => {
      void flushSummary(roomId);
    }
  });

  function scheduleSummaryBroadcast(roomId) {
    if (!roomId) return;
    summaryCoalescer.schedule(roomId);
  }

  function connectionWantsRoomDetail(connection, roomId) {
    return connection.previewRoomIds.has(roomId) || connection.activeVoice?.roomId === roomId;
  }

  function broadcastRoomDetail(roomId, envelope, { previewOnly = false } = {}) {
    for (const connection of wsRegistry.connections.values()) {
      const isActivePeer = connection.activeVoice?.roomId === roomId;
      if (previewOnly) {
        // Active peers already receive this over their voice transport via
        // broadcast(); only reach preview-only subscribers here.
        if (isActivePeer || !connection.previewRoomIds.has(roomId)) continue;
      } else if (!connectionWantsRoomDetail(connection, roomId)) {
        continue;
      }
      wsRegistry.sendToConnection(connection, envelope);
    }
  }

  function mirrorLegacyRoomEvent(roomId, message) {
    const envelope = legacyPeerMessageToWs(message, roomId);
    if (!envelope) return;
    broadcastRoomDetail(roomId, envelope, { previewOnly: true });
  }

  function broadcastChatMessage(roomId, message) {
    const envelope = buildServerEnvelope('room.chat.message', {
      roomId,
      message: publicChatMessage(message)
    });
    broadcastRoomDetail(roomId, envelope);
  }

  async function buildRoomSnapshot(roomId, mode = 'preview') {
    const dbRoom = await getRoomStore().getRoom(roomId);
    if (!dbRoom) return null;
    const presence = presenceRooms.get(roomId);
    const peers = presence ? Array.from(presence.peers.values()).map(publicPeer) : [];
    const recentMessages = (await getRoomStore().listMessages(roomId, { limit: 100 })).map(publicChatMessage);
    return {
      roomId,
      room: publicLobbyRoom(dbRoom),
      peers,
      recentMessages,
      mode
    };
  }

  async function subscribePreview(connection, roomId) {
    connection.previewRoomIds.add(roomId);
    const snapshot = await buildRoomSnapshot(roomId, 'preview');
    if (!snapshot) {
      wsRegistry.sendToConnection(connection, buildServerEnvelope('room.not_found', { roomId }));
      connection.previewRoomIds.delete(roomId);
      return;
    }
    wsRegistry.sendToConnection(connection, buildServerEnvelope('room.snapshot', snapshot));
  }

  function unsubscribePreview(connection, roomId) {
    connection.previewRoomIds.delete(roomId);
  }

  function attachVoiceTransport(connection, roomId, peerId, sessionToken) {
    const transport = createWsTransport((message) => {
      const envelope = legacyPeerMessageToWs(message, roomId);
      if (!envelope) return false;
      return wsRegistry.sendToConnection(connection, envelope);
    });
    connection.activeVoice = { roomId, peerId, sessionToken, transportId: transport.id };
    return transport;
  }

  async function joinVoiceRoom(connection, payload, sessionUser) {
    const roomId = normalizeRoomId(payload.roomId);
    const peerId = normalizePeerId(payload.peerId);
    const sessionToken = normalizeSessionToken(payload.sessionToken);
    const name = cleanName(payload.name);

    if (!roomId || !peerId || !sessionToken) {
      return { ok: false, code: 'invalid_join', message: 'Invalid room, peer, or session token' };
    }

    const room = await getRoom(roomId);
    if (!room) {
      wsRegistry.sendToConnection(connection, buildServerEnvelope('room.not_found', { roomId }));
      return { ok: false, code: 'room_not_found' };
    }

    const reconnecting = room.peers.has(peerId);
    const previous = room.peers.get(peerId);
    if (previous && !tokensMatch(previous.sessionToken, sessionToken)) {
      return { ok: false, code: 'invalid_session', message: 'Invalid peer session' };
    }

    const identityResult = await getRoomStore().getOrCreatePeerIdentity({
      roomId,
      peerId,
      sessionToken,
      displayName: name,
      avatarColorKey: sessionAvatarColorKey(sessionUser)
    });
    if (identityResult.status === 'token_mismatch') {
      return { ok: false, code: 'invalid_session', message: 'Invalid peer session' };
    }
    const avatarColorKey = identityResult.identity?.avatarColorKey || avatarColorForPeerId(peerId);

    if (!reconnecting && room.peers.size >= MAX_ROOM_PEERS) {
      wsRegistry.sendToConnection(
        connection,
        buildServerEnvelope('room.full', { roomId, maxRoomPeers: MAX_ROOM_PEERS })
      );
      return { ok: false, code: 'room_full' };
    }

    if (connection.activeVoice?.roomId && connection.activeVoice.roomId !== roomId) {
      await leaveVoiceRoom(connection, connection.activeVoice);
    }

    if (previous) {
      previous.closed = true;
      previous.replaced = true;
      previous.transport?.close();
    }

    const transport = attachVoiceTransport(connection, roomId, peerId, sessionToken);
    const peer = {
      closed: false,
      replaced: false,
      deafened: previous?.deafened ?? false,
      accountUserId: sessionUser?.id || '',
      avatarColorKey,
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
      transport
    };
    room.peers.set(peerId, peer);
    room.updatedAt = peer.joinedAt;
    await getRoomStore().markRoomActive(roomId, peer.joinedAt);

    const snapshot = await buildRoomSnapshot(roomId, 'active');
    if (snapshot) {
      wsRegistry.sendToConnection(connection, buildServerEnvelope('room.snapshot', snapshot));
    }

    if (!reconnecting) {
      broadcast(room, { type: 'peer-joined', peer: publicPeer(peer) }, peerId);
      mirrorLegacyRoomEvent(roomId, { type: 'peer-joined', peer: publicPeer(peer) });
      scheduleSummaryBroadcast(roomId);
    }

    return { ok: true, reconnecting };
  }

  async function leaveVoiceRoom(connection, payload = connection.activeVoice) {
    if (!payload?.roomId || !payload.peerId) return;
    // Close using the transport this connection owns, not whatever peer happens
    // to hold the id now. After a same-peer reconnect the superseded connection
    // must not evict the peer that replaced it — closePeer's guard rejects the
    // stale transport id, so no spurious peer-left is broadcast.
    const transportId = connection.activeVoice?.transportId;
    if (transportId) {
      closePeer(payload.roomId, payload.peerId, transportId, 'left');
    }
    if (connection.activeVoice?.roomId === payload.roomId && connection.activeVoice?.peerId === payload.peerId) {
      connection.activeVoice = null;
    }
    scheduleSummaryBroadcast(payload.roomId);
  }

  async function updatePeerState(connection, payload) {
    const roomId = normalizeRoomId(payload.roomId);
    const peerId = normalizePeerId(payload.peerId);
    const sessionToken = normalizeSessionToken(payload.sessionToken);
    const patch = payload.patch && typeof payload.patch === 'object' ? payload.patch : {};

    const room = presenceRooms.get(roomId);
    const peer = room?.peers.get(peerId);
    if (!room || !peer || !tokensMatch(peer.sessionToken, sessionToken)) {
      return { ok: false, code: 'invalid_session' };
    }
    if (connection.activeVoice?.roomId !== roomId || connection.activeVoice?.peerId !== peerId) {
      return { ok: false, code: 'not_active_peer' };
    }

    if (Object.hasOwn(patch, 'name')) peer.name = cleanName(patch.name);
    if (Object.hasOwn(patch, 'muted')) peer.muted = Boolean(patch.muted);
    if (Object.hasOwn(patch, 'deafened')) peer.deafened = Boolean(patch.deafened);
    if (Object.hasOwn(patch, 'screen')) peer.screen = Boolean(patch.screen);
    if (Object.hasOwn(patch, 'screenAudio')) peer.screenAudio = Boolean(patch.screenAudio);
    if (Object.hasOwn(patch, 'screenProfileId')) peer.screenProfileId = cleanScreenProfileId(patch.screenProfileId);
    if (Object.hasOwn(patch, 'screenStreamId')) peer.screenStreamId = cleanStreamId(patch.screenStreamId);
    if (Object.hasOwn(patch, 'viewedScreenPeerId')) {
      peer.viewedScreenPeerId = normalizePeerId(patch.viewedScreenPeerId) || '';
    }

    broadcast(room, { type: 'peer-updated', peer: publicPeer(peer) });
    mirrorLegacyRoomEvent(roomId, { type: 'peer-updated', peer: publicPeer(peer) });
    scheduleSummaryBroadcast(roomId);
    return { ok: true, peer: publicPeer(peer) };
  }

  function cleanupConnection(connection) {
    if (connection.activeVoice) {
      void leaveVoiceRoom(connection, connection.activeVoice);
    }
    connection.previewRoomIds.clear();
  }

  return {
    broadcastChatMessage,
    broadcastRoomDetail,
    buildRoomSnapshot,
    cleanupConnection,
    flushSummary,
    invalidateRecipientCache,
    joinVoiceRoom,
    leaveVoiceRoom,
    mirrorLegacyRoomEvent,
    scheduleSummaryBroadcast,
    subscribePreview,
    unsubscribePreview,
    updatePeerState
  };
}

module.exports = {
  createRoomRealtimeRuntime
};