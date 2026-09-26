import type { StoredRoom } from '../domains/rooms/room-views.ts';
import type { RoomChatMessage } from '../domains/messaging/room-chat-views.ts';
import type { ClientCommands } from '@voice-room/shared/contracts/realtime';
import type { RoomMessage } from '@voice-room/shared/contracts/messages';
import type { LobbyRoom, PublicPeer } from '@voice-room/shared/contracts/rooms';
import {
  normalizeRoomId,
  normalizePeerId,
  normalizeSessionToken,
  cleanName,
  cleanStreamId,
  cleanScreenProfileId
} from '@voice-room/shared/validation';
import { buildServerEnvelope } from './envelope.ts';
import { buildRoomRealtimeSummaryFromLobbyRoom } from './summary.ts';
import { LOG_EVENTS } from '../lib/log-events.ts';
import { createLogger } from '../lib/logger.ts';
import { type RoomPeerMessage } from './legacy-events.ts';
import type { RoomSnapshot } from '@voice-room/shared/contracts/realtime';
import type { UserStore } from '../lib/user-store.ts';
import type { ConnectionRegistry, WsConnection } from './registry.ts';
import { createReconnectLeases } from './reconnect-leases.ts';
import { createRoomSummaries } from './room-summaries.ts';
import { createRoomFanout } from './room-fanout.ts';
import { createVoiceJoin } from './voice-join.ts';
import type {
  FinalizeError,
  LeaseRecord,
  Peer,
  PresenceRoom,
  RuntimeLogger,
  RuntimeRoomStore
} from './runtime-types.ts';
export type { RuntimeRoomStore } from './runtime-types.ts';

type SessionUser =
  | {
      id: string;
      displayName?: string;
      login?: string;
      avatarAccent?: string | null;
      avatarKey?: string | null;
      [key: string]: unknown;
    }
  | null
  | undefined;
type JoinResult = { ok: boolean; code?: string; message?: string; reconnecting?: boolean };
type GatePrincipal = { principalType: 'account' | 'guest'; principalId: string };
type RuntimeCredentialBoundary = {
  revokePeer?: (input: { roomId: string; accountUserId: string | null; guestPrincipalId: string }) => Promise<unknown>;
  resolvePrincipal?: (input: { roomId: string; accountUserId: string }) => GatePrincipal | null;
  revokePrincipal?: (input: {
    roomId: string;
    principal: GatePrincipal;
  }) => Promise<{ status?: string } | null | undefined>;
};
export type RoomRuntimeDeps = {
  presenceRooms: Map<string, PresenceRoom>;
  wsRegistry: ConnectionRegistry;
  getRoomStore: () => RuntimeRoomStore;
  getRoom: (roomId: string) => Promise<PresenceRoom | null>;
  publicPeer: (peer: Peer) => PublicPeer;
  publicLobbyRoom: (room: StoredRoom) => LobbyRoom;
  publicChatMessage: (message: RoomChatMessage) => RoomMessage;
  getUserStore?: (() => Pick<UserStore, 'getUserById'>) | null;
  broadcast: (room: PresenceRoom, message: RoomPeerMessage, exceptPeerId?: string) => void;
  closePeer: (roomId: string, peerId: string, transportId: string | undefined, reason: string) => void;
  avatarColorForPeerId: (peerId: unknown) => string;
  MAX_ROOM_PEERS: number;
  tokensMatch: (expected: string | null | undefined, actual: string | null | undefined) => boolean;
  sessionAvatarColorKey: (user: SessionUser) => string;
  queueRoomOccupancyTransition?: (roomId: string) => Promise<unknown>;
  findRoomBan?: (roomId: string, userId: string | null | undefined, ip: string) => Promise<unknown>;
  credentialBoundary?: RuntimeCredentialBoundary | null;
  removeLiveKitParticipant?: (roomId: string, peerId: string) => Promise<unknown>;
  now?: () => number;
  // Methods, so a test's timer may hand out its own handle type.
  setTimeout?(this: void, callback: () => void, ms: number): ReturnType<typeof globalThis.setTimeout> | number;
  clearTimeout?(this: void, timer: ReturnType<typeof globalThis.setTimeout> | number): void;
  reconnectLeaseMs?: number;
  logger?: RuntimeLogger;
};

