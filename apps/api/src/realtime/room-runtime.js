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

function resolveViewedScreenPeerId(room, viewerPeerId, value) {
  const ownerPeerId = normalizePeerId(value);
  if (!ownerPeerId || ownerPeerId === viewerPeerId) return '';
  return room?.peers.get(ownerPeerId)?.screen ? ownerPeerId : '';
}

function clearViewedScreenPeerReferences(room, ownerPeerId) {
  if (!room?.peers || !ownerPeerId) return [];
  const clearedViewers = [];
  for (const viewer of room.peers.values()) {
    if (viewer.viewedScreenPeerId !== ownerPeerId) continue;
    viewer.viewedScreenPeerId = '';
    clearedViewers.push(viewer);
  }
  return clearedViewers;
}

function createRoomRealtimeRuntime(deps) {
  const {
    presenceRooms,
    wsRegistry,
    getRoomStore,
    getRoom,
    publicPeer,
    publicLobbyRoom,
    publicChatMessage,
    getUserStore,
    broadcast,
    closePeer,
    avatarColorForPeerId,
    MAX_ROOM_PEERS,
    tokensMatch,
    sessionAvatarColorKey,
    queueRoomOccupancyTransition = async (roomId) => getRoomStore().markRoomActive(roomId),
    findRoomBan = async () => null
  } = deps;

  const recipientCache = new Map();
  const voiceJoinStates = new Map();
  let voiceJoinRequestSequence = 0;

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

  async function resolveRoomUnreadCount(roomId, userId, fallback = 0) {
    const getUnreadCount = getRoomStore().getRoomUnreadCount;
    if (typeof getUnreadCount !== 'function') return fallback;
    return getUnreadCount.call(getRoomStore(), roomId, userId);
  }

  async function flushSummary(roomId) {
    const dbRoom = await getRoomStore().getRoom(roomId);
    if (!dbRoom) return;
    const presence = presenceRooms.get(roomId);
    const peers = presence ? Array.from(presence.peers.values()).map(publicPeer) : [];
    const recipients = await resolveSummaryRecipients(roomId);
    await Promise.all(recipients.map((userId) => sendRoomSummaryToUser(roomId, userId, dbRoom, peers)));
  }

  async function sendRoomSummaryToUser(roomId, userId, room = null, roomPeers = null) {
    if (!roomId || !userId) return false;
    const dbRoom = room || await getRoomStore().getRoom(roomId);
    if (!dbRoom) return false;
    const presence = presenceRooms.get(roomId);
    const peers = roomPeers || (presence ? Array.from(presence.peers.values()).map(publicPeer) : []);
    const unreadCount = await resolveRoomUnreadCount(roomId, userId);
    const summary = buildRoomRealtimeSummaryFromLobbyRoom(
      publicLobbyRoom({ ...dbRoom, unreadCount }),
      peers,
      avatarColorForPeerId
    );
    wsRegistry.sendToUser(userId, buildServerEnvelope('room.summary', { room: summary }));
    return true;
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
    for (const connection of wsRegistry.roomDetailSubscribers(roomId)) {
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
    scheduleSummaryBroadcast(roomId);
    void broadcastRoomMessageNotification(roomId, message);
  }

  function roomNotificationContext(room) {
    return {
      avatarUrl: room.avatarKey ? `/api/avatars/${encodeURIComponent(room.avatarKey)}` : null,
      roomId: room.id,
      name: room.name || ''
    };
  }

  function senderNotificationContext(message, user) {
    if (user) {
      return {
        id: user.id,
        displayName: user.displayName || '',
        login: user.login || '',
        avatarAccent: user.avatarAccent || null,
        avatarColorKey: user.avatarColorKey || message.avatarColorKey || '',
        avatarUrl: user.avatarKey ? `/api/avatars/${encodeURIComponent(user.avatarKey)}` : null
      };
    }
    return {
      id: message.authorUserId || '',
      peerId: message.peerId || '',
      displayName: message.name || '',
      login: '',
      avatarAccent: message.avatarAccent || null,
      avatarColorKey: message.avatarColorKey || '',
      avatarUrl: message.avatarUrl || null
    };
  }

  async function broadcastRoomMessageNotification(roomId, message) {
    if (!getUserStore) return;
    let room = null;
    try {
      room = await getRoomStore().getRoom(roomId);
    } catch (error) {
      console.error('Failed to resolve room notification room:', error);
      return;
    }
    if (!room?.isStatic) return;

    let recipients = [];
    try {
      const listNotificationRecipients = getRoomStore().listNotificationRecipientUserIds;
      recipients = typeof listNotificationRecipients === 'function'
        ? await listNotificationRecipients(roomId)
        : [];
    } catch (error) {
      console.error('Failed to resolve room notification recipients:', error);
      return;
    }

    const authorUserId = message.authorUserId || '';
    let authorUser = null;
    if (authorUserId) {
      try {
        authorUser = await getUserStore().getUserById(authorUserId);
      } catch (error) {
        console.error('Failed to resolve room notification sender:', error);
      }
    }

    const notification = {
      type: 'notification.room.message',
      dedupeKey: `room:${roomId}:message:${message.id}`,
      room: roomNotificationContext(room),
      sender: senderNotificationContext(message, authorUser),
      message: {
        id: message.id,
        body: message.text,
        createdAt: message.createdAt
      }
    };

    for (const userId of recipients) {
      if (!userId || (authorUserId && userId === authorUserId)) continue;
      try {
        wsRegistry.broadcastAccountEvent(userId, notification);
      } catch (error) {
        console.error('Failed to broadcast room notification:', error);
      }
    }
  }

  async function buildRoomSnapshot(roomId, mode = 'preview') {
    const dbRoom = await getRoomStore().getRoom(roomId);
    if (!dbRoom) return null;
    const recentMessages = (await getRoomStore().listMessages(roomId, { limit: 100 })).map(publicChatMessage);
    // Presence is the last synchronous read: no awaited work may let this
    // snapshot overwrite a newer peer update that was already broadcast.
    const presence = presenceRooms.get(roomId);
    const peers = presence ? Array.from(presence.peers.values()).map(publicPeer) : [];
    return {
      roomId,
      room: publicLobbyRoom(dbRoom),
      peers,
      recentMessages,
      voiceActiveSince: presence?.voiceActiveSince || null,
      mode
    };
  }

  async function subscribePreview(connection, roomId) {
    if (connection.closed) return;
    const roomBan = await findRoomBan(
      roomId,
      connection.userId,
      connection.clientIp || connection.guestIp || ''
    );
    if (connection.closed) return;
    if (roomBan) {
      wsRegistry.sendToConnection(connection, buildServerEnvelope('room.banned', { roomId }));
      return;
    }
    connection.previewRoomIds.add(roomId);
    wsRegistry.registerConnectionForRoom(connection, roomId);
    let snapshot;
    try {
      snapshot = await buildRoomSnapshot(roomId, 'preview');
    } catch (error) {
      unsubscribePreview(connection, roomId);
      throw error;
    }
    if (connection.closed) {
      unsubscribePreview(connection, roomId);
      return;
    }
    if (!snapshot) {
      wsRegistry.sendToConnection(connection, buildServerEnvelope('room.not_found', { roomId }));
      unsubscribePreview(connection, roomId);
      return;
    }
    wsRegistry.sendToConnection(connection, buildServerEnvelope('room.snapshot', snapshot));
  }

  function unsubscribePreview(connection, roomId) {
    connection.previewRoomIds.delete(roomId);
    if (connection.activeVoice?.roomId !== roomId) wsRegistry.unregisterConnectionForRoom(connection, roomId);
  }

  function attachVoiceTransport(connection, roomId, peerId, sessionToken) {
    const transport = createWsTransport((message) => {
      const envelope = legacyPeerMessageToWs(message, roomId);
      if (!envelope) return false;
      return wsRegistry.sendToConnection(connection, envelope);
    });
    connection.activeVoice = { roomId, peerId, sessionToken, transportId: transport.id };
    wsRegistry.registerConnectionForRoom(connection, roomId);
    return transport;
  }

  function beginVoiceJoin(joinKey) {
    const joinState = voiceJoinStates.get(joinKey) || { latestAuthorized: 0, pending: 0 };
    joinState.pending += 1;
    voiceJoinStates.set(joinKey, joinState);
    return joinState;
  }

  function authorizeVoiceJoin(joinState, joinRequestSequence) {
    if (joinRequestSequence < joinState.latestAuthorized) return false;
    joinState.latestAuthorized = joinRequestSequence;
    return true;
  }

  function finishVoiceJoin(joinKey, joinState) {
    joinState.pending -= 1;
    if (joinState.pending === 0 && voiceJoinStates.get(joinKey) === joinState) {
      voiceJoinStates.delete(joinKey);
    }
  }

  function beginConnectionVoiceJoin(connection, roomId, peerId) {
    const intent = { roomId, peerId };
    connection.pendingVoiceJoin = intent;
    return intent;
  }

  function isCurrentConnectionVoiceJoin(connection, intent) {
    return !connection.closed && connection.pendingVoiceJoin === intent;
  }

  function finishConnectionVoiceJoin(connection, intent) {
    if (connection.pendingVoiceJoin === intent) connection.pendingVoiceJoin = null;
  }

  function cancelConnectionVoiceJoin(connection, payload = null) {
    const pending = connection.pendingVoiceJoin;
    if (!pending) return;
    if (
      payload
      && (
        normalizeRoomId(payload.roomId) !== pending.roomId
        || normalizePeerId(payload.peerId) !== pending.peerId
      )
    ) {
      return;
    }
    connection.pendingVoiceJoin = null;
  }

  function supersededVoiceJoin(connection, roomId, transportId = '') {
    if (transportId && connection.activeVoice?.transportId === transportId) {
      closePeer(roomId, connection.activeVoice.peerId, transportId, 'replaced');
      connection.activeVoice = null;
      if (!connection.previewRoomIds.has(roomId)) wsRegistry.unregisterConnectionForRoom(connection, roomId);
    }
    return { ok: false, code: 'superseded_join', message: 'Join replaced by a newer connection' };
  }

  async function joinVoiceRoom(connection, payload, sessionUser, clientIp = '') {
    const joinRequestSequence = ++voiceJoinRequestSequence;
    const roomId = normalizeRoomId(payload.roomId);
    const peerId = normalizePeerId(payload.peerId);
    const sessionToken = normalizeSessionToken(payload.sessionToken);
    const name = cleanName(sessionUser?.displayName || sessionUser?.login || payload.name);

    if (!roomId || !peerId || !sessionToken) {
      return { ok: false, code: 'invalid_join', message: 'Invalid room, peer, or session token' };
    }

    const joinKey = `${roomId}:${peerId}`;
    const joinState = beginVoiceJoin(joinKey);
    const connectionJoinIntent = beginConnectionVoiceJoin(connection, roomId, peerId);
    try {
      // Register the request before the first await. Otherwise an older join
      // delayed in room/ban lookup could start a fresh generation after a newer
      // request has already completed and incorrectly replace it.
      const room = await getRoom(roomId);
      if (!isCurrentConnectionVoiceJoin(connection, connectionJoinIntent)) {
        return supersededVoiceJoin(connection, roomId);
      }
      if (!room) {
        wsRegistry.sendToConnection(connection, buildServerEnvelope('room.not_found', { roomId }));
        return { ok: false, code: 'room_not_found' };
      }

      const roomBan = await findRoomBan(roomId, sessionUser?.id, clientIp);
      if (!isCurrentConnectionVoiceJoin(connection, connectionJoinIntent)) {
        return supersededVoiceJoin(connection, roomId);
      }
      if (roomBan) {
        return { ok: false, code: 'room_banned', message: 'Вы заблокированы в этой комнате' };
      }

      const initialPeer = room.peers.get(peerId);
      if (initialPeer && !tokensMatch(initialPeer.sessionToken, sessionToken)) {
        return { ok: false, code: 'invalid_session', message: 'Invalid peer session' };
      }

      const identityResult = await getRoomStore().getOrCreatePeerIdentity({
        roomId,
        peerId,
        sessionToken,
        displayName: name,
        avatarColorKey: sessionAvatarColorKey(sessionUser)
      });
      if (!isCurrentConnectionVoiceJoin(connection, connectionJoinIntent)) {
        return supersededVoiceJoin(connection, roomId);
      }
      if (identityResult.status === 'token_mismatch') {
        return { ok: false, code: 'invalid_session', message: 'Invalid peer session' };
      }
      const avatarColorKey = identityResult.identity?.avatarColorKey || avatarColorForPeerId(peerId);
      if (!authorizeVoiceJoin(joinState, joinRequestSequence)) {
        return supersededVoiceJoin(connection, roomId);
      }

      if (
        connection.activeVoice
        && (
          connection.activeVoice.roomId !== roomId
          || connection.activeVoice.peerId !== peerId
        )
      ) {
        await leaveVoiceRoom(connection, connection.activeVoice, { cancelPendingJoin: false });
      }

      if (
        !isCurrentConnectionVoiceJoin(connection, connectionJoinIntent)
        || joinState.latestAuthorized !== joinRequestSequence
      ) {
        return supersededVoiceJoin(connection, roomId);
      }

      // Re-read after every asynchronous authorization step. Concurrent joins for
      // the same peer must replace the latest live transport, not a stale snapshot.
      const previous = room.peers.get(peerId);
      if (previous && !tokensMatch(previous.sessionToken, sessionToken)) {
        return { ok: false, code: 'invalid_session', message: 'Invalid peer session' };
      }
      const reconnecting = Boolean(previous);

      if (!reconnecting && room.peers.size >= MAX_ROOM_PEERS) {
        wsRegistry.sendToConnection(
          connection,
          buildServerEnvelope('room.full', { roomId, maxRoomPeers: MAX_ROOM_PEERS })
        );
        return { ok: false, code: 'room_full' };
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
        avatarAccent: sessionUser?.avatarAccent || null,
        avatarColorKey,
        avatarUrl: sessionUser?.avatarKey
          ? `/api/avatars/${encodeURIComponent(sessionUser.avatarKey)}`
          : null,
        id: peerId,
        ip: clientIp || '',
        joinedAt: previous?.joinedAt ?? Date.now(),
        muted: previous?.muted ?? false,
        name: reconnecting && !sessionUser ? (previous?.name ?? name) : name,
        screen: previous?.screen ?? false,
        screenAudio: previous?.screenAudio ?? false,
        screenProfileId: previous?.screenProfileId ?? '',
        screenStreamId: previous?.screenStreamId ?? '',
        viewedScreenPeerId: previous?.viewedScreenPeerId ?? '',
        sessionToken,
        transport
      };
      const reconnectProfileChanged = Boolean(
        previous
        && sessionUser
        && (
          previous.accountUserId !== peer.accountUserId
          || previous.avatarAccent !== peer.avatarAccent
          || previous.avatarColorKey !== peer.avatarColorKey
          || previous.avatarUrl !== peer.avatarUrl
          || previous.name !== peer.name
        )
      );
      room.peers.set(peerId, peer);
      room.updatedAt = peer.joinedAt;
      // In-memory call clock on the presence record (room here is the DB room
      // with attached peers): starts with the first live peer, cleared when the
      // room empties (closePeer). Deliberately never persisted to the database.
      const presence = presenceRooms.get(roomId);
      if (presence && !presence.voiceActiveSince) presence.voiceActiveSince = Date.now();

      if (!reconnecting) {
        // Announce synchronously with the initial insert. A reconnect may replace
        // this transport while occupancy persistence is pending; deferring the
        // announcement until afterward could leave a real peer undiscoverable.
        invalidateRecipientCache(roomId);
        broadcast(room, { type: 'peer-joined', peer: publicPeer(peer) }, peerId);
        mirrorLegacyRoomEvent(roomId, { type: 'peer-joined', peer: publicPeer(peer) });
        scheduleSummaryBroadcast(roomId);
      } else if (reconnectProfileChanged) {
        invalidateRecipientCache(roomId);
        broadcast(room, { type: 'peer-updated', peer: publicPeer(peer) });
        mirrorLegacyRoomEvent(roomId, { type: 'peer-updated', peer: publicPeer(peer) });
        scheduleSummaryBroadcast(roomId);
      }

      await queueRoomOccupancyTransition(roomId);

      if (
        !isCurrentConnectionVoiceJoin(connection, connectionJoinIntent)
        || room.peers.get(peerId)?.transport?.id !== transport.id
      ) {
        return supersededVoiceJoin(connection, roomId, transport.id);
      }

      const snapshot = await buildRoomSnapshot(roomId, 'active');
      if (
        !isCurrentConnectionVoiceJoin(connection, connectionJoinIntent)
        || room.peers.get(peerId)?.transport?.id !== transport.id
      ) {
        return supersededVoiceJoin(connection, roomId, transport.id);
      }
      if (snapshot) {
        wsRegistry.sendToConnection(connection, buildServerEnvelope('room.snapshot', snapshot));
      }

      return { ok: true, reconnecting };
    } finally {
      finishConnectionVoiceJoin(connection, connectionJoinIntent);
      finishVoiceJoin(joinKey, joinState);
    }
  }

  async function leaveVoiceRoom(
    connection,
    payload = connection.activeVoice,
    { cancelPendingJoin = true } = {}
  ) {
    if (cancelPendingJoin) cancelConnectionVoiceJoin(connection, payload);
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
      if (!connection.previewRoomIds.has(payload.roomId)) wsRegistry.unregisterConnectionForRoom(connection, payload.roomId);
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
    if (
      connection.activeVoice?.roomId !== roomId
      || connection.activeVoice?.peerId !== peerId
      || connection.activeVoice?.transportId !== peer.transport?.id
    ) {
      return { ok: false, code: 'not_active_peer' };
    }

    const stoppedScreen = Object.hasOwn(patch, 'screen') && peer.screen && !Boolean(patch.screen);

    if (Object.hasOwn(patch, 'name') && !peer.accountUserId) peer.name = cleanName(patch.name);
    if (Object.hasOwn(patch, 'muted')) peer.muted = Boolean(patch.muted);
    if (Object.hasOwn(patch, 'deafened')) peer.deafened = Boolean(patch.deafened);
    if (Object.hasOwn(patch, 'screen')) peer.screen = Boolean(patch.screen);
    if (Object.hasOwn(patch, 'screenAudio')) peer.screenAudio = Boolean(patch.screenAudio);
    if (Object.hasOwn(patch, 'screenProfileId')) peer.screenProfileId = cleanScreenProfileId(patch.screenProfileId);
    if (Object.hasOwn(patch, 'screenStreamId')) peer.screenStreamId = cleanStreamId(patch.screenStreamId);
    if (Object.hasOwn(patch, 'viewedScreenPeerId')) {
      peer.viewedScreenPeerId = resolveViewedScreenPeerId(room, peer.id, patch.viewedScreenPeerId);
    }

    if (stoppedScreen) {
      for (const viewer of clearViewedScreenPeerReferences(room, peer.id)) {
        broadcast(room, { type: 'peer-updated', peer: publicPeer(viewer) });
        mirrorLegacyRoomEvent(roomId, { type: 'peer-updated', peer: publicPeer(viewer) });
      }
    }

    broadcast(room, { type: 'peer-updated', peer: publicPeer(peer) });
    mirrorLegacyRoomEvent(roomId, { type: 'peer-updated', peer: publicPeer(peer) });
    scheduleSummaryBroadcast(roomId);
    return { ok: true, peer: publicPeer(peer) };
  }

  // Push current summaries for every room visible to the account over one
  // connection. Runs right after `ready` so the lobby renders live rosters on
  // first load and resyncs after a reconnect (including clearing stale ones —
  // empty rooms are sent too).
  async function sendAccountSummaries(connection, userId) {
    if (!userId) return;
    let rooms = [];
    try {
      rooms = await getRoomStore().listVisibleRoomsForUser(userId);
    } catch (error) {
      console.error('Failed to list rooms for WS ready summaries:', error);
      return;
    }
    for (const dbRoom of rooms) {
      const presence = presenceRooms.get(dbRoom.id);
      const peers = presence ? Array.from(presence.peers.values()).map(publicPeer) : [];
      const unreadCount = Number.isFinite(dbRoom.unreadCount)
        ? dbRoom.unreadCount
        : await resolveRoomUnreadCount(dbRoom.id, userId);
      const summary = buildRoomRealtimeSummaryFromLobbyRoom(
        publicLobbyRoom({ ...dbRoom, unreadCount }),
        peers,
        avatarColorForPeerId
      );
      wsRegistry.sendToConnection(connection, buildServerEnvelope('room.summary', { room: summary }));
    }
  }

  function cleanupConnection(connection) {
    cancelConnectionVoiceJoin(connection);
    if (connection.activeVoice) {
      void leaveVoiceRoom(connection, connection.activeVoice, { cancelPendingJoin: false });
    }
    wsRegistry.unregisterConnectionFromAllRooms(connection);
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
    sendRoomSummaryToUser,
    sendAccountSummaries,
    subscribePreview,
    unsubscribePreview,
    updatePeerState
  };
}

module.exports = {
  clearViewedScreenPeerReferences,
  createRoomRealtimeRuntime,
  resolveViewedScreenPeerId
};
