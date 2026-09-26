// Reconnect leases: a voice peer whose socket drops keeps its seat for a
// short lease. A replacement socket with the same session claims the lease;
// otherwise it expires and the peer is finalized (credentials revoked,
// transport closed, LiveKit participant removed). Leaving, deletion and
// membership loss end leases terminally. Every transition is a synchronous
// compare-and-set on the record before any await.

import { normalizePeerId, normalizeRoomId, normalizeSessionToken } from '@voice-room/shared/validation';
import { unrefTimer } from './runtime-types.ts';
import type {
  FinalizeError,
  FinalizePeer,
  FinalizeResult,
  LeaseClaim,
  LeaseRecord,
  Peer,
  PresenceRoom,
  Timer,
  VoiceTarget
} from './runtime-types.ts';

export interface ReconnectLeaseDeps {
  presenceRooms: Map<string, PresenceRoom>;
  tokensMatch: (expected: string | null | undefined, actual: string | null | undefined) => boolean;
  now: () => number;
  setTimeout(this: void, callback: () => void, ms: number): Timer;
  clearTimeout(this: void, timer: Timer): void;
  /** Requested lease length; outside 1–120 s it falls back to 30 s. */
  leaseMs: number;
  /** Ends a peer the lease still owns when nobody reclaimed it. */
  finalizeOwnedPeer: (input: { record: LeaseRecord; peer: Peer; reason: string }) => Promise<unknown>;
  /** The latest voice join request; a terminal lease blocks joins issued before it. */
  joinSequence: () => number;
}

