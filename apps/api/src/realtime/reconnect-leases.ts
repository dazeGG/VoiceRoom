// Reconnect leases: a voice peer whose socket drops keeps its seat for a
// short lease. A replacement socket with the same session claims the lease;
// otherwise it expires and the peer is finalized (credentials revoked,
// transport closed, LiveKit participant removed). Leaving, deletion and
// membership loss end leases terminally. Every transition is a synchronous
// compare-and-set on the record before any await.

import { unrefTimer } from './runtime-types.ts';
import { fieldOf } from '../platform/record.ts';
import type {
  FinalizePeer,
  FinalizeResult,
  LeaseClaim,
  LeaseReason,
  LeaseRecord,
  Peer,
  PresenceRoom,
  VoiceTarget
} from './runtime-types.ts';
import type { Timer } from '../platform/types.ts';

export interface ReconnectLeaseDeps {
  presenceRooms: Map<string, PresenceRoom>;
  tokensMatch: (expected: string | null | undefined, actual: string | null | undefined) => boolean;
  now: () => number;
  setTimeout(this: void, callback: () => void, ms: number): Timer;
  clearTimeout(this: void, timer: Timer): void;
  /** Requested lease length; outside 1–120 s it falls back to 30 s. */
  leaseMs: number;
  /** Ends a peer the lease still owns when nobody reclaimed it. */
  finalizeOwnedPeer: (input: { record: LeaseRecord; peer: Peer; reason: LeaseReason }) => Promise<unknown>;
  /** The latest voice join request; a terminal lease blocks joins issued before it. */
  joinSequence: () => number;
}

// A finalizer's answer or failure may say the seat is already released.
function ownershipFinalizedBy(result: unknown): boolean {
  return fieldOf(result, 'ownershipFinalized') === true;
}

