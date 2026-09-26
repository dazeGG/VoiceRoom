// The moderation domain wired together: bans (with the LiveKit credentials
// they revoke in the same transaction) and owner message deletion.

import type pg from 'pg';
import type { ServerEnvelope } from '@voice-room/shared/realtime';
import { buildServerEnvelope } from '../../realtime/envelope.ts';
import type { CursorCodec } from '../../platform/cursor-codec.ts';
import { isGatePrincipal } from '../admission/gate-principal.ts';
import { createAttachmentRepository } from '../media/attachment.repository.ts';
import { createMediaJobRepository } from '../media/media-job.repository.ts';
import type { EvictionType } from '../rooms/peer-eviction.ts';
import type { LiveRoom, PresencePeer } from '../rooms/room-views.ts';
import type { createRoomStore } from '../../lib/room-store.ts';
import { createMessageModerationService } from './message-moderation.service.ts';
import { createModerationRepository } from './moderation.repository.ts';
import { createModerationService } from './moderation.service.ts';

type RoomStore = ReturnType<typeof createRoomStore>;

export interface ModerationModuleDeps {
  pool: pg.Pool;
  cursorCodec: CursorCodec;
  maxActiveBans: number;
  roomStore: () => Pick<RoomStore, 'normalizeGatePrincipal' | 'revokeLiveKitGatePrincipalInTransaction'>;
  getRoom: (roomId: string) => Promise<LiveRoom | null>;
  gatePrincipalForPeer: (roomId: string, peer: PresencePeer) => unknown;
  disconnectPeer: (
    room: LiveRoom,
    peer: PresencePeer,
    type: EvictionType,
    options: { gateAlreadyRevoked?: boolean }
  ) => Promise<unknown>;
  broadcastRoomDetail: (roomId: string, envelope: ServerEnvelope) => void;
}

export function createModerationModule(deps: ModerationModuleDeps) {
  const { pool } = deps;
  const repository = createModerationRepository({ cursorCodec: deps.cursorCodec, pool });
  const service = createModerationService({
    pool,
    repository,
    maxActiveBans: deps.maxActiveBans,
    resolvePrincipals: async ({ roomId, userId, guestIp }) => {
      if (userId) {
        const principal = deps.roomStore().normalizeGatePrincipal({ accountUserId: userId, roomId });
        return isGatePrincipal(principal) ? [principal] : [];
      }
      const room = await deps.getRoom(roomId);
      if (!room || !guestIp) return [];
      return [...room.peers.values()]
        .filter((peer) => !peer.accountUserId && peer.ip === guestIp)
        .map((peer) => deps.gatePrincipalForPeer(roomId, peer))
        .filter(isGatePrincipal);
    },
    // The ban and the credential revocation commit together.
    revokePrincipalInTransaction: ({ client, principal, roomId, now }) =>
      deps.roomStore().revokeLiveKitGatePrincipalInTransaction(client, { principal, roomId, now }),
    afterBanCommitted: async ({ roomId, userId, guestIp }) => {
      const room = await deps.getRoom(roomId);
      if (!room) return;
      const peers = [...room.peers.values()].filter((peer) =>
        userId ? peer.accountUserId === userId : Boolean(guestIp && !peer.accountUserId && peer.ip === guestIp)
      );
      for (const peer of peers) {
        await deps.disconnectPeer(room, peer, 'room.banned', { gateAlreadyRevoked: true });
      }
    }
  });
  const messageService = createMessageModerationService({
    pool,
    moderationService: service,
    attachmentRepository: createAttachmentRepository({ pool }),
    mediaJobRepository: createMediaJobRepository({ pool }),
    // Voice peers and preview watchers both follow the room detail stream, and
    // it is the one that removes a message from the chat.
    publishMessageDeleted: async ({ roomId, messageId }) => {
      deps.broadcastRoomDetail(roomId, buildServerEnvelope('room.chat.deleted', { roomId, messageId }));
    }
  });
  return { messageService, repository, service };
}

export type ModerationModule = ReturnType<typeof createModerationModule>;