function resolveViewedScreenPeerId(
  room: PresenceRoom | null | undefined,
  viewerPeerId: string,
  value: unknown
): string {
  const ownerPeerId = normalizePeerId(value);
  if (!ownerPeerId || ownerPeerId === viewerPeerId) return '';
  return room?.peers.get(ownerPeerId)?.screen ? ownerPeerId : '';
}

function clearViewedScreenPeerReferences(room: PresenceRoom | null | undefined, ownerPeerId: string): Peer[] {
  if (!room?.peers || !ownerPeerId) return [];
  const clearedViewers: Peer[] = [];
  for (const viewer of room.peers.values()) {
    if (viewer.viewedScreenPeerId !== ownerPeerId) continue;
    viewer.viewedScreenPeerId = '';
    clearedViewers.push(viewer);
  }
  return clearedViewers;
}

/** A room.peer.update command; the runtime normalizes every field itself. */
export type PeerUpdatePayload = Partial<ClientCommands['room.peer.update']>;

function createRoomRealtimeRuntime(deps: RoomRuntimeDeps) {
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
    queueRoomOccupancyTransition = async (roomId: string) => getRoomStore().markRoomActive(roomId),
    findRoomBan = async () => null,
    credentialBoundary = null,
    removeLiveKitParticipant = async () => {},
    now = Date.now,
    setTimeout: scheduleTimeout = globalThis.setTimeout,
    clearTimeout: cancelTimeout = globalThis.clearTimeout,
    reconnectLeaseMs = 30000,
    logger = createLogger({ name: 'api' })
  } = deps;

  const summaries = createRoomSummaries({
    presenceRooms,
    wsRegistry,
    getRoomStore,
    publicPeer,
    publicLobbyRoom,
    avatarColorForPeerId,
    logger
  });
  const fanout = createRoomFanout({
    presenceRooms,
    wsRegistry,
    getRoomStore,
    getUserStore,
    publicChatMessage,
    scheduleSummary: summaries.schedule,
    now,
    logger
  });
  const scheduleSummaryBroadcast = summaries.schedule;
  const leases = createReconnectLeases({
    presenceRooms,
    tokensMatch,
    now,
    setTimeout: scheduleTimeout,
    clearTimeout: cancelTimeout,
    leaseMs: reconnectLeaseMs,
    finalizeOwnedPeer: defaultFinalizeLeasePeer,
    joinSequence: () => voiceJoin.sequence()
  });

  const voiceJoin = createVoiceJoin({
    presenceRooms,
    wsRegistry,
    getRoomStore,
    getRoom,
    publicPeer,
    broadcast,
    closePeer,
    avatarColorForPeerId,
    MAX_ROOM_PEERS,
    tokensMatch,
    sessionAvatarColorKey,
    queueRoomOccupancyTransition,
    findRoomBan,
    logger,
    leases,
    summaries,
    fanout,
    buildRoomSnapshot: (roomId, mode) => buildRoomSnapshot(roomId, mode),
    leaveVoiceRoom: (connection, payload, options) => leaveVoiceRoom(connection, payload, options)
  });
  const { cancelConnectionVoiceJoin, joinVoiceRoom } = voiceJoin;

  async function defaultFinalizeLeasePeer({
    record,
    peer,
    reason
  }: {
    record: LeaseRecord;
    peer: Peer;
    reason: string;
  }): Promise<{ finalized: true }> {
    if (credentialBoundary?.revokePeer) {
      await credentialBoundary.revokePeer({
        roomId: record.roomId,
        accountUserId: peer.accountUserId || null,
        guestPrincipalId: peer.gateGuestPrincipalId || ''
      });
    } else if (typeof getRoomStore().revokeLiveKitGatePeer === 'function') {
      await getRoomStore().revokeLiveKitGatePeer!({
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
      (error as FinalizeError).ownershipFinalized = true;
      throw error;
    }
    scheduleSummaryBroadcast(record.roomId);
    return { finalized: true };
  }

  async function buildRoomSnapshot(
    roomId: string,
    mode: RoomSnapshot['mode'] = 'preview'
  ): Promise<RoomSnapshot | null> {
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

  async function subscribePreview(connection: WsConnection, roomId: string): Promise<void> {
    if (connection.closed) return;
    const roomBan = await findRoomBan(roomId, connection.userId, connection.clientIp || connection.guestIp || '');
    if (connection.closed) return;
    if (roomBan) {
      wsRegistry.sendToConnection(connection, buildServerEnvelope('room.banned', { roomId }));
      return;
    }
    connection.previewRoomIds.add(roomId);
    wsRegistry.registerConnectionForRoom(connection, roomId);
    let snapshot: Awaited<ReturnType<typeof buildRoomSnapshot>>;
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

  function unsubscribePreview(connection: WsConnection, roomId: string): void {
    connection.previewRoomIds.delete(roomId);
    if (connection.activeVoice?.roomId !== roomId) wsRegistry.unregisterConnectionForRoom(connection, roomId);
  }

  async function leaveVoiceRoom(
    connection: WsConnection,
    payload: { roomId?: string; peerId?: string; sessionToken?: string } | null = connection.activeVoice,
    { cancelPendingJoin = true }: { cancelPendingJoin?: boolean } = {}
  ): Promise<void> {
    if (cancelPendingJoin) cancelConnectionVoiceJoin(connection, payload);
    if (!payload?.roomId || !payload.peerId) return;
    const activeVoice = connection.activeVoice;
    const sessionToken = normalizeSessionToken(payload.sessionToken || activeVoice?.sessionToken);
    const ownsRequestedPeer =
      activeVoice?.roomId === payload.roomId &&
      activeVoice?.peerId === payload.peerId &&
      tokensMatch(activeVoice.sessionToken, sessionToken);
    const peer = presenceRooms.get(payload.roomId)?.peers?.get(payload.peerId);
    const ownsCurrentGeneration =
      ownsRequestedPeer &&
      peer &&
      tokensMatch(peer.sessionToken, sessionToken) &&
      peer.transport?.id === activeVoice.transportId;
    if (ownsCurrentGeneration) {
      await leases.finalize({
        roomId: payload.roomId,
        peerId: payload.peerId,
        reason: 'left',
        expectedSessionToken: sessionToken,
        expectedTransportId: activeVoice.transportId
      });
    } else if (sessionToken) {
      await leases.finalizePending({
        roomId: payload.roomId,
        peerId: payload.peerId,
        sessionToken,
        reason: 'left'
      });
    }
    if (connection.activeVoice?.roomId === payload.roomId && connection.activeVoice?.peerId === payload.peerId) {
      connection.activeVoice = null;
      if (!connection.previewRoomIds.has(payload.roomId))
        wsRegistry.unregisterConnectionForRoom(connection, payload.roomId);
    }
    scheduleSummaryBroadcast(payload.roomId);
  }

  async function disconnectAccountFromRoom({
    roomId,
    userId,
    reason = 'left-room'
  }: { roomId?: string; userId?: string; reason?: string } = {}) {
    if (!roomId || !userId || !credentialBoundary?.resolvePrincipal || !credentialBoundary?.revokePrincipal) {
      return { ok: false, code: 'credential_boundary_unavailable', disconnected: 0 };
    }
    const boundary = credentialBoundary as Required<RuntimeCredentialBoundary>;
    const principal = boundary.resolvePrincipal({ roomId, accountUserId: userId });
    if (!principal) return { ok: false, code: 'principal_unavailable', disconnected: 0 };
    const room = presenceRooms.get(roomId);
    const peers = [...(room?.peers?.values?.() || [])].filter((peer) => peer.accountUserId === userId);
    let principalRevocationPromise: ReturnType<Required<RuntimeCredentialBoundary>['revokePrincipal']> | null = null;
    const revokePrincipalOnce = () => {
      principalRevocationPromise ||= boundary.revokePrincipal({ roomId, principal });
      return principalRevocationPromise;
    };
    try {
      await leases.cancelAccount({
        roomId,
        userId,
        reason,
        finalizePeer: async ({ peer, ownershipFinalized }) => {
          if (!peer) return;
          const revoked = await revokePrincipalOnce();
          if (revoked?.status !== 'revoked') {
            const error = new Error(revoked?.status || 'revoke_failed') as FinalizeError;
            error.code = revoked?.status || 'revoke_failed';
            throw error;
          }
          if (!ownershipFinalized) closePeer(roomId, peer.id, peer.transport?.id, reason);
          if (!ownershipFinalized) await removeLiveKitParticipant(roomId, peer.id);
        }
      });
    } catch (error) {
      return { ok: false, code: (error as FinalizeError | null)?.code || 'finalize_failed', disconnected: 0 };
    }

    if (peers.length === 0) {
      const revoked = await revokePrincipalOnce();
      if (revoked?.status !== 'revoked')
        return { ok: false, code: revoked?.status || 'revoke_failed', disconnected: 0 };
    }

    for (const peer of peers) {
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

  async function updatePeerState(connection: WsConnection, payload: PeerUpdatePayload) {
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
      connection.activeVoice?.roomId !== roomId ||
      connection.activeVoice?.peerId !== peerId ||
      connection.activeVoice?.transportId !== peer.transport?.id
    ) {
      return { ok: false, code: 'not_active_peer' };
    }

    const stoppedScreen = Object.hasOwn(patch, 'screen') && peer.screen && !patch.screen;

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
        fanout.mirrorLegacyRoomEvent(roomId, { type: 'peer-updated', peer: publicPeer(viewer) });
      }
    }

    broadcast(room, { type: 'peer-updated', peer: publicPeer(peer) });
    fanout.mirrorLegacyRoomEvent(roomId, { type: 'peer-updated', peer: publicPeer(peer) });
    scheduleSummaryBroadcast(roomId);
    return { ok: true, peer: publicPeer(peer) };
  }

  // Push current summaries for every room visible to the account over one
  // connection. Runs right after `ready` so the lobby renders live rosters on
  // first load and resyncs after a reconnect (including clearing stale ones —
  // empty rooms are sent too).
  async function sendAccountSummaries(connection: WsConnection, userId: string): Promise<void> {
    if (!userId) return;
    let rooms: Awaited<ReturnType<RuntimeRoomStore['listVisibleRoomsForUser']>> = [];
    try {
      rooms = await getRoomStore().listVisibleRoomsForUser(userId);
    } catch (error) {
      logger.error(
        { evt: LOG_EVENTS.WS_SUMMARY_LOAD_FAILED, userId, err: error },
        'failed to list rooms for the ws ready summaries'
      );
      return;
    }
    for (const dbRoom of rooms) {
      const presence = presenceRooms.get(dbRoom.id);
      const peers = presence ? Array.from(presence.peers.values()).map(publicPeer) : [];
      const unreadCount = Number.isFinite(dbRoom.unreadCount)
        ? dbRoom.unreadCount
        : await summaries.unreadCount(dbRoom.id, userId);
      const summary = buildRoomRealtimeSummaryFromLobbyRoom(
        publicLobbyRoom({ ...dbRoom, unreadCount }),
        peers,
        avatarColorForPeerId
      );
      wsRegistry.sendToConnection(connection, buildServerEnvelope('room.summary', { room: summary }));
    }
  }

  function cleanupConnection(connection: WsConnection): void {
    cancelConnectionVoiceJoin(connection);
    if (connection.activeVoice) {
      const activeVoice = connection.activeVoice;
      const lease = leases.create(activeVoice);
      if (lease) {
        lease.disconnected = true;
        const peer = leases.currentPeer(lease);
        if (peer) {
          // The socket is gone: keep the seat's transport id for the lease and
          // swallow what the room still sends to it.
          const capturedTransport = peer.transport;
          peer.transport = {
            id: capturedTransport?.id,
            send: () => true,
            close: () => capturedTransport?.close?.()
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
    broadcastChatMessage: fanout.broadcastChatMessage,
    broadcastRoomDetail: fanout.broadcastRoomDetail,
    broadcastRoomTyping: fanout.broadcastRoomTyping,
    buildRoomSnapshot,
    cancelAccountReconnectLeases: leases.cancelAccount,
    cancelRoomReconnectLeases: leases.cancelRoom,
    cleanupConnection,
    disconnectAccountFromRoom,
    finalizeReconnectLease: leases.finalize,
    finalizePendingReconnectLease: leases.finalizePending,
    finalizeReconnectPeers: leases.finalizePeers,
    flushSummary: summaries.flush,
    invalidateRecipientCache: summaries.invalidateRecipients,
    joinVoiceRoom,
    leaveVoiceRoom,
    mirrorLegacyRoomEvent: fanout.mirrorLegacyRoomEvent,
    scheduleSummaryBroadcast,
    sendRoomSummaryToUser: summaries.sendToUser,
    sendAccountSummaries,
    subscribePreview,
    unsubscribePreview,
    updatePeerState
  };
}

export type RoomRealtimeRuntime = ReturnType<typeof createRoomRealtimeRuntime>;

export { clearViewedScreenPeerReferences, createRoomRealtimeRuntime, resolveViewedScreenPeerId };
