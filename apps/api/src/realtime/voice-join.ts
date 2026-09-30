// Taking a voice seat: the ordering of join requests (a later request from
// the same socket or for the same seat supersedes an earlier one), ban and
// capacity checks, reclaiming a reconnect lease, attaching the socket as the
// peer's transport, and the snapshot and roster events that follow.

import type { PublicPeer } from '@voice-room/shared/contracts/rooms';
import type { ClientCommands, RoomSnapshot } from '@voice-room/shared/contracts/realtime';
import {
  cleanName,
  isReservedPeerId,
  normalizePeerId,
  normalizeRoomId,
  normalizeSessionToken
} from '@voice-room/shared/validation';
import { LOG_EVENTS } from '../lib/log-events.ts';
import { buildServerEnvelope } from './envelope.ts';
import { legacyPeerMessageToWs, type RoomPeerMessage } from './legacy-events.ts';
import { createWsTransport } from './peer-transport.ts';
import type { ReconnectLeases } from './reconnect-leases.ts';
import type { ConnectionRegistry, WsConnection } from './registry.ts';
import type { createRoomFanout } from './room-fanout.ts';
import type { createRoomSummaries } from './room-summaries.ts';
import type { FinalizeError, Peer, PresenceRoom, RuntimeLogger, RuntimeRoomStore } from './runtime-types.ts';

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
export type JoinResult = { ok: boolean; code?: string; message?: string; reconnecting?: boolean };
/** A room.join command; the runtime normalizes every field itself. */
export type JoinPayload = Partial<ClientCommands['room.join']>;
type LeavePayload = { roomId?: string; peerId?: string; sessionToken?: string } | null;

export interface VoiceJoinDeps {
  presenceRooms: Map<string, PresenceRoom>;
  wsRegistry: ConnectionRegistry;
  getRoomStore: () => RuntimeRoomStore;
  getRoom: (roomId: string) => Promise<PresenceRoom | null>;
  publicPeer: (peer: Peer) => PublicPeer;
  broadcast: (room: PresenceRoom, message: RoomPeerMessage, exceptPeerId?: string) => void;
  closePeer: (roomId: string, peerId: string, transportId: string | undefined, reason: string) => void;
  avatarColorForPeerId: (peerId: unknown) => string;
  MAX_ROOM_PEERS: number;
  tokensMatch: (expected: string | null | undefined, actual: string | null | undefined) => boolean;
  sessionAvatarColorKey: (user: SessionUser) => string;
  queueRoomOccupancyTransition: (roomId: string) => Promise<unknown>;
  findRoomBan: (roomId: string, userId: string | null | undefined, ip: string) => Promise<unknown>;
  logger: RuntimeLogger;
  leases: ReconnectLeases;
  summaries: ReturnType<typeof createRoomSummaries>;
  fanout: ReturnType<typeof createRoomFanout>;
  buildRoomSnapshot: (roomId: string, mode: RoomSnapshot['mode']) => Promise<RoomSnapshot | null>;
  leaveVoiceRoom: (
    connection: WsConnection,
    payload: LeavePayload,
    options: { cancelPendingJoin?: boolean }
  ) => Promise<void>;
}

