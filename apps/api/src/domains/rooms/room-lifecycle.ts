// What happens around a room after the database changed it: the lobby card
// and room.updated event, peers picking up a new profile, invitations that
// die with the room, and tearing a deleted room down.

import { buildServerEnvelope } from '@voice-room/shared/realtime';
import type { DirectMessage as StoredDirectMessage } from '../social/social-records.ts';
import type { AccountMessage } from '../../realtime/account-events.ts';
import type { Logger } from 'pino';
import { LOG_EVENTS } from '../../lib/log-events.ts';
import type { RoomPresence, RosterPeer } from '../../realtime/room-presence.ts';
import { avatarUrl } from '../../lib/avatar-url.ts';
import { publicLobbyRoom, publicPeer, type StoredRoom } from './room-views.ts';
import { markOwnershipFinalized } from './peer-eviction.ts';

interface RoomRuntime {
  invalidateRecipientCache(roomId: string): void;
  scheduleSummaryBroadcast(roomId: string): void;
  cancelRoomReconnectLeases(input: {
    roomId: string;
    reason: 'deleted';
    finalizePeer(input: { peer?: RosterPeer | null; ownershipFinalized: boolean }): Promise<{ finalized: boolean }>;
  }): Promise<unknown>;
}

export interface ProfileUser {
  id: string;
  displayName?: string;
  login?: string;
  avatarKey?: string | null;
  avatarAccent?: string | null;
  avatarColorKey?: string | null;
  [key: string]: unknown;
}

export interface RoomLifecycleDeps {
  presence: RoomPresence;
  runtime(): RoomRuntime | null;
  /** The friend store while pending room invitations can expire, else null. */
  invitations(): {
    expirePendingInvites(input: { senderId: string | null; roomId: string }): Promise<StoredDirectMessage[]>;
  } | null;
  notifyUser(userId: string, event: AccountMessage): void;
  /** Null without a gate secret; teardown then fails that peer's revocation. */
  credentials(): {
    revokePeer(input: { roomId: string; accountUserId: string | null; guestPrincipalId: string }): Promise<unknown>;
  } | null;
  removeParticipant(roomId: string, peerId: string): Promise<void>;
  removeAvatar(key: string | null | undefined, log: Pick<Logger, 'error'> | undefined): Promise<void>;
  displayName(user: ProfileUser): string;
  logger(): Pick<Logger, 'error'>;
}

export function createRoomLifecycle(deps: RoomLifecycleDeps) {
  const { presence } = deps;

  function lobbyRoom(room: StoredRoom) {
    return publicLobbyRoom(room, presence.rooms.get(room.id)?.peers.size ?? 0);
  }

  /** Tells the room, its preview watchers and the lobby; returns the card it sent. */
  function announceRoomUpdate(roomId: string, room: StoredRoom) {
    const payload = lobbyRoom(room);
    presence.publish(roomId, buildServerEnvelope('room.updated', { room: payload }));
    deps.runtime()?.invalidateRecipientCache(roomId);
    deps.runtime()?.scheduleSummaryBroadcast(roomId);
    return payload;
  }

  // Every seat the account holds, in any room, shows the new name and avatar.
  function refreshActiveProfile(user: ProfileUser | null | undefined): void {
    if (!user?.id) return;
    const url = avatarUrl(user.avatarKey);
    for (const [roomId, room] of presence.rooms) {
      for (const peer of room.peers.values()) {
        if (peer.accountUserId !== user.id) continue;
        peer.name = deps.displayName(user);
        peer.avatarAccent = user.avatarAccent || null;
        peer.avatarColorKey = user.avatarColorKey || peer.avatarColorKey;
        peer.avatarUrl = url;
        presence.publish(roomId, buildServerEnvelope('room.peer.updated', { roomId, peer: publicPeer(peer) }));
        deps.runtime()?.scheduleSummaryBroadcast(roomId);
      }
    }
  }

  // senderId narrows the expiry to one inviter; null expires every pending
  // invitation for the room (the room itself went away).
  async function expireRoomInvitations(senderId: string | null, roomId: string) {
    if (!roomId) return [];
    const store = deps.invitations();
    if (!store) return [];
    const messages = await store.expirePendingInvites({ senderId: senderId || null, roomId });
    for (const message of messages) {
      const event: AccountMessage = { type: 'dm.message.edited', message };
      deps.notifyUser(message.senderId, event);
      deps.notifyUser(message.recipientId, event);
    }
    return messages;
  }

  // Everything after the durable soft-delete: tell whoever watches, expire
  // its invitations, drop every peer and remove the avatar. Shared by the
  // owner's delete and by rooms nobody inherits from a deleted account.
  async function finishRoomDeletion(
    roomId: string,
    {
      avatarKey = null,
      request = null
    }: { avatarKey?: string | null; request?: { log?: Pick<Logger, 'warn' | 'error'> } | null } = {}
  ): Promise<void> {
    // Broadcast before presence teardown so the writes do not race socket close.
    presence.publish(roomId, buildServerEnvelope('room.deleted', { roomId }));
    deps.runtime()?.invalidateRecipientCache(roomId);
    // Invitations outlive the inviter's session, so the deleted room is the
    // only thing left that can invalidate them.
    void expireRoomInvitations(null, roomId).catch((error: unknown) => {
      deps
        .logger()
        .error({ evt: LOG_EVENTS.ROOM_INVITATION_EXPIRY_FAILED, err: error }, 'failed to expire room invitations');
    });

    // Terminal-claim every active or leased peer before credential or
    // transport teardown, so a delayed replacement join cannot resurrect the room.
    try {
      await deps.runtime()?.cancelRoomReconnectLeases({
        roomId,
        reason: 'deleted',
        finalizePeer: async ({ peer, ownershipFinalized }) => {
          if (!peer || ownershipFinalized) return { finalized: ownershipFinalized };
          let failure: unknown = null;
          try {
            const credentials = deps.credentials();
            if (!credentials) throw new Error('No gate credential boundary to revoke the peer');
            await credentials.revokePeer({
              roomId,
              accountUserId: peer.accountUserId || null,
              guestPrincipalId: peer.gateGuestPrincipalId || ''
            });
          } catch (error) {
            failure = error;
          }
          presence.closePeer(roomId, peer.id, peer.transport?.id, 'deleted');
          try {
            await deps.removeParticipant(roomId, peer.id);
          } catch (error) {
            failure ||= error;
          }
          if (failure) throw markOwnershipFinalized(failure);
          return { finalized: true };
        }
      });
    } catch {
      // The deletion is durable and peer ownership terminal; cleanup kept
      // going even when a credential revoke failed.
      request?.log?.warn({ code: 'room_delete_peer_cleanup_failed' }, 'Room peer cleanup finished with errors');
    }
    await deps.removeAvatar(avatarKey, request?.log);
  }

  return { lobbyRoom, announceRoomUpdate, refreshActiveProfile, expireRoomInvitations, finishRoomDeletion };
}

export type RoomLifecycle = ReturnType<typeof createRoomLifecycle>;
