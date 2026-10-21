import type pg from 'pg';
import {
  revokeMessageAttachments,
  type CleanupJobs,
  type RevocableAttachments
} from '../media/attachment-revocation.service.ts';
import { transaction } from '../../platform/db/pool.ts';
import { lockRoomMessage, tombstoneRoomMessage } from './message-moderation.repository.ts';

type QueryClient = Pick<pg.PoolClient, 'query'>;

/** What deleting a message needs from the media domain's attachment store. */
export type ModerationAttachments = RevocableAttachments;
/** What deleting a message needs from the media job queue. */
export type ModerationMediaJobs = CleanupJobs;

export type MessageDeletion = { roomId: string; messageId: string; deletedAt: number };
export type MessageDeletionOutcome =
  | { status: 'invalid' | 'forbidden' | 'not_found'; deletion: null }
  | { status: 'deleted' | 'already_deleted'; deletion: MessageDeletion };

function createMessageModerationService({
  pool,
  moderationService,
  attachmentRepository,
  mediaJobRepository,
  publishMessageDeleted = () => {},
  now = Date.now
}: {
  pool?: pg.Pool | null;
  moderationService?: {
    authorizeOwner(roomId: string, actorUserId: string, options: { client: QueryClient }): Promise<boolean>;
  };
  attachmentRepository: ModerationAttachments;
  mediaJobRepository: ModerationMediaJobs;
  publishMessageDeleted?: (deletion: MessageDeletion) => unknown;
  now?: () => number;
}) {
  if (!pool?.connect || !moderationService?.authorizeOwner) {
    throw new TypeError('Message moderation requires a pool and moderation service');
  }
  const owners = moderationService;

  async function deleteRoomMessage({
    roomId,
    messageId,
    actorUserId
  }: {
    roomId?: string;
    messageId?: string;
    actorUserId?: string;
  } = {}): Promise<MessageDeletionOutcome> {
    if (!roomId || !messageId || !actorUserId) return { status: 'invalid', deletion: null };
    return remove(roomId, messageId, (client) => owners.authorizeOwner(roomId, actorUserId, { client }));
  }

  // The service operator removes a reported message from any room; the caller
  // has already checked the platform administrator.
  async function removeRoomMessageAsOperator({
    roomId,
    messageId
  }: {
    roomId: string;
    messageId: string;
  }): Promise<MessageDeletionOutcome> {
    if (!roomId || !messageId) return { status: 'invalid', deletion: null };
    return remove(roomId, messageId, async () => true);
  }

  async function remove(
    roomId: string,
    messageId: string,
    authorize: (client: QueryClient) => Promise<boolean>
  ): Promise<MessageDeletionOutcome> {
    const timestamp = new Date(now());
    const result = await transaction(pool, async (client: pg.PoolClient): Promise<MessageDeletionOutcome> => {
      if (!(await authorize(client))) {
        return { status: 'forbidden', deletion: null };
      }
      const message = await lockRoomMessage(client, roomId, messageId);
      if (!message) return { status: 'not_found', deletion: null };
      if (!message.deleted_at) await tombstoneRoomMessage(client, roomId, messageId, timestamp);
      await revokeMessageAttachments({
        attachments: attachmentRepository,
        jobs: mediaJobRepository,
        context: 'room',
        messageId,
        client,
        at: timestamp
      });
      return {
        status: message.deleted_at ? 'already_deleted' : 'deleted',
        deletion: { roomId, messageId, deletedAt: timestamp.getTime() }
      };
    });

    if (result.deletion) await publishMessageDeleted(result.deletion);
    return result;
  }

  return Object.freeze({ deleteRoomMessage, removeRoomMessageAsOperator });
}

export type MessageModerationService = ReturnType<typeof createMessageModerationService>;

export { createMessageModerationService };
