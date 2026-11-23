import type { StoredRoom } from '../domains/rooms/room-views.ts';
import { roomAllowsChat, roomAllowsSurface, ROOM_SURFACE_CEILINGS } from '../domains/rooms/room-surface.policy.ts';
import type { ErrorCode } from '@voiceroom/shared/contracts/errors';
import type { ClientCommands, PeerLeaveReason, VoiceTarget } from '@voiceroom/shared/contracts/realtime';
import type { LobbyRoom, PublicPeer } from '@voiceroom/shared/contracts/rooms';
import { normalizePeerId, cleanGuestName, cleanStreamId, cleanScreenProfileId } from '@voiceroom/shared/validation';
import { buildServerEnvelope } from './envelope.ts';
import type { ServerEnvelope } from '@voiceroom/shared/realtime';
import { LOG_EVENTS } from '../lib/log-events.ts';
import { createLogger } from '../lib/logger.ts';
import type { RoomSnapshot } from '@voiceroom/shared/contracts/realtime';
import type { ActiveBanRecord } from '../domains/moderation/active-ban.repository.ts';
import type { CredentialBoundaryService } from '../domains/admission/credential-boundary.service.ts';
import type { ConnectionRegistry, WsConnection } from './registry.ts';
import { createReconnectLeases } from './reconnect-leases.ts';
import type { createRoomSummaries } from './room-summaries.ts';
import { createVoiceJoin, type JoinUser } from './voice-join.ts';
import { claimMedia, decideMediaRequest, MEDIA_MIN_VIEWERS, type MediaLimits } from './media-budget.ts';
import type { createMediaMinute } from './media-minute.ts';
import { leaveReasonOf } from './runtime-types.ts';
import { noteMicChange, noteStayRelief, noteVoiceReport, type noteStayEvent } from './voice-track.ts';
import { isRecord } from '@voiceroom/shared/guards';
import type {
  FinalizeError,
  CallRoomStore,
  LeaseReason,
  LeaseRecord,
  Peer,
  PresenceRoom,
  RuntimeLogger
} from './runtime-types.ts';
export type { RuntimeRoomStore } from './runtime-types.ts';

export type RuntimeCredentialBoundary = Pick<
  CredentialBoundaryService,
  'revokePeer' | 'resolvePrincipal' | 'revokePrincipal'
