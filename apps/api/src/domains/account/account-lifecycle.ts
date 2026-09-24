// What an account change reaches beyond its own rows: friends seeing a new
// profile, sessions that end taking their sockets and voice seats with them,
// and deletions finished once their grace period is over.

import type { Logger } from 'pino';
import { LOG_EVENTS } from '../../lib/log-events.ts';
import { publicUser } from '../../lib/user-store.ts';
import type { GatePrincipal } from '../admission/admission.service.ts';
import type { ConnectionRegistry, WsConnection } from '../../realtime/registry.ts';
import type { AccountDeletionRepository } from './account-deletion-repository.ts';
import type { StoredRoom } from '../rooms/room-views.ts';

type ActiveVoice = NonNullable<WsConnection['activeVoice']>;

export interface AccountLifecycleDeps {
  friendIds(userId: string): Promise<string[]>;
  notifyUser(userId: string, event: Record<string, unknown>): void;
  sockets(): Pick<ConnectionRegistry, 'findAccountConnections' | 'closeConnections'> | null;
  /** The gate principal of the voice seat a connection holds, if it still has one. */
  seatPrincipal(roomId: string, peerId: string): GatePrincipal | null;
  revokeSeatCredentials(input: { roomId: string; peerId: string; principal: GatePrincipal }): Promise<unknown>;
  leaveVoice(connection: WsConnection, activeVoice: ActiveVoice): Promise<unknown> | undefined;
  removeParticipant(roomId: string, peerId: string): Promise<void>;
  sessionRevokedCloseCode: number;
  deletions(): Pick<AccountDeletionRepository, 'listDueDeletions' | 'finalizeDeletion'> | null;
  findRoom(roomId: string): Promise<StoredRoom | null>;
  announceRoomUpdate(roomId: string, room: StoredRoom): unknown;
  finishRoomDeletion(roomId: string, options: { avatarKey?: string | null }): Promise<void>;
  removeAvatar(key: string | null | undefined): Promise<void>;
  logger(): Pick<Logger, 'error'>;
}

export function createAccountLifecycle(deps: AccountLifecycleDeps) {
  // The friend list, DM threads and pending requests cache the public profile
  // outside a live room. Best effort: a failed lookup must not fail the change.
  async function broadcastProfileToFriends(user: { id: string; [key: string]: unknown } | null | undefined, log?: Pick<Logger, 'error'>): Promise<void> {
    if (!user?.id) return;
    try {
      const message = { type: 'user-updated', user: publicUser(user) };
      for (const friendId of await deps.friendIds(user.id)) deps.notifyUser(friendId, message);
    } catch (error) {
      log?.error({ err: error, userId: user.id }, 'failed to broadcast profile update to friends');
    }
  }

  // An ended session loses its sockets and its voice seat at once, not when
  // the LiveKit token expires. Only that seat's credentials are revoked, so
  // the account's other devices stay connected, even in the same room.
  // Without token hashes every socket of the account closes (the password was
  // replaced); without an account id the hashes alone pick them (sign-out).
  async function endSessionConnections({ userId = null, tokenHashes = null }: { userId?: string | null; tokenHashes?: string[] | null }): Promise<void> {
    const sockets = deps.sockets();
    if (!sockets || (!userId && !Array.isArray(tokenHashes))) return;
    const targets = sockets.findAccountConnections(userId, tokenHashes);
    for (const connection of targets) {
      const activeVoice = connection.activeVoice;
      if (!activeVoice?.roomId || !activeVoice.peerId) continue;
      try {
        const principal = deps.seatPrincipal(activeVoice.roomId, activeVoice.peerId);
        if (principal) await deps.revokeSeatCredentials({ roomId: activeVoice.roomId, peerId: activeVoice.peerId, principal });
        await deps.leaveVoice(connection, activeVoice);
        await deps.removeParticipant(activeVoice.roomId, activeVoice.peerId);
      } catch (error) {
        deps.logger().error({ evt: LOG_EVENTS.ACCOUNT_SESSION_VOICE_END_FAILED, userId, err: error }, 'failed to end voice for an ended account session');
      }
    }
    sockets.closeConnections(targets, deps.sessionRevokedCloseCode, 'Session ended');
  }

  // Deletions past their grace period: rooms go to their heirs, rooms nobody
  // inherits are torn down like an owner's delete, and the avatar file goes.
  async function finalizeDueDeletions(now = Date.now()): Promise<number> {
    const repository = deps.deletions();
    if (!repository) return 0;
    let finished = 0;
    for (const userId of await repository.listDueDeletions({ now })) {
      try {
        const result = await repository.finalizeDeletion({ userId, now });
        if (result.status !== 'deleted') continue;
        finished += 1;
        await deps.removeAvatar(result.avatarKey);
        for (const { roomId } of result.transferredRooms) {
          const room = await deps.findRoom(roomId);
          if (room) deps.announceRoomUpdate(roomId, room);
        }
        for (const { roomId, avatarKey } of result.deletedRooms) {
          await deps.finishRoomDeletion(roomId, { avatarKey });
        }
      } catch (error) {
        deps.logger().error({ evt: LOG_EVENTS.ACCOUNT_DELETION_FAILED, err: error }, 'failed to finish an account deletion');
      }
    }
    return finished;
  }

  return { broadcastProfileToFriends, endSessionConnections, finalizeDueDeletions };
}

export type AccountLifecycle = ReturnType<typeof createAccountLifecycle>;