export function createVoiceJoin(deps: VoiceJoinDeps) {
  const {
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
    buildRoomSnapshot,
    leaveVoiceRoom
  } = deps;
  const scheduleSummaryBroadcast = summaries.schedule;
  const voiceJoinStates = new Map<string, { latestAuthorized: number; pending: number }>();
  let joinRequestSequenceCounter = 0;

  function attachVoiceTransport(connection: WsConnection, roomId: string, peerId: string, sessionToken: string) {
    const transport = createWsTransport((message) => {
      const envelope = legacyPeerMessageToWs(message, roomId);
      return wsRegistry.sendToConnection(connection, envelope);
    });
    connection.activeVoice = { roomId, peerId, sessionToken, transportId: transport.id };
    wsRegistry.registerConnectionForRoom(connection, roomId);
    return transport;
  }

  function beginVoiceJoin(joinKey: string): { latestAuthorized: number; pending: number } {
    const joinState = voiceJoinStates.get(joinKey) || { latestAuthorized: 0, pending: 0 };
    joinState.pending += 1;
    voiceJoinStates.set(joinKey, joinState);
    return joinState;
  }

  function authorizeVoiceJoin(joinState: { latestAuthorized: number }, joinRequestSequence: number): boolean {
    if (joinRequestSequence < joinState.latestAuthorized) return false;
    joinState.latestAuthorized = joinRequestSequence;
    return true;
  }

  function finishVoiceJoin(joinKey: string, joinState: { pending: number }): void {
    joinState.pending -= 1;
    if (joinState.pending === 0 && voiceJoinStates.get(joinKey) === joinState) {
      voiceJoinStates.delete(joinKey);
    }
  }

  function beginConnectionVoiceJoin(
    connection: WsConnection,
    roomId: string,
    peerId: string
  ): { roomId: string; peerId: string } {
    const intent = { roomId, peerId };
    connection.pendingVoiceJoin = intent;
    return intent;
  }

  function isCurrentConnectionVoiceJoin(connection: WsConnection, intent: unknown): boolean {
    return !connection.closed && connection.pendingVoiceJoin === intent;
  }

  function finishConnectionVoiceJoin(connection: WsConnection, intent: unknown): void {
    if (connection.pendingVoiceJoin === intent) connection.pendingVoiceJoin = null;
  }

  function cancelConnectionVoiceJoin(
    connection: WsConnection,
    payload: { roomId?: unknown; peerId?: unknown } | null = null
  ): void {
    const pending = connection.pendingVoiceJoin;
    if (!pending) return;
    if (
      payload &&
      (normalizeRoomId(payload.roomId) !== pending.roomId || normalizePeerId(payload.peerId) !== pending.peerId)
    ) {
      return;
    }
    connection.pendingVoiceJoin = null;
  }

  function supersededVoiceJoin(connection: WsConnection, roomId: string, transportId = ''): JoinResult {
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
  async function loadServerMute(
    roomId: string,
    peer: { accountUserId?: string; gateGuestPrincipalId?: string }
  ): Promise<boolean> {
    const store = getRoomStore();
    if (typeof store?.isRoomServerMuted !== 'function' || typeof store?.normalizeGatePrincipal !== 'function') {
      const error = new Error('Server mute authority is unavailable') as FinalizeError;
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

  async function joinVoiceRoom(
    connection: WsConnection,
    payload: JoinPayload,
    sessionUser: SessionUser,
    clientIp = '',
    requestId = ''
  ): Promise<JoinResult> {
    const joinRequestSequence = ++joinRequestSequenceCounter;
    const roomId = normalizeRoomId(payload.roomId);
    const peerId = normalizePeerId(payload.peerId);
    const sessionToken = normalizeSessionToken(payload.sessionToken);
    const name = cleanName(sessionUser?.displayName || sessionUser?.login || payload.name);

    // `auth-<userId>` is the API's own account peer id (shared/validation), so
    // a voice peer may never claim it.
    if (!roomId || !peerId || !sessionToken || isReservedPeerId(peerId)) {
      return { ok: false, code: 'invalid_join', message: 'Invalid room, peer, or session token' };
    }

    const currentPeer = presenceRooms.get(roomId)?.peers?.get(peerId);
    if (currentPeer && !tokensMatch(currentPeer.sessionToken, sessionToken)) {
      return { ok: false, code: 'invalid_session', message: 'Invalid peer session' };
    }
    let leaseClaim = leases.claim(roomId, peerId, sessionToken, joinRequestSequence);
    if (leaseClaim.state === 'busy') {
      return { ok: false, code: 'superseded_join', message: 'Another replacement already owns recovery' };
    }
    if (leaseClaim.state === 'failed-finalizer') {
      try {
        await leases.retryFailedFinalizer(leaseClaim.record);
      } catch {
        return { ok: false, code: 'reconnect_finalize_failed', message: 'Previous transport cleanup is incomplete' };
      }
      leaseClaim = leases.claim(roomId, peerId, sessionToken, joinRequestSequence);
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
      leaseClaim = leases.claim(roomId, peerId, sessionToken, joinRequestSequence);
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
    const claimedSessionWasTerminated = () =>
      leaseClaim.state === 'claimed' &&
      (!leases.isCurrent(leaseClaim.record) || leaseClaim.record.state !== 'claimed-by-replacement');
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

      const identityResult = (await getRoomStore().getOrCreatePeerIdentity({
        roomId,
        peerId,
        sessionToken,
        displayName: name,
        avatarColorKey: sessionAvatarColorKey(sessionUser)
      }))!;
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
      let persistedServerMuted: boolean;
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
        connection.activeVoice &&
        (connection.activeVoice.roomId !== roomId || connection.activeVoice.peerId !== peerId)
      ) {
        await leaveVoiceRoom(connection, connection.activeVoice, { cancelPendingJoin: false });
      }

      if (
        !isCurrentConnectionVoiceJoin(connection, connectionJoinIntent) ||
        joinState.latestAuthorized !== joinRequestSequence ||
        claimedSessionWasTerminated()
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
        previous.transport?.close?.();
      }

      const transport = attachVoiceTransport(connection, roomId, peerId, sessionToken);
      const peer = {
        closed: false,
        replaced: false,
        deafened: previous?.deafened ?? false,
        accountUserId: sessionUser?.id || '',
        avatarAccent: sessionUser?.avatarAccent || null,
        avatarColorKey,
        avatarUrl: sessionUser?.avatarKey ? `/api/avatars/${encodeURIComponent(sessionUser.avatarKey)}` : null,
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
        previous &&
        sessionUser &&
        (previous.accountUserId !== peer.accountUserId ||
          previous.avatarAccent !== peer.avatarAccent ||
          previous.avatarColorKey !== peer.avatarColorKey ||
          previous.avatarUrl !== peer.avatarUrl ||
          previous.name !== peer.name)
      );
      room.peers.set(peerId, peer);
      if (leaseClaim.state === 'claimed') {
        claimCompleted = leases.completeClaimed(leaseClaim.record, transport.id);
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
        summaries.invalidateRecipients(roomId);
        broadcast(room, { type: 'peer-joined', peer: publicPeer(peer) }, peerId);
        fanout.mirrorLegacyRoomEvent(roomId, { type: 'peer-joined', peer: publicPeer(peer) });
        scheduleSummaryBroadcast(roomId);
      } else if (reconnectProfileChanged) {
        summaries.invalidateRecipients(roomId);
        broadcast(room, { type: 'peer-updated', peer: publicPeer(peer) });
        fanout.mirrorLegacyRoomEvent(roomId, { type: 'peer-updated', peer: publicPeer(peer) });
        scheduleSummaryBroadcast(roomId);
      }

      try {
        await queueRoomOccupancyTransition(roomId);
      } catch (error) {
        // Presence was already committed in memory. Keep the resync protocol
        // live by delivering the authoritative snapshot even when the
        // best-effort occupancy marker cannot be persisted.
        logger.error(
          { evt: LOG_EVENTS.ROOM_OCCUPANCY_PERSIST_FAILED, roomId, err: error },
          'failed to persist room occupancy'
        );
      }

      if (
        !isCurrentConnectionVoiceJoin(connection, connectionJoinIntent) ||
        room.peers.get(peerId)?.transport?.id !== transport.id
      ) {
        return supersededVoiceJoin(connection, roomId, transport.id);
      }

      const snapshot = await buildRoomSnapshot(roomId, 'active');
      if (
        !isCurrentConnectionVoiceJoin(connection, connectionJoinIntent) ||
        room.peers.get(peerId)?.transport?.id !== transport.id
      ) {
        return supersededVoiceJoin(connection, roomId, transport.id);
      }
      if (snapshot) {
        wsRegistry.sendToConnection(connection, buildServerEnvelope('room.snapshot', snapshot, requestId));
      }

      return { ok: true, reconnecting };
    } finally {
      if (leaseClaim.state === 'claimed' && !claimCompleted) {
        const claimed = leaseClaim.record;
        if (terminalClaimFailure) {
          claimed.terminalReason ||= 'join-rejected';
          claimed.state = 'terminal-finalizing';
          leases.startFinalizer(claimed, claimed.terminalReason);
        } else {
          leases.restoreClaimed(claimed);
        }
      }
      finishConnectionVoiceJoin(connection, connectionJoinIntent);
      finishVoiceJoin(joinKey, joinState);
    }
  }

  return {
    /** The latest join request's sequence number. */
    sequence: () => joinRequestSequenceCounter,
    joinVoiceRoom,
    cancelConnectionVoiceJoin
  };
}