function finalizedBy(result: unknown): boolean {
  return fieldOf(result, 'finalized') !== false;
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
    reason: LeaseReason,
    finalizePeer: FinalizePeer | null
  ): Promise<FinalizeResult> {
    if (finalizePeer && !record.finalizeCallbacks.includes(finalizePeer)) {
      record.finalizeCallbacks.push(finalizePeer);
    }
    if (record.finalizerPromise) return record.finalizerPromise;

    record.finalizerPromise = (async (): Promise<FinalizeResult> => {
      let ownershipFinalized = false;
      let failure: unknown = null;
      const ownedPeer = currentLeasePeer(record);
      if (ownedPeer) {
        try {
          const primaryCallback = record.terminalReason ? record.finalizeCallbacks.shift() : null;
          if (primaryCallback) {
            const result = await primaryCallback({
              roomId: record.roomId,
              peerId: record.peerId,
              peer: record.peer,
              reason: record.terminalReason || reason,
              ownershipFinalized: false
            });
            ownershipFinalized = finalizedBy(result);
          } else {
            await deps.finalizeOwnedPeer({ record, peer: ownedPeer, reason });
            ownershipFinalized = true;
          }
        } catch (error) {
          failure = error;
          ownershipFinalized = ownershipFinalizedBy(error);
        }
      }

      // A callback queued while an earlier one runs is still reached.
      for (const callback of record.finalizeCallbacks) {
        try {
          const result = await callback({
            roomId: record.roomId,
            peerId: record.peerId,
            peer: record.peer,
            reason: record.terminalReason || reason,
            ownershipFinalized
          });
          if (!ownershipFinalized) ownershipFinalized = finalizedBy(result);
        } catch (error) {
          failure ||= error;
          if (!ownershipFinalized) ownershipFinalized = ownershipFinalizedBy(error);
        }
      }

      if (fieldOf(failure, 'rollbackTerminal') === true && !ownershipFinalized) {
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
        const code = fieldOf(failure, 'code');
        record.finalizerErrorCode = typeof code === 'string' && code ? code : 'reconnect_finalize_failed';
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
      // Rethrown as caught: a finalizer may fail with anything.
      const failed = Boolean(failure);
      if (failed) throw failure;
      return { ok: true, finalized: ownershipFinalized };
    })();
    return record.finalizerPromise;
  }

  function startLeaseFinalizer(record: LeaseRecord, reason: LeaseReason): void {
    void runLeaseFinalizer(record, reason, null).catch(() => {
      // The record remains in a typed failed-finalizer state. Replacement and
      // terminal paths must explicitly retry/adopt it before admission proceeds.
    });
  }

  async function retryFailedLeaseFinalizer(
    record: LeaseRecord,
    reason: LeaseReason = 'lost'
  ): Promise<FinalizeResult | null> {
    if (record.state !== 'finalizer-failed' && record.state !== 'terminal-finalizer-failed') {
      return record.finalizerPromise;
    }
    record.state = record.terminalReason ? 'terminal-finalizing' : 'finalizing-expiry';
    record.finalizerPromise = null;
    record.finalizerErrorCode = '';
    return runLeaseFinalizer(record, record.terminalReason || reason, null);
  }

  function createReconnectLease(activeVoice: VoiceTarget): LeaseRecord | null {
    const { sessionToken, transportId } = activeVoice;
    const room = presenceRooms.get(activeVoice.roomId);
    const peer = room?.peers?.get(activeVoice.peerId);
    // An empty token never matches, so a lease always has one.
    if (!peer || !sessionToken || peer.transport?.id !== transportId || !tokensMatch(peer.sessionToken, sessionToken)) {
      return null;
    }

    const key = reconnectLeaseKey(activeVoice.roomId, activeVoice.peerId, sessionToken);
    const existing = reconnectLeases.get(key);
    if (existing && existing.transportId === activeVoice.transportId) {
      return existing;
    }
    if (existing?.timer) cancelTimeout(existing.timer);

    const record: LeaseRecord = {
      key,
      roomId: activeVoice.roomId,
      peerId: activeVoice.peerId,
      sessionToken,
      transportId,
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
    // Every other state is handled above: the record is terminal.
    const permitsNewJoinIntent = record.terminalReason === 'left';
    if (permitsNewJoinIntent && joinRequestSequence > record.terminalAtJoinSequence) {
      if (record.timer) cancelTimeout(record.timer);
      reconnectLeases.delete(record.key);
      return { state: 'none', record: null };
    }
    return { state: 'terminal', record };
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
    reason: LeaseReason,
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

  // Ends a lease that a refused join had claimed: terminal, its seat finalized.
  function terminateLease(record: LeaseRecord, reason: LeaseReason): void {
    terminalClaimRecord(record, reason, null);
    startLeaseFinalizer(record, record.terminalReason || reason);
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

  async function settleLeaseFinalizers(records: LeaseRecord[], reason: LeaseReason): Promise<FinalizeResult[]> {
    const settled = await Promise.allSettled(records.map((record) => runLeaseFinalizer(record, reason, null)));
    const results: FinalizeResult[] = [];
    for (const result of settled) {
      if (result.status === 'rejected') throw fieldOf(result, 'reason');
      results.push(result.value);
    }
    return results;
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
    reason?: LeaseReason;
    finalizePeer?: FinalizePeer | null;
    expectedSessionToken?: string;
    expectedTransportId?: string;
  }) {
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
  }: {
    roomId: string;
    peerId: string;
    sessionToken: string;
    reason?: LeaseReason;
  }): Promise<FinalizeResult> {
    const record = reconnectLeases.get(reconnectLeaseKey(roomId, peerId, sessionToken));
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

  async function cancelRoomReconnectLeases({
    roomId,
    reason = 'deleted',
    finalizePeer = null
  }: {
    roomId: string;
    reason?: LeaseReason;
    finalizePeer?: FinalizePeer | null;
  }) {
    const peerIds = new Set([
      ...[...reconnectLeases.values()].filter((record) => record.roomId === roomId).map((record) => record.peerId),
      ...[...(presenceRooms.get(roomId)?.peers?.keys?.() || [])]
    ]);
    const records = [...peerIds].flatMap((peerId) => recordsForPeer(roomId, peerId));
    for (const record of records) terminalClaimRecord(record, reason, finalizePeer);
    const results = await settleLeaseFinalizers(records, reason);
    return { ok: true, finalized: results.filter((result) => result.finalized).length };
  }

  async function cancelAccountReconnectLeases({
    roomId,
    userId,
    reason = 'membership-left',
    finalizePeer = null
  }: {
    roomId: string;
    userId: string;
    reason?: LeaseReason;
    finalizePeer?: FinalizePeer | null;
  }) {
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

  async function finalizeReconnectPeers({
    roomId,
    peerIds = [],
    reason,
    finalizePeer
  }: {
    roomId: string;
    peerIds?: string[];
    reason: LeaseReason;
    finalizePeer?: FinalizePeer | null;
  }) {
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
    terminate: terminateLease,
    retryFailedFinalizer: retryFailedLeaseFinalizer,
    finalize: finalizeReconnectLease,
    finalizePending: finalizePendingReconnectLease,
    cancelRoom: cancelRoomReconnectLeases,
    cancelAccount: cancelAccountReconnectLeases,
    finalizePeers: finalizeReconnectPeers
  };
}

export type ReconnectLeases = ReturnType<typeof createReconnectLeases>;
