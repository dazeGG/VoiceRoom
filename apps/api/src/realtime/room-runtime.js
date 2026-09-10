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
    findRoomBan = async () => null,
    credentialBoundary = null,
    removeLiveKitParticipant = async () => {},
    now = Date.now,
    setTimeout: scheduleTimeout = globalThis.setTimeout,
    clearTimeout: cancelTimeout = globalThis.clearTimeout,
    reconnectLeaseMs = 30000
  } = deps;

  const recipientCache = new Map();
  const voiceJoinStates = new Map();
  const reconnectLeases = new Map();
  const leaseDurationMs = Number.isInteger(reconnectLeaseMs)
    && reconnectLeaseMs >= 1000
    && reconnectLeaseMs <= 120000
    ? reconnectLeaseMs
    : 30000;
  let voiceJoinRequestSequence = 0;
  let reconnectLeaseGeneration = 0;

  function reconnectLeaseKey(roomId, peerId, sessionToken) {
    return `${roomId}\u0000${peerId}\u0000${sessionToken}`;
  }

  function currentLeasePeer(record) {
    const peer = presenceRooms.get(record.roomId)?.peers?.get(record.peerId);
    if (
      !peer
      || !tokensMatch(peer.sessionToken, record.sessionToken)
      || peer.transport?.id !== record.transportId
    ) {
      return null;
    }
    return peer;
  }

  async function defaultFinalizeLeasePeer({ record, peer, reason }) {
    if (credentialBoundary?.revokePeer) {
      await credentialBoundary.revokePeer({
        roomId: record.roomId,
        accountUserId: peer.accountUserId || null,
        guestPrincipalId: peer.gateGuestPrincipalId || ''
      });
    } else if (typeof getRoomStore().revokeLiveKitGatePeer === 'function') {
      await getRoomStore().revokeLiveKitGatePeer({
        roomId: record.roomId,
        peerId: record.peerId,
        accountUserId: peer.accountUserId || null,
        guestPrincipalId: peer.gateGuestPrincipalId || '',
        now: now()
      });
    }

    closePeer(record.roomId, record.peerId, record.transportId, reason);
    try {
      await removeLiveKitParticipant(record.roomId, record.peerId);
    } catch (error) {
      error.ownershipFinalized = true;
      throw error;
    }
    scheduleSummaryBroadcast(record.roomId);
    return { finalized: true };
  }

  function scheduleLeaseExpiry(record) {
    const delay = Math.max(0, record.deadline - now());
    record.timer = scheduleTimeout(() => {
      if (reconnectLeases.get(record.key) !== record || record.state !== 'pending') return;
      // This CAS must happen before the asynchronous credential/transport cleanup.
      record.state = 'finalizing-expiry';
      record.timer = null;
      startLeaseFinalizer(record, 'lost');
    }, delay);
    record.timer?.unref?.();
  }

  async function runLeaseFinalizer(record, reason, finalizePeer) {
    if (finalizePeer && !record.finalizeCallbacks.includes(finalizePeer)) {
      record.finalizeCallbacks.push(finalizePeer);
    }
    if (record.finalizerPromise) return record.finalizerPromise;

    record.finalizerPromise = (async () => {
      let ownershipFinalized = false;
      let failure = null;
      const ownedPeer = currentLeasePeer(record);
      if (ownedPeer) {
        try {
          const primaryCallback = record.terminalReason ? record.finalizeCallbacks.shift() : null;
          if (primaryCallback) {
            const result = await primaryCallback({
              roomId: record.roomId,
              peerId: record.peerId,
              peer: record.peer,
              reason: record.terminalReason,
              ownershipFinalized: false
            });
            ownershipFinalized = result?.finalized !== false;
          } else {
            await defaultFinalizeLeasePeer({ record, peer: ownedPeer, reason });
            ownershipFinalized = true;
          }
        } catch (error) {
          failure = error;
          ownershipFinalized = error?.ownershipFinalized === true;
        }
      }

      for (let index = 0; index < record.finalizeCallbacks.length; index += 1) {
        const callback = record.finalizeCallbacks[index];
        try {
          const result = await callback({
            roomId: record.roomId,
            peerId: record.peerId,
            peer: record.peer,
            reason: record.terminalReason || reason,
            ownershipFinalized
          });
          if (!ownershipFinalized) ownershipFinalized = result?.finalized !== false;
        } catch (error) {
          failure ||= error;
          if (!ownershipFinalized) ownershipFinalized = error?.ownershipFinalized === true;
        }
      }

      if (failure?.rollbackTerminal === true && !ownershipFinalized) {
        record.terminalReason = '';
        record.terminalAtJoinSequence = 0;
        record.finalizeCallbacks.length = 0;
        record.finalizerErrorCode = '';
        if (record.disconnected && now() < record.deadline && currentLeasePeer(record)) {
          record.state = 'pending';
          record.finalizerPromise = null;
          scheduleLeaseExpiry(record);
        } else if (reconnectLeases.get(record.key) === record) {
          reconnectLeases.delete(record.key);
        }
      } else if (failure && !ownershipFinalized) {
        record.state = record.terminalReason ? 'terminal-finalizer-failed' : 'finalizer-failed';
        record.finalizerErrorCode = failure?.code || 'reconnect_finalize_failed';
      } else if (record.terminalReason) {
        record.state = 'terminal';
        record.timer = scheduleTimeout(() => {
          if (reconnectLeases.get(record.key) === record && record.state === 'terminal') {
            reconnectLeases.delete(record.key);
          }
        }, leaseDurationMs);
        record.timer?.unref?.();
      } else if (reconnectLeases.get(record.key) === record) {
        reconnectLeases.delete(record.key);
      }
      if (failure) throw failure;
      return { ok: true, finalized: ownershipFinalized };
    })();
    return record.finalizerPromise;
  }

  function startLeaseFinalizer(record, reason) {
    void runLeaseFinalizer(record, reason, null).catch(() => {
      // The record remains in a typed failed-finalizer state. Replacement and
      // terminal paths must explicitly retry/adopt it before admission proceeds.
    });
  }

  async function retryFailedLeaseFinalizer(record, reason = 'lost') {
    if (record.state !== 'finalizer-failed' && record.state !== 'terminal-finalizer-failed') {
      return record.finalizerPromise;
    }
    record.state = record.terminalReason ? 'terminal-finalizing' : 'finalizing-expiry';
    record.finalizerPromise = null;
    record.finalizerErrorCode = '';
    return runLeaseFinalizer(record, record.terminalReason || reason, null);
  }

  function createReconnectLease(activeVoice) {
    const room = presenceRooms.get(activeVoice.roomId);
    const peer = room?.peers?.get(activeVoice.peerId);
    if (
      !peer
      || peer.transport?.id !== activeVoice.transportId
      || !tokensMatch(peer.sessionToken, activeVoice.sessionToken)
    ) {
      return null;
    }

    const key = reconnectLeaseKey(activeVoice.roomId, activeVoice.peerId, activeVoice.sessionToken);
    const existing = reconnectLeases.get(key);
    if (existing && existing.transportId === activeVoice.transportId) {
      return existing;
    }
    if (existing?.timer) cancelTimeout(existing.timer);

    const record = {
      key,
      roomId: activeVoice.roomId,
      peerId: activeVoice.peerId,
      sessionToken: activeVoice.sessionToken,
      transportId: activeVoice.transportId,
      generation: ++reconnectLeaseGeneration,
      deadline: now() + leaseDurationMs,
      state: 'pending',
      timer: null,
      finalizerPromise: null,
      finalizeCallbacks: [],
      terminalReason: '',
      terminalAtJoinSequence: 0,
      claimRequestSequence: 0,
      finalizerErrorCode: '',
      disconnected: false,
      peer
    };
    reconnectLeases.set(key, record);
    scheduleLeaseExpiry(record);
    return record;
  }

  function claimReconnectLease(roomId, peerId, sessionToken, joinRequestSequence) {
    const record = reconnectLeases.get(reconnectLeaseKey(roomId, peerId, sessionToken));
    if (!record) return { state: 'none', record: null };
    if (record.state === 'pending') {
      record.state = 'claimed-by-replacement';
      if (record.timer) cancelTimeout(record.timer);
      record.timer = null;
      record.claimRequestSequence = joinRequestSequence;
      return { state: 'claimed', record };
    }
    if (record.state === 'finalizing-expiry' || record.state === 'terminal-finalizing') {
      return { state: 'finalizing', record };
    }
    if (record.state === 'claimed-by-replacement') return { state: 'busy', record };
    if (record.state === 'finalizer-failed' || record.state === 'terminal-finalizer-failed') {
      return { state: 'failed-finalizer', record };
    }
    if (record.state === 'terminal') {
      const permitsNewJoinIntent = record.terminalReason === 'left';
      if (permitsNewJoinIntent && joinRequestSequence > record.terminalAtJoinSequence) {
        if (record.timer) cancelTimeout(record.timer);
        reconnectLeases.delete(record.key);
        return { state: 'none', record: null };
      }
      return { state: 'terminal', record };
    }
    return { state: record.state, record };
  }

  function restoreClaimedLease(record) {
    if (
      reconnectLeases.get(record.key) !== record
      || record.state !== 'claimed-by-replacement'
      || now() >= record.deadline
      || !currentLeasePeer(record)
    ) {
      if (record.state === 'claimed-by-replacement') {
        record.state = 'finalizing-expiry';
        startLeaseFinalizer(record, 'lost');
      }
      return false;
    }
    record.state = 'pending';
    scheduleLeaseExpiry(record);
    return true;
  }

  function completeClaimedLease(record, transportId) {
    if (reconnectLeases.get(record.key) !== record || record.state !== 'claimed-by-replacement') return false;
    record.transportId = transportId;
    reconnectLeases.delete(record.key);
    return true;
  }

  function terminalClaimRecord(record, reason, finalizePeer) {
    const adoptingFailedFinalizer = record.state === 'finalizer-failed'
      || record.state === 'terminal-finalizer-failed';
    record.terminalReason ||= reason;
    if (record.timer) cancelTimeout(record.timer);
    record.timer = null;
    record.terminalAtJoinSequence ||= voiceJoinRequestSequence;
    if (finalizePeer && !record.finalizeCallbacks.includes(finalizePeer)) {
      record.finalizeCallbacks.push(finalizePeer);
    }
    if (adoptingFailedFinalizer) {
      // The rejected promise belongs to the previous attempt. Clear it before
      // the terminal caller queues its retry so its callback cannot be skipped.
      record.finalizerPromise = null;
      record.finalizerErrorCode = '';
    }
    if (record.state !== 'finalizing-expiry') record.state = 'terminal-finalizing';
    return record;
  }

  function recordsForPeer(roomId, peerId, { expectedSessionToken = '', expectedTransportId = '' } = {}) {
    const peer = presenceRooms.get(roomId)?.peers?.get(peerId) || null;
    if (
      peer
      && (
        (expectedSessionToken && !tokensMatch(peer.sessionToken, expectedSessionToken))
        || (expectedTransportId && peer.transport?.id !== expectedTransportId)
      )
    ) {
      return [];
    }
    let records = [...reconnectLeases.values()].filter((record) =>
      record.roomId === roomId
      && record.peerId === peerId
      && record.state !== 'terminal'
      && (!peer || (
        tokensMatch(record.sessionToken, peer.sessionToken)
        && record.transportId === peer.transport?.id
      ))
    );
    if (peer && records.length === 0) {
      const record = createReconnectLease({
        roomId,
        peerId,
        sessionToken: peer.sessionToken,
        transportId: peer.transport?.id
      });
      if (record) records.push(record);
    }
    return records;
  }

  async function settleLeaseFinalizers(records, reason) {
    const settled = await Promise.allSettled(
      records.map((record) => runLeaseFinalizer(record, reason, null))
    );
    const rejected = settled.find((result) => result.status === 'rejected');
    if (rejected) throw rejected.reason;
    return settled.map((result) => result.value);
  }

  async function finalizeReconnectLease({
    roomId,
    peerId,
    reason = 'left',
    finalizePeer = null,
    expectedSessionToken = '',
    expectedTransportId = ''
  } = {}) {
    const records = recordsForPeer(roomId, peerId, { expectedSessionToken, expectedTransportId });
    // Claim every matching generation synchronously before the first await.
    for (const record of records) terminalClaimRecord(record, reason, finalizePeer);
    const results = await settleLeaseFinalizers(records, reason);
    return { ok: true, finalized: results.some((result) => result.finalized) };
  }

  async function finalizePendingReconnectLease({
    roomId,
    peerId,
    sessionToken,
    reason = 'left'
  } = {}) {
    const normalizedRoomId = normalizeRoomId(roomId);
    const normalizedPeerId = normalizePeerId(peerId);
    const normalizedSessionToken = normalizeSessionToken(sessionToken);
    if (!normalizedRoomId || !normalizedPeerId || !normalizedSessionToken) {
      return { ok: false, finalized: false, code: 'invalid_session' };
    }

    const record = reconnectLeases.get(
      reconnectLeaseKey(normalizedRoomId, normalizedPeerId, normalizedSessionToken)
    );
    // A leave replayed by a fresh application socket may only terminate the
    // disconnected transport's existing lease. Never synthesize a lease here:
    // doing so would let a delayed leave tear down a newer active replacement.
    if (
      !record
      || !record.disconnected
      || !['pending', 'finalizer-failed', 'terminal-finalizer-failed'].includes(record.state)
    ) {
      return { ok: true, finalized: false };
    }

    terminalClaimRecord(record, reason, null);
    const [result] = await settleLeaseFinalizers([record], reason);
    return { ok: true, finalized: Boolean(result?.finalized) };
  }

  async function cancelRoomReconnectLeases({ roomId, reason = 'deleted', finalizePeer = null } = {}) {
    const peerIds = new Set([
      ...[...reconnectLeases.values()].filter((record) => record.roomId === roomId).map((record) => record.peerId),
      ...[...(presenceRooms.get(roomId)?.peers?.keys?.() || [])]
    ]);
    const records = [...peerIds].flatMap((peerId) => recordsForPeer(roomId, peerId));
    for (const record of records) terminalClaimRecord(record, reason, finalizePeer);
    const results = await settleLeaseFinalizers(records, reason);
    return { ok: true, finalized: results.filter((result) => result.finalized).length };
  }

  async function cancelAccountReconnectLeases({ roomId, userId, reason = 'membership-left', finalizePeer = null } = {}) {
    const peerIds = new Set();
    for (const record of reconnectLeases.values()) {
      if (record.roomId === roomId && record.peer?.accountUserId === userId) peerIds.add(record.peerId);
    }
    for (const peer of presenceRooms.get(roomId)?.peers?.values?.() || []) {
      if (peer.accountUserId === userId) peerIds.add(peer.id);
    }
    const records = [...peerIds].flatMap((peerId) => recordsForPeer(roomId, peerId));
    for (const record of records) terminalClaimRecord(record, reason, finalizePeer);
    const results = await settleLeaseFinalizers(records, reason);
    return { ok: true, finalized: results.filter((result) => result.finalized).length };
  }

  async function finalizeReconnectPeers({ roomId, peerIds = [], reason, finalizePeer } = {}) {
    const records = [...new Set(peerIds)].flatMap((peerId) => recordsForPeer(roomId, peerId));
    for (const record of records) terminalClaimRecord(record, reason, finalizePeer);
    const results = await settleLeaseFinalizers(records, reason);
    return { ok: true, finalized: results.filter((result) => result.finalized).length };
  }

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

  // Moderator mutes are stored per gate principal. A lookup failure must block
  // admission: treating an unavailable authority as "not muted" would let a
  // participant bypass moderation simply by reconnecting during a DB outage.
  async function loadServerMute(roomId, peer) {
    const store = getRoomStore();
    if (typeof store?.isRoomServerMuted !== 'function' || typeof store?.normalizeGatePrincipal !== 'function') {
      const error = new Error('Server mute authority is unavailable');
      error.code = 'server_mute_unavailable';
      throw error;
    }
    const principal = store.normalizeGatePrincipal({
      accountUserId: peer.accountUserId || null,
      guestPrincipalId: peer.gateGuestPrincipalId || '',
      roomId
    });
    if (!principal) return false;
    return store.isRoomServerMuted({ roomId, principal });
  }

  async function joinVoiceRoom(connection, payload, sessionUser, clientIp = '', requestId = '') {
    const joinRequestSequence = ++voiceJoinRequestSequence;
    const roomId = normalizeRoomId(payload.roomId);
    const peerId = normalizePeerId(payload.peerId);
    const sessionToken = normalizeSessionToken(payload.sessionToken);
    const name = cleanName(sessionUser?.displayName || sessionUser?.login || payload.name);

    if (!roomId || !peerId || !sessionToken) {
      return { ok: false, code: 'invalid_join', message: 'Invalid room, peer, or session token' };
    }

    const currentPeer = presenceRooms.get(roomId)?.peers?.get(peerId);
    if (currentPeer && !tokensMatch(currentPeer.sessionToken, sessionToken)) {
      return { ok: false, code: 'invalid_session', message: 'Invalid peer session' };
    }
    let leaseClaim = claimReconnectLease(roomId, peerId, sessionToken, joinRequestSequence);
    if (leaseClaim.state === 'busy') {
      return { ok: false, code: 'superseded_join', message: 'Another replacement already owns recovery' };
    }
    if (leaseClaim.state === 'failed-finalizer') {
      try {
        await retryFailedLeaseFinalizer(leaseClaim.record);
      } catch {
        return { ok: false, code: 'reconnect_finalize_failed', message: 'Previous transport cleanup is incomplete' };
      }
      leaseClaim = claimReconnectLease(roomId, peerId, sessionToken, joinRequestSequence);
    }
    if (leaseClaim.state === 'terminal') {
      return { ok: false, code: 'superseded_join', message: 'Peer session was terminated' };
    }
    if (leaseClaim.state === 'finalizing') {
      try {
        await leaseClaim.record.finalizerPromise;
      } catch {
        return { ok: false, code: 'reconnect_finalize_failed', message: 'Previous transport cleanup is incomplete' };
      }
      leaseClaim = claimReconnectLease(roomId, peerId, sessionToken, joinRequestSequence);
      if (leaseClaim.state === 'terminal') {
        return { ok: false, code: 'superseded_join', message: 'Peer session was terminated' };
      }
      if (leaseClaim.state !== 'none') {
        return { ok: false, code: 'reconnect_finalize_failed', message: 'Previous transport cleanup is incomplete' };
      }
    }

    const joinKey = `${roomId}:${peerId}`;
    const joinState = beginVoiceJoin(joinKey);
    const connectionJoinIntent = beginConnectionVoiceJoin(connection, roomId, peerId);
    let claimCompleted = false;
    let terminalClaimFailure = false;
    const claimedSessionWasTerminated = () => leaseClaim.state === 'claimed'
      && (
        reconnectLeases.get(leaseClaim.record.key) !== leaseClaim.record
        || leaseClaim.record.state !== 'claimed-by-replacement'
      );
    try {
      // Register the request before the first await. Otherwise an older join
      // delayed in room/ban lookup could start a fresh generation after a newer
      // request has already completed and incorrectly replace it.
      const room = await getRoom(roomId);
      if (claimedSessionWasTerminated()) {
        return { ok: false, code: 'superseded_join', message: 'Peer session was terminated' };
      }
      if (!isCurrentConnectionVoiceJoin(connection, connectionJoinIntent)) {
        return supersededVoiceJoin(connection, roomId);
      }
      if (!room) {
        terminalClaimFailure = true;
        wsRegistry.sendToConnection(connection, buildServerEnvelope('room.not_found', { roomId }));
        return { ok: false, code: 'room_not_found' };
      }

      const roomBan = await findRoomBan(roomId, sessionUser?.id, clientIp);
      if (claimedSessionWasTerminated()) {
        return { ok: false, code: 'superseded_join', message: 'Peer session was terminated' };
      }
      if (!isCurrentConnectionVoiceJoin(connection, connectionJoinIntent)) {
        return supersededVoiceJoin(connection, roomId);
      }
      if (roomBan) {
        terminalClaimFailure = true;
        return { ok: false, code: 'room_banned', message: 'Вы заблокированы в этой комнате' };
      }

      const initialPeer = room.peers.get(peerId);
      if (initialPeer && !tokensMatch(initialPeer.sessionToken, sessionToken)) {
        terminalClaimFailure = true;
        return { ok: false, code: 'invalid_session', message: 'Invalid peer session' };
      }

      const identityResult = await getRoomStore().getOrCreatePeerIdentity({
        roomId,
        peerId,
        sessionToken,
        displayName: name,
        avatarColorKey: sessionAvatarColorKey(sessionUser)
      });
      if (claimedSessionWasTerminated()) {
        return { ok: false, code: 'superseded_join', message: 'Peer session was terminated' };
      }
      if (!isCurrentConnectionVoiceJoin(connection, connectionJoinIntent)) {
        return supersededVoiceJoin(connection, roomId);
      }
      if (identityResult.status === 'token_mismatch') {
        terminalClaimFailure = true;
        return { ok: false, code: 'invalid_session', message: 'Invalid peer session' };
      }
      const avatarColorKey = identityResult.identity?.avatarColorKey || avatarColorForPeerId(peerId);
      let persistedServerMuted;
      try {
        persistedServerMuted = await loadServerMute(roomId, {
          accountUserId: sessionUser?.id || '',
          gateGuestPrincipalId: identityResult.identity?.id || ''
        });
      } catch {
        terminalClaimFailure = true;
        return {
          ok: false,
          code: 'server_mute_unavailable',
          message: 'Не удалось проверить ограничения микрофона. Попробуйте ещё раз.'
        };
      }
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
        || claimedSessionWasTerminated()
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
        gateGuestPrincipalId: identityResult.identity?.id || '',
        ip: clientIp || '',
        joinedAt: previous?.joinedAt ?? Date.now(),
        muted: Boolean(previous?.muted || persistedServerMuted),
        name: reconnecting && !sessionUser ? (previous?.name ?? name) : name,
        screen: previous?.screen ?? false,
        screenAudio: previous?.screenAudio ?? false,
        screenProfileId: previous?.screenProfileId ?? '',
        screenStreamId: previous?.screenStreamId ?? '',
        serverMuted: Boolean(previous?.serverMuted || persistedServerMuted),
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
      if (leaseClaim.state === 'claimed') {
        claimCompleted = completeClaimedLease(leaseClaim.record, transport.id);
      }
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

      try {
        await queueRoomOccupancyTransition(roomId);
      } catch (error) {
        // Presence was already committed in memory. Keep the resync protocol
        // live by delivering the authoritative snapshot even when the
        // best-effort occupancy marker cannot be persisted.
        console.error('Failed to persist room occupancy:', error);
      }

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
        wsRegistry.sendToConnection(connection, buildServerEnvelope('room.snapshot', snapshot, requestId));
      }

      return { ok: true, reconnecting };
    } finally {
      if (leaseClaim.state === 'claimed' && !claimCompleted) {
        if (terminalClaimFailure) {
          leaseClaim.record.terminalReason ||= 'join-rejected';
          leaseClaim.record.state = 'terminal-finalizing';
          startLeaseFinalizer(leaseClaim.record, leaseClaim.record.terminalReason);
        } else {
          restoreClaimedLease(leaseClaim.record);
        }
      }
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
    const activeVoice = connection.activeVoice;
    const sessionToken = normalizeSessionToken(payload.sessionToken || activeVoice?.sessionToken);
    const ownsRequestedPeer = activeVoice?.roomId === payload.roomId
      && activeVoice?.peerId === payload.peerId
      && tokensMatch(activeVoice.sessionToken, sessionToken);
    const peer = presenceRooms.get(payload.roomId)?.peers?.get(payload.peerId);
    const ownsCurrentGeneration = ownsRequestedPeer
      && peer
      && tokensMatch(peer.sessionToken, sessionToken)
      && peer.transport?.id === activeVoice.transportId;
    if (ownsCurrentGeneration) {
      await finalizeReconnectLease({
        roomId: payload.roomId,
        peerId: payload.peerId,
        reason: 'left',
        expectedSessionToken: sessionToken,
        expectedTransportId: activeVoice.transportId
      });
    } else if (sessionToken) {
      await finalizePendingReconnectLease({
        roomId: payload.roomId,
        peerId: payload.peerId,
        sessionToken,
        reason: 'left'
      });
    }
    if (connection.activeVoice?.roomId === payload.roomId && connection.activeVoice?.peerId === payload.peerId) {
      connection.activeVoice = null;
      if (!connection.previewRoomIds.has(payload.roomId)) wsRegistry.unregisterConnectionForRoom(connection, payload.roomId);
    }
    scheduleSummaryBroadcast(payload.roomId);
  }

  async function disconnectAccountFromRoom({ roomId, userId, reason = 'left-room' } = {}) {
    if (!roomId || !userId || !credentialBoundary?.resolvePrincipal || !credentialBoundary?.revokePrincipal) {
      return { ok: false, code: 'credential_boundary_unavailable', disconnected: 0 };
    }
    const principal = credentialBoundary.resolvePrincipal({ roomId, accountUserId: userId });
    if (!principal) return { ok: false, code: 'principal_unavailable', disconnected: 0 };
    const room = presenceRooms.get(roomId);
    const peers = [...(room?.peers?.values?.() || [])].filter((peer) => peer.accountUserId === userId);
    let principalRevocationPromise = null;
    const revokePrincipalOnce = () => {
      principalRevocationPromise ||= credentialBoundary.revokePrincipal({ roomId, principal });
      return principalRevocationPromise;
    };
    try {
      await cancelAccountReconnectLeases({
        roomId,
        userId,
        reason,
        finalizePeer: async ({ peer, ownershipFinalized }) => {
          if (!peer) return;
          const revoked = await revokePrincipalOnce();
          if (revoked?.status !== 'revoked') {
            const error = new Error(revoked?.status || 'revoke_failed');
            error.code = revoked?.status || 'revoke_failed';
            throw error;
          }
          if (!ownershipFinalized) closePeer(roomId, peer.id, peer.transport?.id, reason);
          if (!ownershipFinalized) await removeLiveKitParticipant(roomId, peer.id);
        }
      });
    } catch (error) {
      return { ok: false, code: error?.code || 'finalize_failed', disconnected: 0 };
    }

    if (peers.length === 0) {
      const revoked = await revokePrincipalOnce();
      if (revoked?.status !== 'revoked') return { ok: false, code: revoked?.status || 'revoke_failed', disconnected: 0 };
    }

    for (const peer of peers) {
      const event = { type: 'room.left', roomId, peerId: peer.id, reason };
      peer.transport?.send?.(event);
      wsRegistry.sendToUser(userId, buildServerEnvelope('room.left', { roomId, peerId: peer.id, reason }));
      for (const connection of wsRegistry.connections?.values?.() || []) {
        if (connection.activeVoice?.roomId !== roomId || connection.activeVoice?.peerId !== peer.id) continue;
        connection.activeVoice = null;
        connection.previewRoomIds.delete(roomId);
        wsRegistry.unregisterConnectionForRoom(connection, roomId);
      }
    }
    scheduleSummaryBroadcast(roomId);
    return { ok: true, disconnected: peers.length };
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
    // A moderator mute outranks the client: the participant may still mute
    // itself, but an unmute is dropped until the owner lifts the server mute.
    if (Object.hasOwn(patch, 'muted')) peer.muted = peer.serverMuted || Boolean(patch.muted);
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
      const activeVoice = connection.activeVoice;
      const lease = createReconnectLease(activeVoice);
      if (lease) {
        lease.disconnected = true;
        const peer = currentLeasePeer(lease);
        if (peer) {
          const capturedTransport = peer.transport;
          peer.transport = {
            id: capturedTransport.id,
            send: () => true,
            close: () => capturedTransport.close?.()
          };
          lease.peer = peer;
        }
      }
      connection.activeVoice = null;
    }
    wsRegistry.unregisterConnectionFromAllRooms(connection);
    connection.previewRoomIds.clear();
  }

  return {
    broadcastChatMessage,
    broadcastRoomDetail,
    buildRoomSnapshot,
    cancelAccountReconnectLeases,
    cancelRoomReconnectLeases,
    cleanupConnection,
    disconnectAccountFromRoom,
    finalizeReconnectLease,
    finalizePendingReconnectLease,
    finalizeReconnectPeers,
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