export function createReconnectLeases(deps: ReconnectLeaseDeps) {
  const { presenceRooms, tokensMatch, now, setTimeout: scheduleTimeout, clearTimeout: cancelTimeout } = deps;
  const reconnectLeases = new Map<string, LeaseRecord>();
  const leaseDurationMs =
    Number.isInteger(deps.leaseMs) && deps.leaseMs >= 1000 && deps.leaseMs <= 120000 ? deps.leaseMs : 30000;
  let reconnectLeaseGeneration = 0;

  function reconnectLeaseKey(roomId: string, peerId: string, sessionToken: string): string {
    return `${roomId}\u0000${peerId}\u0000${sessionToken}`;
  }

  function currentLeasePeer(record: LeaseRecord): Peer | null {
    const peer = presenceRooms.get(record.roomId)?.peers?.get(record.peerId);
    if (!peer || !tokensMatch(peer.sessionToken, record.sessionToken) || peer.transport?.id !== record.transportId) {
      return null;
    }
    return peer;
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
    unrefTimer(record.timer);
  }

  async function runLeaseFinalizer(
    record: LeaseRecord,
    reason: string,
    finalizePeer: FinalizePeer | null
  ): Promise<FinalizeResult> {
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
            await deps.finalizeOwnedPeer({ record, peer: ownedPeer, reason });
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
          if (!ownershipFinalized)
            ownershipFinalized = (result as { finalized?: boolean } | undefined)?.finalized !== false;
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
        unrefTimer(record.timer);
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
      !peer ||
      peer.transport?.id !== activeVoice.transportId ||
      !tokensMatch(peer.sessionToken, activeVoice.sessionToken)
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

  function claimReconnectLease(
    roomId: string,
    peerId: string,
    sessionToken: string,
    joinRequestSequence: number
  ): LeaseClaim {
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
      reconnectLeases.get(record.key) !== record ||
      record.state !== 'claimed-by-replacement' ||
      now() >= record.deadline ||
      !currentLeasePeer(record)
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

  function terminalClaimRecord(
    record: LeaseRecord,
    reason: string,
    finalizePeer: FinalizePeer | null | undefined
  ): LeaseRecord {
    const adoptingFailedFinalizer = record.state === 'finalizer-failed' || record.state === 'terminal-finalizer-failed';
    record.terminalReason ||= reason;
    if (record.timer) cancelTimeout(record.timer);
    record.timer = null;
    record.terminalAtJoinSequence ||= deps.joinSequence();
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

  function recordsForPeer(
    roomId: string,
    peerId: string,
    {
      expectedSessionToken = '',
      expectedTransportId = ''
    }: { expectedSessionToken?: string; expectedTransportId?: string } = {}
  ): LeaseRecord[] {
    const peer = presenceRooms.get(roomId)?.peers?.get(peerId) || null;
    if (
      peer &&
      ((expectedSessionToken && !tokensMatch(peer.sessionToken, expectedSessionToken)) ||
        (expectedTransportId && peer.transport?.id !== expectedTransportId))
    ) {
      return [];
    }
    const records = [...reconnectLeases.values()].filter(
      (record) =>
        record.roomId === roomId &&
        record.peerId === peerId &&
        record.state !== 'terminal' &&
        (!peer || (tokensMatch(record.sessionToken, peer.sessionToken) && record.transportId === peer.transport?.id))
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
    const settled = await Promise.allSettled(records.map((record) => runLeaseFinalizer(record, reason, null)));
    const rejected = settled.find((result) => result.status === 'rejected');
    if (rejected) throw rejected.reason;
    return settled.map((result) => (result as PromiseFulfilledResult<FinalizeResult>).value);
  }

  async function finalizeReconnectLease(
    {
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
    } = {} as { roomId: string; peerId: string }
  ) {
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

    const record = reconnectLeases.get(reconnectLeaseKey(normalizedRoomId, normalizedPeerId, normalizedSessionToken));
    // A leave replayed by a fresh application socket may only terminate the
    // disconnected transport's existing lease. Never synthesize a lease here:
    // doing so would let a delayed leave tear down a newer active replacement.
    if (
      !record ||
      !record.disconnected ||
      !['pending', 'finalizer-failed', 'terminal-finalizer-failed'].includes(record.state)
    ) {
      return { ok: true, finalized: false };
    }

    terminalClaimRecord(record, reason, null);
    const [result] = await settleLeaseFinalizers([record], reason);
    return { ok: true, finalized: Boolean(result?.finalized) };
  }

  async function cancelRoomReconnectLeases(
    {
      roomId,
      reason = 'deleted',
      finalizePeer = null
    }: { roomId: string; reason?: string; finalizePeer?: FinalizePeer | null } = {} as { roomId: string }
  ) {
    const peerIds = new Set([
      ...[...reconnectLeases.values()].filter((record) => record.roomId === roomId).map((record) => record.peerId),
      ...[...(presenceRooms.get(roomId)?.peers?.keys?.() || [])]
    ]);
    const records = [...peerIds].flatMap((peerId) => recordsForPeer(roomId, peerId));
    for (const record of records) terminalClaimRecord(record, reason, finalizePeer);
    const results = await settleLeaseFinalizers(records, reason);
    return { ok: true, finalized: results.filter((result) => result.finalized).length };
  }

  async function cancelAccountReconnectLeases(
    {
      roomId,
      userId,
      reason = 'membership-left',
      finalizePeer = null
    }: { roomId: string; userId: string; reason?: string; finalizePeer?: FinalizePeer | null } = {} as {
      roomId: string;
      userId: string;
    }
  ) {
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

  async function finalizeReconnectPeers(
    {
      roomId,
      peerIds = [],
      reason,
      finalizePeer
    }: { roomId: string; peerIds?: string[]; reason: string; finalizePeer?: FinalizePeer | null } = {} as {
      roomId: string;
      reason: string;
    }
  ) {
    const records = [...new Set(peerIds)].flatMap((peerId) => recordsForPeer(roomId, peerId));
    for (const record of records) terminalClaimRecord(record, reason, finalizePeer);
    const results = await settleLeaseFinalizers(records, reason);
    return { ok: true, finalized: results.filter((result) => result.finalized).length };
  }

  return {
    isCurrent: (record: LeaseRecord) => reconnectLeases.get(record.key) === record,
    currentPeer: currentLeasePeer,
    create: createReconnectLease,
    claim: claimReconnectLease,
    restoreClaimed: restoreClaimedLease,
    completeClaimed: completeClaimedLease,
    startFinalizer: startLeaseFinalizer,
    retryFailedFinalizer: retryFailedLeaseFinalizer,
    finalize: finalizeReconnectLease,
    finalizePending: finalizePendingReconnectLease,
    cancelRoom: cancelRoomReconnectLeases,
    cancelAccount: cancelAccountReconnectLeases,
    finalizePeers: finalizeReconnectPeers
  };
}

export type ReconnectLeases = ReturnType<typeof createReconnectLeases>;
