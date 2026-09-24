import { SUMMARY_COALESCE_MS } from '@voice-room/shared/realtime';
import {
  normalizeRoomId,
  normalizePeerId,
  normalizeSessionToken,
  cleanName,
  cleanStreamId,
  cleanScreenProfileId,
  isReservedPeerId
} from '@voice-room/shared/validation';
import { buildServerEnvelope, buildServerErrorEnvelope } from './envelope.ts';
import { buildRoomRealtimeSummaryFromLobbyRoom, createSummaryCoalescer } from './summary.ts';
import { createWsTransport } from './peer-transport.ts';
import { LOG_EVENTS } from '../lib/log-events.ts';
import { createLogger } from '../lib/logger.ts';
import { legacyPeerMessageToWs } from './legacy-events.ts';
import { createTypingThrottle } from './typing-throttle.ts';
import type { TypingActivity, ServerEnvelope } from '@voice-room/shared/realtime';
import type { RoomStore } from '../lib/room-store.ts';
import type { UserStore } from '../lib/user-store.ts';
import type { ConnectionRegistry, WsConnection } from './registry.ts';

// Presence peers and rooms are plain in-memory records shared with server.ts.
type Peer = { id: string; [key: string]: any };
type PresenceRoom = { peers: Map<string, Peer>; voiceActiveSince?: number | null; [key: string]: any };
type VoiceTarget = { roomId: string; peerId: string; sessionToken?: string; transportId?: string };
type FinalizeContext = { roomId: string; peerId: string; peer: Peer | null; reason: string; ownershipFinalized: boolean };
type FinalizePeer = (context: FinalizeContext) => Promise<{ finalized?: boolean } | void | undefined>;
type FinalizeResult = { ok: true; finalized: boolean };
type LeaseState =
  | 'pending'
  | 'claimed-by-replacement'
  | 'finalizing-expiry'
  | 'terminal-finalizing'
  | 'finalizer-failed'
  | 'terminal-finalizer-failed'
  | 'terminal';
type LeaseRecord = {
  key: string;
  roomId: string;
  peerId: string;
  sessionToken: string;
  transportId: string;
  generation: number;
  deadline: number;
  state: LeaseState;
  timer: any;
  finalizerPromise: Promise<FinalizeResult> | null;
  finalizeCallbacks: FinalizePeer[];
  terminalReason: string;
  terminalAtJoinSequence: number;
  claimRequestSequence: number;
  finalizerErrorCode: string;
  disconnected: boolean;
  peer: Peer;
};
type LeaseClaim =
  | { state: 'none'; record: null }
  | { state: 'claimed' | 'finalizing' | 'busy' | 'failed-finalizer' | 'terminal' | LeaseState; record: LeaseRecord };
type FinalizeError = Error & { ownershipFinalized?: boolean; rollbackTerminal?: boolean; code?: string };
type SessionUser = {
  id: string;
  displayName?: string;
  login?: string;
  avatarAccent?: string | null;
  avatarKey?: string | null;
  [key: string]: unknown;
} | null | undefined;
type JoinResult = { ok: boolean; code?: string; message?: string; reconnecting?: boolean };
type RuntimeRoomStore = Pick<RoomStore,
  'getRoom' | 'listMessages' | 'getOrCreatePeerIdentity' | 'listVisibleRoomsForUser' | 'listSummaryRecipientUserIds' | 'markRoomActive'>
  & Partial<Pick<RoomStore,
    'revokeLiveKitGatePeer' | 'getRoomUnreadCount' | 'listNotificationRecipientUserIds' | 'isRoomServerMuted' | 'normalizeGatePrincipal'>>;