>;
export type RoomRuntimeDeps = {
  presenceRooms: Map<string, PresenceRoom>;
  wsRegistry: ConnectionRegistry;
  getRoomStore: () => CallRoomStore;
  getRoom: (roomId: string) => Promise<PresenceRoom | null>;
  publicPeer: (peer: Peer) => PublicPeer;
  publicLobbyRoom: (room: StoredRoom) => LobbyRoom;
  readHistory?: ((room: StoredRoom) => Promise<RoomSnapshot['recentMessages']>) | undefined;
  summaries?: Pick<ReturnType<typeof createRoomSummaries>, 'invalidateRecipients' | 'schedule'> | undefined;
  mediaMinute?: Pick<ReturnType<typeof createMediaMinute>, 'note' | 'noteDecision'> | undefined;
  stayEvent?: typeof noteStayEvent | undefined;
  /** Sends a room event to its peers and to the sockets previewing it. */
  publishRoomEvent: (roomId: string, envelope: ServerEnvelope, exceptPeerId?: string) => void;
  closePeer: (roomId: string, peerId: string, transportId: string | undefined, reason: PeerLeaveReason) => void;
  avatarColorForPeerId: (peerId: unknown) => string;
  MAX_ROOM_PEERS: number;
  MAX_VOICE_PEERS?: number;
  /** Server-wide video budget in Mbit/s; 0 turns it off. */
  MEDIA_BUDGET_MBPS?: number;
  /** People in voice at which the video budget reaches zero; 0 keeps it whole. */
  MEDIA_BUDGET_VOICE_PEERS?: number;
  /** Screen shares one room may run at once; 0 turns it off. */
  MAX_ROOM_SCREENS?: number;
  tokensMatch: (expected: string | null | undefined, actual: string | null | undefined) => boolean;
  sessionAvatarColorKey?: (user: JoinUser) => string;
  queueRoomOccupancyTransition?: (roomId: string) => Promise<unknown>;
  findRoomBan: (roomId: string, userId: string | null | undefined, ip: string) => Promise<ActiveBanRecord | null>;
  /** Null without a gate secret: leases then revoke through the room store. */
  credentialBoundary: RuntimeCredentialBoundary | null;
  removeLiveKitParticipant?: ((roomId: string, peerId: string) => Promise<unknown>) | undefined;
  now?: (() => number) | undefined;
  // Methods, so a test's timer may hand out its own handle type.
  setTimeout?(this: void, callback: () => void, ms: number): ReturnType<typeof globalThis.setTimeout> | number;
  clearTimeout?(this: void, timer: ReturnType<typeof globalThis.setTimeout> | number): void;
  reconnectLeaseMs?: number | undefined;
  logger?: RuntimeLogger | undefined;
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

function createRoomRealtimeRuntime(deps: RoomRuntimeDeps) {
  const {
    presenceRooms,
    wsRegistry,
    getRoomStore,
    getRoom,
    publicPeer,
    publicLobbyRoom,
    readHistory,
    summaries,
    mediaMinute,
    stayEvent,
    publishRoomEvent,
    closePeer,
    avatarColorForPeerId,
    MAX_ROOM_PEERS,
    MAX_VOICE_PEERS = 0,
    tokensMatch,
    sessionAvatarColorKey = () => '',
    queueRoomOccupancyTransition = async (roomId: string) => getRoomStore().markRoomActive(roomId),
    findRoomBan,
    credentialBoundary,
    removeLiveKitParticipant = async () => {},
    now = Date.now,
    setTimeout: scheduleTimeout = globalThis.setTimeout,
    clearTimeout: cancelTimeout = globalThis.clearTimeout,
    reconnectLeaseMs = 30000,
    logger = createLogger({ name: 'api' })
  } = deps;

  const mediaLimits = roomMediaLimits(deps);
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
    publishRoomEvent,
    closePeer,
    avatarColorForPeerId,
    MAX_ROOM_PEERS,
    MAX_VOICE_PEERS,
    tokensMatch,
    sessionAvatarColorKey,
    queueRoomOccupancyTransition,
    findRoomBan,
    logger,
    leases,
    summaries,
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
    reason: LeaseReason;
  }): Promise<{ finalized: true }> {
    if (credentialBoundary) {
      await credentialBoundary.revokePeer({
        roomId: record.roomId,
        accountUserId: peer.accountUserId || null,
        guestPrincipalId: peer.gateGuestPrincipalId || ''
      });
    } else {
      await getRoomStore().revokeLiveKitGatePeer({
        roomId: record.roomId,
        peerId: record.peerId,
        accountUserId: peer.accountUserId || null,
        guestPrincipalId: peer.gateGuestPrincipalId || '',
        now: now()
      });
    }

    closePeer(record.roomId, record.peerId, record.transportId, leaveReasonOf(reason));
    try {
      await removeLiveKitParticipant(record.roomId, record.peerId);
    } catch (error) {
      // The seat is already released; only the LiveKit removal failed.
      if (isRecord(error)) Object.assign(error, { ownershipFinalized: true });
      throw error;
    }
    summaries?.schedule(record.roomId);
    return { finalized: true };
  }

  async function buildRoomSnapshot(
    roomId: string,
    mode: RoomSnapshot['mode'] = 'preview'
  ): Promise<RoomSnapshot | null> {
    const dbRoom = await getRoomStore().getRoom(roomId);
    if (!dbRoom) return null;
    const recentMessages =
      readHistory && roomAllowsChat(dbRoom, dbRoom.kind ?? 'main') ? await readHistory(dbRoom) : [];
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
    const token = Symbol(roomId);
    const userId = connection.userId;
    const pending = (connection.pendingPreviews ||= new Map());
    const owners = (connection.previewOwners ||= new Map());
    pending.set(roomId, token);
    const current = () => !connection.closed && connection.userId === userId && pending.get(roomId) === token;
    const undo = () => {
      if (owners.get(roomId) !== token) return;
      owners.delete(roomId);
      connection.previewRoomIds.delete(roomId);
      if (connection.activeVoice?.roomId !== roomId) wsRegistry.unregisterConnectionForRoom(connection, roomId);
    };
    try {
      const boundary = await getRoomStore().getRoom(roomId);
      if (!current()) return;
      if (!roomAllowsSurface(boundary, 'main') || ROOM_SURFACE_CEILINGS[connection.roomSurface ?? 'main'].guestOnly)
        return;
      const roomBan = await findRoomBan(roomId, userId, connection.clientIp || connection.guestIp || '');
      if (!current()) return;
      if (roomBan) {
        wsRegistry.sendToConnection(connection, buildServerEnvelope('room.banned', { roomId }));
        return;
      }
      owners.set(roomId, token);
      connection.previewRoomIds.add(roomId);
      wsRegistry.registerConnectionForRoom(connection, roomId);
      const snapshot = await buildRoomSnapshot(roomId, 'preview');
      if (!current()) return;
      if (!snapshot) {
        wsRegistry.sendToConnection(connection, buildServerEnvelope('room.not_found', { roomId }));
        undo();
        return;
      }
      wsRegistry.sendToConnection(connection, buildServerEnvelope('room.snapshot', snapshot));
    } catch (error) {
      undo();
      throw error;
    } finally {
      if (pending.get(roomId) === token) pending.delete(roomId);
    }
  }

  function unsubscribePreview(connection: WsConnection, roomId: string): void {
    connection.pendingPreviews?.delete(roomId);
    connection.previewOwners?.delete(roomId);
    connection.previewRoomIds.delete(roomId);
    if (connection.activeVoice?.roomId !== roomId) wsRegistry.unregisterConnectionForRoom(connection, roomId);
  }

  async function leaveVoiceRoom(
    connection: WsConnection,
    payload:
      (Omit<ClientCommands['room.leave'], 'sessionToken'> & { sessionToken?: string }) | null = connection.activeVoice,
    { cancelPendingJoin = true }: { cancelPendingJoin?: boolean } = {}
  ): Promise<void> {
    if (cancelPendingJoin) cancelConnectionVoiceJoin(connection, payload);
    if (!payload) return;
    const activeVoice = connection.activeVoice;
    const sessionToken = payload.sessionToken || activeVoice?.sessionToken || '';
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
      if (stayEvent && payload.relief) noteStayRelief(peer, payload.relief, now());
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
    summaries?.schedule(payload.roomId);
  }

  async function disconnectAccountFromRoom({
    roomId,
    userId,
    reason = 'left-room'
  }: { roomId?: string; userId?: string; reason?: PeerLeaveReason } = {}): Promise<
    { ok: true; disconnected: number } | { ok: false; code: ErrorCode; disconnected: 0 }
  > {
    if (!roomId || !userId || !credentialBoundary) {
      return { ok: false, code: 'credential_boundary_unavailable', disconnected: 0 };
    }
    const boundary = credentialBoundary;
    const principal = boundary.resolvePrincipal({ roomId, accountUserId: userId });
    if (!principal) return { ok: false, code: 'principal_unavailable', disconnected: 0 };
    const room = presenceRooms.get(roomId);
    const peers = [...(room?.peers?.values?.() || [])].filter((peer) => peer.accountUserId === userId);
    let principalRevocationPromise: ReturnType<RuntimeCredentialBoundary['revokePrincipal']> | null = null;
    const revokePrincipalOnce = () => {
      principalRevocationPromise ||= boundary.revokePrincipal({ roomId, principal });
      return principalRevocationPromise;
    };
    let revokeFailed = false;
    try {
      await leases.cancelAccount({
        roomId,
        userId,
        reason,
        finalizePeer: async ({ peer, ownershipFinalized }) => {
          if (!peer) return;
          const revoked = await revokePrincipalOnce();
          if (revoked.status !== 'revoked') {
            revokeFailed = true;
            const error: FinalizeError = new Error(revoked.status);
            error.code = 'revoke_failed';
            throw error;
          }
          if (!ownershipFinalized) closePeer(roomId, peer.id, peer.transport?.id, reason);
          if (!ownershipFinalized) await removeLiveKitParticipant(roomId, peer.id);
        }
      });
    } catch {
      return { ok: false, code: revokeFailed ? 'revoke_failed' : 'reconnect_finalize_failed', disconnected: 0 };
    }

    if (peers.length === 0) {
      const revoked = await revokePrincipalOnce();
      if (revoked.status !== 'revoked') return { ok: false, code: 'revoke_failed', disconnected: 0 };
    }

    for (const peer of peers) {
      wsRegistry.sendToUser(userId, buildServerEnvelope('room.left', { roomId, peerId: peer.id, reason }));
      wsRegistry.detachVoicePeer(roomId, peer.id);
    }
    summaries?.schedule(roomId);
    return { ok: true, disconnected: peers.length };
  }

  // The peer behind a command that speaks for a voice session: it must be the
  // session this connection holds right now.
  function activePeer(
    connection: WsConnection,
    { roomId, peerId, sessionToken }: VoiceTarget
  ): { ok: true; room: PresenceRoom; peer: Peer } | { ok: false; code: ErrorCode } {
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
    return { ok: true, room, peer };
  }

  async function updatePeerState(connection: WsConnection, payload: ClientCommands['room.peer.update']) {
    const { roomId, patch } = payload;

    const active = activePeer(connection, payload);
    if (!active.ok) return active;
    const { room, peer } = active;

    const stoppedScreen = Object.hasOwn(patch, 'screen') && peer.screen && !patch.screen;
    // A claim holds the budget until the stream is in presence, and ends with
    // it. A patch that only repeats "no screen" between the grant and the
    // publish keeps it.
    if (patch.screen === true || stoppedScreen) delete peer.mediaClaims?.screen;
    if (patch.camera === true || (Object.hasOwn(patch, 'camera') && peer.camera && !patch.camera)) {
      delete peer.mediaClaims?.camera;
    }

    if (Object.hasOwn(patch, 'name') && !peer.accountUserId) peer.name = cleanGuestName(patch.name);
    // A moderator mute outranks the client: the participant may still mute
    // itself, but an unmute is dropped until the owner lifts the server mute.
    if (Object.hasOwn(patch, 'muted')) {
      const muted = peer.serverMuted || Boolean(patch.muted);
      if (muted !== Boolean(peer.muted)) noteMicChange(peer, now());
      peer.muted = muted;
    }
    if (Object.hasOwn(patch, 'deafened')) peer.deafened = Boolean(patch.deafened);
    if (Object.hasOwn(patch, 'camera') && Boolean(peer.camera) !== Boolean(patch.camera)) {
      stayEvent?.(peer, patch.camera ? 'camera_on' : 'camera_off', now());
    }
    if (Object.hasOwn(patch, 'screen') && Boolean(peer.screen) !== Boolean(patch.screen)) {
      stayEvent?.(peer, patch.screen ? 'screen_on' : 'screen_off', now());
    }
    if (Object.hasOwn(patch, 'camera')) peer.camera = Boolean(patch.camera);
    if (Object.hasOwn(patch, 'screen')) peer.screen = Boolean(patch.screen);
    if (Object.hasOwn(patch, 'screenAudio')) peer.screenAudio = Boolean(patch.screenAudio);
    if (Object.hasOwn(patch, 'screenProfileId')) peer.screenProfileId = cleanScreenProfileId(patch.screenProfileId);
    if (Object.hasOwn(patch, 'screenStreamId')) peer.screenStreamId = cleanStreamId(patch.screenStreamId);
    if (patch.screen === true || patch.camera === true) mediaMinute?.note();
    if (Object.hasOwn(patch, 'viewedScreenPeerId')) {
      peer.viewedScreenPeerId = resolveViewedScreenPeerId(room, peer.id, patch.viewedScreenPeerId);
    }
    // A tab from before room.voice.report still sends its own read of the
    // network alone; the server judges the voice itself, so it changes nothing.
    if (Object.hasOwn(patch, 'network') && Object.keys(patch).length === 1)
      return { ok: true as const, peer: publicPeer(peer) };

    if (stoppedScreen) {
      for (const viewer of clearViewedScreenPeerReferences(room, peer.id)) {
        publishRoomEvent(roomId, buildServerEnvelope('room.peer.updated', { roomId, peer: publicPeer(viewer) }));
      }
    }

    publishRoomEvent(roomId, buildServerEnvelope('room.peer.updated', { roomId, peer: publicPeer(peer) }));
    summaries?.schedule(roomId);
    return { ok: true as const, peer: publicPeer(peer) };
  }

  // A stats poll of a peer in voice: the room is judged again and every peer
  // whose verdict changed is told, on its own socket only.
  function reportVoice(connection: WsConnection, payload: ClientCommands['room.voice.report']) {
    const active = activePeer(connection, payload);
    if (!active.ok) return active;
    const { roomId, mic } = payload;
    if (stayEvent && mic && (mic.reopens > 0 || mic.replacements > 0)) {
      logger.warn(
        {
          evt: LOG_EVENTS.ROOM_MIC_STALL_RECOVERY,
          connId: connection.id,
          userId: connection.userId || undefined,
          roomId: connection.roomSurface === 'widget' ? undefined : roomId,
          mic
        },
        'a client recovered a stalled microphone'
      );
    }
    for (const { peer, verdict } of noteVoiceReport(
      active.room.peers,
      active.peer,
      payload,
      now(),
      Boolean(stayEvent)
    )) {
      const socket = peer.transport?.connection;
      if (!socket) continue;
      wsRegistry.sendToConnection(
        socket,
        buildServerEnvelope('room.voice.quality', {
          roomId,
          peerId: peer.id,
          level: verdict?.level ?? null,
          cause: verdict?.cause ?? null
        })
      );
    }
    return { ok: true as const };
  }

  // Asked before a screen share or a camera starts. A grant holds its share of
  // the budget until the stream shows up in presence.
  function requestMedia(connection: WsConnection, payload: ClientCommands['room.media.request']) {
    const active = activePeer(connection, payload);
    if (!active.ok) return active;
    const at = now();
    const profileId = cleanScreenProfileId(payload.profileId);
    const grant = decideMediaRequest({
      rooms: presenceRooms.values(),
      room: active.room,
      peer: active.peer,
      kind: payload.kind,
      profileId,
      limits: mediaLimits,
      now: at
    });
    claimMedia(active.peer, grant, at);
    mediaMinute?.noteDecision(payload.kind, profileId, grant);
    return { ok: true as const, grant };
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
          // The socket is gone: the seat keeps its transport id for the lease
          // and reaches nobody until the rejoin.
          peer.transport = { id: peer.transport?.id ?? activeVoice.transportId, connection: null };
          lease.peer = peer;
        }
      }
      connection.activeVoice = null;
    }
    wsRegistry.unregisterConnectionFromAllRooms(connection);
    connection.previewRoomIds.clear();
  }

  return {
    buildRoomSnapshot,
    cancelAccountReconnectLeases: leases.cancelAccount,
    cancelRoomReconnectLeases: leases.cancelRoom,
    cleanupConnection,
    disconnectAccountFromRoom,
    finalizeReconnectLease: leases.finalize,
    finalizePendingReconnectLease: leases.finalizePending,
    finalizeReconnectPeers: leases.finalizePeers,
    joinVoiceRoom,
    leaveVoiceRoom,
    reportVoice,
    requestMedia,
    subscribePreview,
    unsubscribePreview,
    updatePeerState
  };
}

export type RoomRealtimeRuntime = ReturnType<typeof createRoomRealtimeRuntime>;

export function roomMediaLimits({
  MAX_ROOM_PEERS,
  MEDIA_BUDGET_MBPS = 0,
  MEDIA_BUDGET_VOICE_PEERS = 0,
  MAX_ROOM_SCREENS = 0
}: Pick<
  RoomRuntimeDeps,
  'MAX_ROOM_PEERS' | 'MEDIA_BUDGET_MBPS' | 'MEDIA_BUDGET_VOICE_PEERS' | 'MAX_ROOM_SCREENS'
>): MediaLimits {
  return {
    budgetBps: MEDIA_BUDGET_MBPS * 1_000_000,
    maxRoomScreens: MAX_ROOM_SCREENS,
    minViewers: Math.min(MEDIA_MIN_VIEWERS, Math.max(0, MAX_ROOM_PEERS - 1)),
    voicePeersAtZero: MEDIA_BUDGET_VOICE_PEERS
  };
}

export { clearViewedScreenPeerReferences, createRoomRealtimeRuntime, resolveViewedScreenPeerId };
