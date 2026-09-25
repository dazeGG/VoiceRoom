// What a room owner can do to someone in their room: kick, mute their
// microphone at the SFU, ban, and undo a ban. The caller has already checked
// that the room exists and the actor owns it; this returns what happened and
// leaves the HTTP answer to the route.

import type { RoomPeerMessage } from '../../realtime/legacy-events.ts';
import type { Logger } from 'pino';
import type { GatePrincipal } from '../admission/admission.service.ts';
import { isGatePrincipal } from '../admission/gate-principal.ts';
import type { ServerMuteResult } from '../admission/livekit-admin.ts';
import type { LiveKitConfig } from '../admission/livekit-config.ts';
import type { PeerEviction } from './peer-eviction.ts';
import type { LiveRoom, PresencePeer } from './room-views.ts';

type BanResult = { status: 'created' | 'cap_exceeded' | string; ban?: { id: string } | null; revocations?: unknown[] };

export interface PeerModerationStore {
  setRoomServerMute(input: {
    roomId: string;
    principal: GatePrincipal;
    mutedBy: string | null | undefined;
  }): Promise<{ status: string }>;
  clearRoomServerMute(input: { roomId: string; principal: GatePrincipal }): Promise<{ status: string }>;
  createRoomBan(input: { roomId: string; userId: string | null; ip: string; maxBans: number }): Promise<BanResult>;
  createRoomBanWithLiveKitGateRevocations?(input: {
    roomId: string;
    userId: string | null;
    ip: string;
    maxBans: number;
    principals: GatePrincipal[];
  }): Promise<BanResult>;
  deleteRoomBan(input: { roomId: string; banId: string }): Promise<{ status: string }>;
}

export interface PeerModerationDeps {
  store(): PeerModerationStore;
  eviction: PeerEviction;
  gatePrincipalForPeer(roomId: string, peer: PresencePeer): GatePrincipal | null;
  livekitConfig(): LiveKitConfig;
  revokeForServerMute(input: {
    roomId: string;
    peerId: string;
    principal: GatePrincipal;
    log: Pick<Logger, 'error'>;
  }): Promise<void>;
  setParticipantMuted(roomId: string, peerId: string, muted: boolean): Promise<ServerMuteResult>;
  /** Tells the room (and its preview watchers) that a peer changed. */
  announcePeerUpdated(room: LiveRoom, peer: PresencePeer): void;
  notifyPeer(peer: PresencePeer, event: RoomPeerMessage): void;
  maxBans: number;
  logger(): Pick<Logger, 'error'>;
}

/** Refusals shared by every action that targets a peer. */
export type TargetRefusal = 'peer_not_found' | 'owner';

export type KickResult = { status: 'kicked' } | { status: TargetRefusal };
export type ServerMuteOutcome = { status: 'applied'; muted: boolean } | { status: TargetRefusal | 'unsupported' };
export type BanOutcome =
  | { status: 'banned'; banId: string; cleanupFailed: boolean }
  | {
      status: TargetRefusal | 'ban_limit' | 'ban_rejected' | 'ban_failed' | 'principal_missing' | 'revoke_unavailable';
    };

type BanError = Error & { code?: string; rollbackTerminal?: boolean };

function banError(code: 'room_ban_limit' | 'room_ban_failed'): BanError {
  return Object.assign(new Error(code), { code, rollbackTerminal: true });
}