type GatePrincipal = { principalType: 'account' | 'guest'; principalId: string };
type RuntimeCredentialBoundary = {
  revokePeer?: (input: { roomId: string; accountUserId: string | null; guestPrincipalId: string }) => Promise<unknown>;
  resolvePrincipal?: (input: { roomId: string; accountUserId: string }) => GatePrincipal | null;
  revokePrincipal?: (input: { roomId: string; principal: GatePrincipal }) => Promise<{ status?: string } | null | undefined>;
};
type RuntimeLogger = { info(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void };
export type RoomRuntimeDeps = {
  presenceRooms: Map<string, PresenceRoom>;
  wsRegistry: ConnectionRegistry;
  getRoomStore: () => RuntimeRoomStore;
  getRoom: (roomId: string) => Promise<PresenceRoom | null>;
  publicPeer: (peer: any) => any;
  publicLobbyRoom: (room: any) => any;
  publicChatMessage: (message: any) => any;
  getUserStore?: (() => Pick<UserStore, 'getUserById'>) | null;
  broadcast: (room: any, message: Record<string, unknown>, exceptPeerId?: string) => void;
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
  setTimeout?: (callback: () => void, ms: number) => any;
  clearTimeout?: (timer: any) => void;
  reconnectLeaseMs?: number;
  logger?: RuntimeLogger;
};


function resolveViewedScreenPeerId(room: PresenceRoom | null | undefined, viewerPeerId: string, value: unknown): string {
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

  const recipientCache = new Map<string, { userIds: string[]; at: number }>();
  const voiceJoinStates = new Map<string, { latestAuthorized: number; pending: number }>();
  const reconnectLeases = new Map<string, LeaseRecord>();
  const leaseDurationMs = Number.isInteger(reconnectLeaseMs)
    && reconnectLeaseMs >= 1000
    && reconnectLeaseMs <= 120000
    ? reconnectLeaseMs
    : 30000;
  let voiceJoinRequestSequence = 0;
  let reconnectLeaseGeneration = 0;

  function reconnectLeaseKey(roomId: string, peerId: string, sessionToken: string): string {
    return `${roomId}\u0000${peerId}\u0000${sessionToken}`;
  }

  function currentLeasePeer(record: LeaseRecord): Peer | null {
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

  async function defaultFinalizeLeasePeer({ record, peer, reason }: { record: LeaseRecord; peer: Peer; reason: string }): Promise<{ finalized: true }> {
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

  function scheduleLeaseExpiry(record: LeaseRecord): void {
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

  async function runLeaseFinalizer(record: LeaseRecord, reason: string, finalizePeer: FinalizePeer | null): Promise<FinalizeResult> {
    if (finalizePeer && !record.finalizeCallbacks.includes(finalizePeer)) {
      record.finalizeCallbacks.push(finalizePeer);
    }
    if (record.finalizerPromise) return record.finalizerPromise;

    record.finalizerPromise = (async (): Promise<FinalizeResult> => {
      let ownershipFinalized = false;
      let failure: FinalizeError | null = null;
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
            ownershipFinalized = (result as { finalized?: boolean } | undefined)?.finalized !== false;
          } else {
            await defaultFinalizeLeasePeer({ record, peer: ownedPeer, reason });
            ownershipFinalized = true;
          }
        } catch (error) {
          failure = error as FinalizeError;
          ownershipFinalized = (error as FinalizeError | null)?.ownershipFinalized === true;
        }
      }

      for (let index = 0; index < record.finalizeCallbacks.length; index += 1) {
        const callback = record.finalizeCallbacks[index] as FinalizePeer;
        try {
          const result = await callback({
            roomId: record.roomId,
            peerId: record.peerId,
            peer: record.peer,
            reason: record.terminalReason || reason,
            ownershipFinalized
          });
          if (!ownershipFinalized) ownershipFinalized = (result as { finalized?: boolean } | undefined)?.finalized !== false;
        } catch (error) {
          failure ||= error as FinalizeError;
          if (!ownershipFinalized) ownershipFinalized = (error as FinalizeError | null)?.ownershipFinalized === true;
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

  function startLeaseFinalizer(record: LeaseRecord, reason: string): void {
    void runLeaseFinalizer(record, reason, null).catch(() => {
      // The record remains in a typed failed-finalizer state. Replacement and
      // terminal paths must explicitly retry/adopt it before admission proceeds.
    });
  }

  async function retryFailedLeaseFinalizer(record: LeaseRecord, reason = 'lost'): Promise<FinalizeResult | null> {
    if (record.state !== 'finalizer-failed' && record.state !== 'terminal-finalizer-failed') {
      return record.finalizerPromise;
    }
    record.state = record.terminalReason ? 'terminal-finalizing' : 'finalizing-expiry';
    record.finalizerPromise = null;
    record.finalizerErrorCode = '';
    return runLeaseFinalizer(record, record.terminalReason || reason, null);
  }

  function createReconnectLease(activeVoice: VoiceTarget): LeaseRecord | null {
    const room = presenceRooms.get(activeVoice.roomId);
    const peer = room?.peers?.get(activeVoice.peerId);
    if (
      !peer
      || peer.transport?.id !== activeVoice.transportId
      || !tokensMatch(peer.sessionToken, activeVoice.sessionToken)
    ) {
      return null;
    }

    const key = reconnectLeaseKey(activeVoice.roomId, activeVoice.peerId, activeVoice.sessionToken as string);
    const existing = reconnectLeases.get(key);
    if (existing && existing.transportId === activeVoice.transportId) {
      return existing;
    }
    if (existing?.timer) cancelTimeout(existing.timer);

    const record: LeaseRecord = {
      key,
      roomId: activeVoice.roomId,
      peerId: activeVoice.peerId,
      sessionToken: activeVoice.sessionToken as string,
      transportId: activeVoice.transportId as string,
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

  function claimReconnectLease(roomId: string, peerId: string, sessionToken: string, joinRequestSequence: number): LeaseClaim {
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

  function restoreClaimedLease(record: LeaseRecord): boolean {
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

  function completeClaimedLease(record: LeaseRecord, transportId: string): boolean {
    if (reconnectLeases.get(record.key) !== record || record.state !== 'claimed-by-replacement') return false;
    record.transportId = transportId;
    reconnectLeases.delete(record.key);
    return true;
  }

  function terminalClaimRecord(record: LeaseRecord, reason: string, finalizePeer: FinalizePeer | null | undefined): LeaseRecord {
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

  function recordsForPeer(roomId: string, peerId: string, { expectedSessionToken = '', expectedTransportId = '' }: { expectedSessionToken?: string; expectedTransportId?: string } = {}): LeaseRecord[] {
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

  async function settleLeaseFinalizers(records: LeaseRecord[], reason: string): Promise<FinalizeResult[]> {
    const settled = await Promise.allSettled(
      records.map((record) => runLeaseFinalizer(record, reason, null))
    );
    const rejected = settled.find((result) => result.status === 'rejected');
    if (rejected) throw rejected.reason;
    return settled.map((result) => (result as PromiseFulfilledResult<FinalizeResult>).value);
  }

  async function finalizeReconnectLease({
    roomId,
    peerId,
    reason = 'left',
    finalizePeer = null,
    expectedSessionToken = '',
    expectedTransportId = ''
  }: {
    roomId: string;
    peerId: string;
    reason?: string;
    finalizePeer?: FinalizePeer | null;
    expectedSessionToken?: string;
    expectedTransportId?: string;
  } = {} as { roomId: string; peerId: string }) {
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
  }: { roomId?: unknown; peerId?: unknown; sessionToken?: unknown; reason?: string } = {}) {
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

  async function cancelRoomReconnectLeases({ roomId, reason = 'deleted', finalizePeer = null }: { roomId: string; reason?: string; finalizePeer?: FinalizePeer | null } = {} as { roomId: string }) {
    const peerIds = new Set([
      ...[...reconnectLeases.values()].filter((record) => record.roomId === roomId).map((record) => record.peerId),
      ...[...(presenceRooms.get(roomId)?.peers?.keys?.() || [])]
    ]);
    const records = [...peerIds].flatMap((peerId) => recordsForPeer(roomId, peerId));
    for (const record of records) terminalClaimRecord(record, reason, finalizePeer);
    const results = await settleLeaseFinalizers(records, reason);
    return { ok: true, finalized: results.filter((result) => result.finalized).length };
  }

  async function cancelAccountReconnectLeases({ roomId, userId, reason = 'membership-left', finalizePeer = null }: { roomId: string; userId: string; reason?: string; finalizePeer?: FinalizePeer | null } = {} as { roomId: string; userId: string }) {
    const peerIds = new Set<string>();
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

  async function finalizeReconnectPeers({ roomId, peerIds = [], reason, finalizePeer }: { roomId: string; peerIds?: string[]; reason: string; finalizePeer?: FinalizePeer | null } = {} as { roomId: string; reason: string }) {
    const records = [...new Set(peerIds)].flatMap((peerId) => recordsForPeer(roomId, peerId));
    for (const record of records) terminalClaimRecord(record, reason, finalizePeer);
    const results = await settleLeaseFinalizers(records, reason);
    return { ok: true, finalized: results.filter((result) => result.finalized).length };
  }

  async function resolveSummaryRecipients(roomId: string): Promise<string[]> {
    const cached = recipientCache.get(roomId);
    if (cached && Date.now() - cached.at < 30000) return cached.userIds;

    const userIds = new Set<string>();
    try {
      const stored = await getRoomStore().listSummaryRecipientUserIds(roomId);
      for (const id of stored) userIds.add(id);
    } catch (error) {
      logger.error({ evt: LOG_EVENTS.ROOM_SUMMARY_RECIPIENTS_FAILED, roomId, err: error }, 'failed to resolve room summary recipients');
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

  function invalidateRecipientCache(roomId: string | null | undefined): void {
    if (roomId) recipientCache.delete(roomId);
  }

  async function resolveRoomUnreadCount(roomId: string, userId: string, fallback = 0): Promise<number> {
    const getUnreadCount = getRoomStore().getRoomUnreadCount;
    if (typeof getUnreadCount !== 'function') return fallback;
    return getUnreadCount.call(getRoomStore(), roomId, userId);
  }

  async function flushSummary(roomId: string): Promise<void> {
    const dbRoom = await getRoomStore().getRoom(roomId);
    if (!dbRoom) return;
    const presence = presenceRooms.get(roomId);
    const peers = presence ? Array.from(presence.peers.values()).map(publicPeer) : [];
    const recipients = await resolveSummaryRecipients(roomId);
    await Promise.all(recipients.map((userId) => sendRoomSummaryToUser(roomId, userId, dbRoom, peers)));
  }

  async function sendRoomSummaryToUser(roomId: string, userId: string, room: any = null, roomPeers: unknown[] | null = null): Promise<boolean> {
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

  function scheduleSummaryBroadcast(roomId: string): void {
    if (!roomId) return;
    summaryCoalescer.schedule(roomId);
  }

  function connectionWantsRoomDetail(connection: WsConnection, roomId: string): boolean {
    return connection.previewRoomIds.has(roomId) || connection.activeVoice?.roomId === roomId;
  }

  function broadcastRoomDetail(roomId: string, envelope: ServerEnvelope, { previewOnly = false, except = null }: { previewOnly?: boolean; except?: WsConnection | null } = {}): void {
    for (const connection of wsRegistry.roomDetailSubscribers(roomId)) {
      if (connection === except) continue;
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

  function mirrorLegacyRoomEvent(roomId: string, message: Record<string, unknown>): void {
    const envelope = legacyPeerMessageToWs(message, roomId);
    if (!envelope) return;
    broadcastRoomDetail(roomId, envelope, { previewOnly: true });
  }

  function broadcastChatMessage(roomId: string, message: any): void {
    const envelope = buildServerEnvelope('room.chat.message', {
      roomId,
      message: publicChatMessage(message)
    });
    broadcastRoomDetail(roomId, envelope);
    scheduleSummaryBroadcast(roomId);
    void broadcastRoomMessageNotification(roomId, message);
  }

  // Typing notices are forwarded and never stored. Only someone who can read
  // the room chat may announce typing in it: an account with the room open or
  // in its call, or a guest in its call. The name comes from the call roster or
  // the account profile, never from the client.
  const TYPING_PROFILE_TTL_MS = 60_000;

  async function typistForConnection(connection: WsConnection, roomId: string): Promise<{ peerId: string; userId: string | null; name: string } | null> {
    const voicePeerId = connection.activeVoice?.roomId === roomId ? connection.activeVoice.peerId : '';
    const peer = voicePeerId ? presenceRooms.get(roomId)?.peers.get(voicePeerId) : null;
    if (peer) {
      return { peerId: peer.id, userId: peer.accountUserId || null, name: cleanName(peer.name) || 'Гость' };
    }
    if (!connection.userId || !connection.previewRoomIds.has(roomId) || !getUserStore) return null;
    const cached = connection.typingProfile;
    if (cached && now() - cached.at < TYPING_PROFILE_TTL_MS) return cached.typist;
    const user = await getUserStore().getUserById(connection.userId);
    if (!user) return null;
    const typist = { peerId: `auth-${user.id}`, userId: user.id, name: user.displayName || user.login || '' };
    connection.typingProfile = { at: now(), typist };
    return typist;
  }

  function broadcastRoomTyping(connection: WsConnection, roomId: string, activity: TypingActivity = 'typing'): void {
    if (connection.closed || !roomId) return;
    connection.roomTypingThrottle ??= createTypingThrottle<TypingActivity>({ now });
    connection.roomTypingThrottle.offer(roomId, activity, (value: TypingActivity) => {
      sendRoomTyping(connection, roomId, value).catch((error: unknown) => {
        logger.warn({ evt: LOG_EVENTS.ROOM_TYPING_FORWARD_FAILED, roomId, err: error }, 'failed to forward a room typing notice');
      });
    });
  }

  async function sendRoomTyping(connection: WsConnection, roomId: string, activity: TypingActivity): Promise<void> {
    const typist = await typistForConnection(connection, roomId);
    if (!typist || connection.closed) return;
    broadcastRoomDetail(roomId, buildServerEnvelope('room.chat.typing', { roomId, typist, activity }), { except: connection });
  }

  function roomNotificationContext(room: { avatarKey?: string | null; id: string; name?: string }) {
    return {
      avatarUrl: room.avatarKey ? `/api/avatars/${encodeURIComponent(room.avatarKey)}` : null,
      roomId: room.id,
      name: room.name || ''
    };
  }

  function senderNotificationContext(message: any, user: any) {
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

  async function broadcastRoomMessageNotification(roomId: string, message: any): Promise<void> {
    if (!getUserStore) return;
    const userStore = getUserStore;
    let room: Awaited<ReturnType<RuntimeRoomStore['getRoom']>> = null;
    try {
      room = await getRoomStore().getRoom(roomId);
    } catch (error) {
      logger.error({ evt: LOG_EVENTS.NOTIFICATION_BROADCAST_FAILED, roomId, stage: 'room', err: error }, 'failed to resolve the room for a room notification');
      return;
    }
    if (!room?.isStatic) return;

    let recipients: string[] = [];
    try {
      const listNotificationRecipients = getRoomStore().listNotificationRecipientUserIds;
      recipients = typeof listNotificationRecipients === 'function'
        ? await listNotificationRecipients(roomId)
        : [];
    } catch (error) {
      logger.error({ evt: LOG_EVENTS.NOTIFICATION_BROADCAST_FAILED, roomId, stage: 'recipients', err: error }, 'failed to resolve room notification recipients');
      return;
    }

    const authorUserId = message.authorUserId || '';
    let authorUser = null;
    if (authorUserId) {
      try {
        authorUser = await userStore().getUserById(authorUserId);
      } catch (error) {
        logger.warn({ evt: LOG_EVENTS.NOTIFICATION_BROADCAST_FAILED, roomId, stage: 'sender', err: error }, 'failed to resolve a room notification sender');
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
        logger.error({ evt: LOG_EVENTS.NOTIFICATION_BROADCAST_FAILED, roomId, stage: 'broadcast', err: error }, 'failed to broadcast a room notification');
      }
    }
  }

  async function buildRoomSnapshot(roomId: string, mode = 'preview') {
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

  function attachVoiceTransport(connection: WsConnection, roomId: string, peerId: string, sessionToken: string) {
    const transport = createWsTransport((message) => {
      const envelope = legacyPeerMessageToWs(message as Record<string, any>, roomId);
      if (!envelope) return false;
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

  function beginConnectionVoiceJoin(connection: WsConnection, roomId: string, peerId: string): { roomId: string; peerId: string } {
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

  function cancelConnectionVoiceJoin(connection: WsConnection, payload: { roomId?: unknown; peerId?: unknown } | null = null): void {
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

  function supersededVoiceJoin(connection: WsConnection, roomId: string, transportId = ''): JoinResult {
    if (transportId && connection.activeVoice?.transportId === transportId) {
      closePeer(roomId, connection.activeVoice!.peerId, transportId, 'replaced');
      connection.activeVoice = null;
      if (!connection.previewRoomIds.has(roomId)) wsRegistry.unregisterConnectionForRoom(connection, roomId);
    }
    return { ok: false, code: 'superseded_join', message: 'Join replaced by a newer connection' };
  }

  // Moderator mutes are stored per gate principal. A lookup failure must block
  // admission: treating an unavailable authority as "not muted" would let a
  // participant bypass moderation simply by reconnecting during a DB outage.
  async function loadServerMute(roomId: string, peer: { accountUserId?: string; gateGuestPrincipalId?: string }): Promise<boolean> {
    const store = getRoomStore();
    if (typeof store?.isRoomServerMuted !== 'function' || typeof store?.normalizeGatePrincipal !== 'function') {
      const error = new Error('Server mute authority is unavailable') as FinalizeError;
      error.code = 'server_mute_unavailable';
      throw error;
    }
    const principal = store.normalizeGatePrincipal!({
      accountUserId: peer.accountUserId || null,
      guestPrincipalId: peer.gateGuestPrincipalId || '',
      roomId
    });
    if (!principal) return false;
    return store.isRoomServerMuted!({ roomId, principal });
  }

  async function joinVoiceRoom(connection: WsConnection, payload: Record<string, any>, sessionUser: SessionUser, clientIp = '', requestId = ''): Promise<JoinResult> {
    const joinRequestSequence = ++voiceJoinRequestSequence;
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
    let leaseClaim = claimReconnectLease(roomId, peerId, sessionToken, joinRequestSequence);
    if (leaseClaim.state === 'busy') {
      return { ok: false, code: 'superseded_join', message: 'Another replacement already owns recovery' };
    }
    if (leaseClaim.state === 'failed-finalizer') {
      try {
        await retryFailedLeaseFinalizer(leaseClaim.record as LeaseRecord);
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
        await (leaseClaim.record as LeaseRecord).finalizerPromise;
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
        reconnectLeases.get((leaseClaim.record as LeaseRecord).key) !== leaseClaim.record
        || (leaseClaim.record as LeaseRecord).state !== 'claimed-by-replacement'
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
        connection.activeVoice
        && (
          connection.activeVoice.roomId !== roomId
          || connection.activeVoice.peerId !== peerId
        )
      ) {
        await leaveVoiceRoom(connection, connection.activeVoice as VoiceTarget, { cancelPendingJoin: false });
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
        claimCompleted = completeClaimedLease(leaseClaim.record as LeaseRecord, transport.id);
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
        logger.error({ evt: LOG_EVENTS.ROOM_OCCUPANCY_PERSIST_FAILED, roomId, err: error }, 'failed to persist room occupancy');
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
        const claimed = leaseClaim.record as LeaseRecord;
        if (terminalClaimFailure) {
          claimed.terminalReason ||= 'join-rejected';
          claimed.state = 'terminal-finalizing';
          startLeaseFinalizer(claimed, claimed.terminalReason);
        } else {
          restoreClaimedLease(claimed);
        }
      }
      finishConnectionVoiceJoin(connection, connectionJoinIntent);
      finishVoiceJoin(joinKey, joinState);
    }
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
    const ownsRequestedPeer = activeVoice?.roomId === payload.roomId
      && activeVoice?.peerId === payload.peerId
      && tokensMatch(activeVoice.sessionToken, sessionToken);
    const peer = presenceRooms.get(payload.roomId)?.peers?.get(payload.peerId);
    const ownsCurrentGeneration = ownsRequestedPeer
      && peer
      && tokensMatch(peer.sessionToken, sessionToken)
      && peer.transport?.id === activeVoice!.transportId;
    if (ownsCurrentGeneration) {
      await finalizeReconnectLease({
        roomId: payload.roomId,
        peerId: payload.peerId,
        reason: 'left',
        expectedSessionToken: sessionToken,
        expectedTransportId: activeVoice!.transportId
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

  async function disconnectAccountFromRoom({ roomId, userId, reason = 'left-room' }: { roomId?: string; userId?: string; reason?: string } = {}) {
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
      await cancelAccountReconnectLeases({
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

  async function updatePeerState(connection: WsConnection, payload: Record<string, any>) {
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
  async function sendAccountSummaries(connection: WsConnection, userId: string): Promise<void> {
    if (!userId) return;
    let rooms: Awaited<ReturnType<RuntimeRoomStore['listVisibleRoomsForUser']>> = [];
    try {
      rooms = await getRoomStore().listVisibleRoomsForUser(userId);
    } catch (error) {
      logger.error({ evt: LOG_EVENTS.WS_SUMMARY_LOAD_FAILED, userId, err: error }, 'failed to list rooms for the ws ready summaries');
      return;
    }
    for (const dbRoom of rooms) {
      const presence = presenceRooms.get(dbRoom!.id);
      const peers = presence ? Array.from(presence.peers.values()).map(publicPeer) : [];
      const unreadCount = Number.isFinite(dbRoom!.unreadCount)
        ? dbRoom!.unreadCount
        : await resolveRoomUnreadCount(dbRoom!.id, userId);
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
      const lease = createReconnectLease(activeVoice as VoiceTarget);
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
    broadcastRoomTyping,
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

export type RoomRealtimeRuntime = ReturnType<typeof createRoomRealtimeRuntime>;

export { clearViewedScreenPeerReferences, createRoomRealtimeRuntime, resolveViewedScreenPeerId };
