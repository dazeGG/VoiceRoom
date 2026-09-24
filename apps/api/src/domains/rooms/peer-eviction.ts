// Removing a peer from a room for moderation (kick or ban): revoke its gate
// credential, tell it and its account, close its voice seat and remove it from
// the SFU. Every step runs even when an earlier one fails, and the first
// failure is rethrown marked `ownershipFinalized` so the reconnect lease does
// not hand the seat back.

import type { LiveRoom, PresencePeer } from './room-views.ts';

export type EvictionType = 'room.kicked' | 'room.banned';

export interface EvictionStore {
  revokeLiveKitGatePeer?(input: { roomId: string; peerId: string; accountUserId: string | null; guestPrincipalId: string }): Promise<unknown>;
  invalidatePeerIdentity?(input: { roomId: string; peerId: string }): Promise<unknown>;
}

export interface ReconnectRuntime {
  finalizeReconnectPeers(input: {
    roomId: string;
    peerIds: string[];
    reason: string;
    finalizePeer(input: { peerId: string; peer?: PresencePeer | null; ownershipFinalized: boolean }): Promise<{ finalized: boolean }>;
  }): Promise<unknown>;
}

export interface PeerEvictionDeps {
  store(): EvictionStore;
  /** Null until createApiApp builds the realtime runtime. */
  runtime(): ReconnectRuntime | null;
  notifyPeer(peer: PresencePeer, event: Record<string, unknown>): void;
  notifyUser(userId: string, event: Record<string, unknown>): void;
  /** Drops the voice seat any socket of this peer still holds in the room. */
  detachVoiceConnections(roomId: string, peerId: string): void;
  closePeer(roomId: string, peerId: string, transportId: string | undefined, reason: string): void;
  removeParticipant(roomId: string, peerId: string): Promise<void>;
}

export interface FinalizeOptions<T> {
  /** The gate credentials were revoked already, in the ban's own transaction. */
  gateAlreadyRevoked?: boolean;
  /**
   * Runs once, before the first peer is torn down; its result is returned.
   * A ban is persisted here so no peer leaves before the ban exists.
   */
  beforeFinalize?: (() => Promise<T>) | null;
}

type OwnershipError = Error & { ownershipFinalized?: boolean };

export function createPeerEviction(deps: PeerEvictionDeps) {
  async function evictPeer(room: Pick<LiveRoom, 'id'>, peer: PresencePeer, type: EvictionType, { gateAlreadyRevoked, ownershipFinalized }: { gateAlreadyRevoked: boolean; ownershipFinalized: boolean }) {
    const store = deps.store();
    let failure: unknown = null;
    if (!ownershipFinalized && !gateAlreadyRevoked && typeof store.revokeLiveKitGatePeer === 'function') {
      try {
        await store.revokeLiveKitGatePeer({
          roomId: room.id,
          peerId: peer.id,
          accountUserId: peer.accountUserId || null,
          guestPrincipalId: peer.gateGuestPrincipalId || ''
        });
      } catch (error) {
        failure = error;
      }
    }
    const event = { type, roomId: room.id, peerId: peer.id };
    deps.notifyPeer(peer, event);
    if (peer.accountUserId) deps.notifyUser(peer.accountUserId, event);
    deps.detachVoiceConnections(room.id, peer.id);
    if (!ownershipFinalized) {
      deps.closePeer(room.id, peer.id, peer.transport?.id, type === 'room.banned' ? 'banned' : 'kicked');
    }
    if (typeof store.invalidatePeerIdentity === 'function') {
      try {
        await store.invalidatePeerIdentity({ roomId: room.id, peerId: peer.id });
      } catch (error) {
        failure ||= error;
      }
    }
    if (!ownershipFinalized) {
      try {
        await deps.removeParticipant(room.id, peer.id);
      } catch (error) {
        failure ||= error;
      }
    }
    if (failure) {
      (failure as OwnershipError).ownershipFinalized = true;
      throw failure;
    }
    return { finalized: true };
  }

  async function finalize<T = null>(
    room: Pick<LiveRoom, 'id'>,
    peers: PresencePeer[],
    type: EvictionType,
    { gateAlreadyRevoked = false, beforeFinalize = null }: FinalizeOptions<T> = {}
  ): Promise<T | null> {
    let prerequisite: Promise<T> | null = null;
    let prerequisiteResult: T | null = null;
    const peerById = new Map(peers.map((peer) => [peer.id, peer]));
    const ensurePrerequisite = async () => {
      if (!beforeFinalize) return;
      prerequisite ||= Promise.resolve().then(beforeFinalize);
      prerequisiteResult = await prerequisite;
    };
    await deps.runtime()!.finalizeReconnectPeers({
      roomId: room.id,
      peerIds: peers.map((peer) => peer.id),
      reason: type,
      finalizePeer: async ({ peerId, peer: ownedPeer, ownershipFinalized }) => {
        await ensurePrerequisite();
        const target = ownedPeer || peerById.get(peerId);
        if (!target) return { finalized: ownershipFinalized };
        return evictPeer(room, target, type, { gateAlreadyRevoked, ownershipFinalized });
      }
    });
    return prerequisiteResult;
  }

  async function disconnect(room: Pick<LiveRoom, 'id'>, peer: PresencePeer, type: EvictionType, { gateAlreadyRevoked = false } = {}): Promise<void> {
    await finalize(room, [peer], type, { gateAlreadyRevoked });
  }

  return { finalize, disconnect };
}

export type PeerEviction = ReturnType<typeof createPeerEviction>;