export function createPeerModerationService(deps: PeerModerationDeps) {
  function findTarget(
    room: LiveRoom,
    peerId: string
  ): { status: TargetRefusal } | { status: 'found'; peer: PresencePeer } {
    const peer = peerId ? room.peers.get(peerId) : undefined;
    if (!peer) return { status: 'peer_not_found' };
    if (peer.accountUserId && peer.accountUserId === room.ownerId) return { status: 'owner' };
    return { status: 'found', peer };
  }

  async function kick(room: LiveRoom, peerId: string): Promise<KickResult> {
    const target = findTarget(room, peerId);
    if (target.status !== 'found') return target;
    await deps.eviction.disconnect(room, target.peer, 'room.kicked');
    return { status: 'kicked' };
  }

  // Microphone only; lifting the mute does not unmute the participant, they
  // decide when to speak again.
  async function setServerMute(room: LiveRoom, peerId: string, muted: boolean): Promise<ServerMuteOutcome> {
    const target = findTarget(room, peerId);
    if (target.status !== 'found') return target;
    const { peer } = target;

    const principal = deps.gatePrincipalForPeer(room.id, peer);
    if (!isGatePrincipal(principal)) return { status: 'unsupported' };

    const store = deps.store();
    const result = muted
      ? await store.setRoomServerMute({ roomId: room.id, principal, mutedBy: room.ownerId })
      : await store.clearRoomServerMute({ roomId: room.id, principal });
    if (result.status === 'invalid') return { status: 'unsupported' };

    peer.serverMuted = muted;
    if (muted) peer.muted = true;

    // Every gate credential issued before the mute was paired with a JWT that
    // still grants the microphone. Revoke them so a reconnect has to fetch a
    // fresh admission, which the durable mute row keeps microphone-free.
    if (muted) await deps.revokeForServerMute({ roomId: room.id, peerId: peer.id, principal, log: deps.logger() });
    await deps.setParticipantMuted(room.id, peer.id, muted);

    // The peer learns it from the same peer-updated everyone gets.
    deps.announcePeerUpdated(room, peer);
    return { status: 'applied', muted };
  }

  // An authenticated participant is a durable account identity, so the ban
  // does not also take their current IP: users behind the same NAT (the owner
  // included) would be banned as collateral. Guests have no account identity,
  // so their ban stays IP-scoped.
  async function ban(room: LiveRoom, peerId: string): Promise<BanOutcome> {
    const target = findTarget(room, peerId);
    if (target.status !== 'found') return target;
    const { peer } = target;
    const roomId = room.id;
    const bannedUserId = peer.accountUserId || null;
    const bannedIp = bannedUserId ? '' : peer.ip || '';
    const matchingPeers = [...room.peers.values()].filter((candidate) =>
      bannedUserId ? candidate.accountUserId === bannedUserId : Boolean(bannedIp && candidate.ip === bannedIp)
    );

    // With the strict gate, the ban row and the gate revocations commit in one
    // transaction, so no banned peer keeps a credential that still verifies.
    const livekit = deps.livekitConfig();
    const strictGate = livekit.enabled && livekit.gateSecret?.length >= 32;
    const store = deps.store();
    let persist: () => Promise<BanResult>;
    if (strictGate) {
      const principals: GatePrincipal[] = [];
      for (const candidate of matchingPeers) {
        const principal = deps.gatePrincipalForPeer(roomId, candidate);
        if (!isGatePrincipal(principal)) return { status: 'principal_missing' };
        principals.push(principal);
      }
      const createWithRevocations = store.createRoomBanWithLiveKitGateRevocations;
      if (principals.length === 0 || typeof createWithRevocations !== 'function')
        return { status: 'revoke_unavailable' };
      persist = () =>
        createWithRevocations.call(store, {
          roomId,
          userId: bannedUserId,
          ip: bannedIp,
          maxBans: deps.maxBans,
          principals
        });
    } else {
      persist = () => store.createRoomBan({ roomId, userId: bannedUserId, ip: bannedIp, maxBans: deps.maxBans });
    }

    let result: BanResult | null = null;
    try {
      await deps.eviction.finalize(room, matchingPeers, 'room.banned', {
        gateAlreadyRevoked: strictGate,
        beforeFinalize: async () => {
          try {
            result = await persist();
          } catch (error) {
            (error as BanError).rollbackTerminal = true;
            throw error;
          }
          if (result.status === 'cap_exceeded') throw banError('room_ban_limit');
          const revoked = !strictGate || (Array.isArray(result.revocations) && result.revocations.length > 0);
          if (!result.ban || !revoked) throw banError('room_ban_failed');
          return result;
        }
      });
    } catch (error) {
      const code = (error as BanError | null)?.code;
      if (code === 'room_ban_limit') return { status: 'ban_limit' };
      if (code === 'room_ban_failed') return { status: 'ban_rejected' };
      const persisted = result as BanResult | null;
      if (!persisted?.ban) return { status: 'ban_failed' };
      // The ban is durable and peer teardown is terminal even when a step of
      // it failed; the route only reports it.
      return { status: 'banned', banId: persisted.ban.id, cleanupFailed: true };
    }
    const persisted = result as BanResult | null;
    if (!persisted?.ban) return { status: 'ban_failed' };
    return { status: 'banned', banId: persisted.ban.id, cleanupFailed: false };
  }

  async function undoBan(roomId: string, banId: string): Promise<{ status: 'deleted' | 'not_found' }> {
    const deleted = await deps.store().deleteRoomBan({ roomId, banId });
    return { status: deleted.status === 'deleted' ? 'deleted' : 'not_found' };
  }

  return { kick, setServerMute, ban, undoBan };
}

export type PeerModerationService = ReturnType<typeof createPeerModerationService>;
