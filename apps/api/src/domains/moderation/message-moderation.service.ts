import type pg from 'pg';
import { kyselyOn } from '../../platform/db/kysely.ts';
import { transaction } from '../../platform/db/pool.ts';

type QueryClient = Pick<pg.PoolClient, 'query'>;
type Loose = Record<string, unknown>;
type RevokedAttachment = { id?: string } | null | undefined;

type RevokeInput = { roomId: string; messageId: string; at: Date; client: QueryClient };
type CleanupInput = RevokeInput & { attachments: RevokedAttachment[] };
type Revoker = (input: RevokeInput) => Promise<RevokedAttachment[] | null | undefined>;
type CleanupEnqueuer = (input: CleanupInput) => Promise<unknown>;

export type MessageDeletion = { roomId: string; messageId: string; deletedAt: number };
export type MessageDeletionOutcome =
  | { status: 'invalid' | 'forbidden' | 'not_found'; deletion: null }
  | { status: 'deleted' | 'already_deleted'; deletion: MessageDeletion };

function requireOperation<T>(target: Loose | null | undefined, names: string[], label: string): T {
  for (const name of names) {
    if (typeof target?.[name] === 'function')
      return (target[name] as (...args: unknown[]) => unknown).bind(target) as T;
  }
  throw new TypeError(`${label} is required`);
}

function attachmentRevoker(input: unknown): Revoker {
  const repository = input as Loose | null | undefined;
  if (repository?.revokeForRoomMessage || repository?.revokeForMessage) {
    return requireOperation<Revoker>(
      repository,
      ['revokeForRoomMessage', 'revokeForMessage'],
      'An attachment revocation operation'
    );
  }
  if (repository?.listForMessage && repository?.markDeleted) {
    const attachments = repository as {
      listForMessage(context: 'room', messageId: string, options: { client: QueryClient }): Promise<{ id: string }[]>;
      markDeleted(id: string, client: QueryClient): Promise<RevokedAttachment>;
    };
    return async ({ messageId, client }) => {
      const listed = await attachments.listForMessage('room', messageId, { client });
      const revoked: RevokedAttachment[] = [];
      for (const attachment of listed) {
        revoked.push(await attachments.markDeleted(attachment.id, client));
      }
      return revoked;
    };
  }
  throw new TypeError('An attachment revocation operation is required');
}

function cleanupEnqueuer(input: unknown): CleanupEnqueuer {
  const repository = input as Loose | null | undefined;
  if (repository?.enqueueCleanupForRoomMessage || repository?.enqueueCleanupForAttachments) {
    return requireOperation<CleanupEnqueuer>(
      repository,
      ['enqueueCleanupForRoomMessage', 'enqueueCleanupForAttachments'],
      'A media cleanup enqueue operation'
    );
  }
  if (repository?.enqueue) {
    const jobs = repository as {
      enqueue(id: string, options: { kind: 'cleanup'; availableAt: Date; client: QueryClient }): Promise<unknown>;
    };
    return async ({ attachments, at, client }) => {
      const queued: unknown[] = [];
      for (const attachment of attachments) {
        if (attachment?.id)
          queued.push(await jobs.enqueue(attachment.id, { kind: 'cleanup', availableAt: at, client }));
      }
      return queued;
    };
  }
  throw new TypeError('A media cleanup enqueue operation is required');
}

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
  attachmentRepository?: unknown;
  mediaJobRepository?: unknown;
  publishMessageDeleted?: (deletion: MessageDeletion) => unknown;
  now?: () => number;
} = {}) {
  if (!pool?.connect || !moderationService?.authorizeOwner) {
    throw new TypeError('Message moderation requires a pool and moderation service');
  }
  const owners = moderationService;
  const revokeAttachments = attachmentRevoker(attachmentRepository);
  const enqueueCleanup = cleanupEnqueuer(mediaJobRepository);

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
    const timestamp = new Date(now());
    const result = await transaction(pool, async (client: pg.PoolClient): Promise<MessageDeletionOutcome> => {
      if (!(await owners.authorizeOwner(roomId, actorUserId, { client }))) {
        return { status: 'forbidden', deletion: null };
      }
      const trx = kyselyOn(client);
      const message = await trx
        .selectFrom('room_messages')
        .select(['id', 'room_id', 'deleted_at'])
        .where('room_id', '=', roomId)
        .where('id', '=', messageId)
        .limit(1)
        .forUpdate()
        .executeTakeFirst();
      if (!message) return { status: 'not_found', deletion: null };

      if (!message.deleted_at) {
        await trx
          .updateTable('room_messages')
          .set({ deleted_at: timestamp })
          .where('room_id', '=', roomId)
          .where('id', '=', messageId)
          .where('deleted_at', 'is', null)
          .execute();
      }
      const attachments = await revokeAttachments({ roomId, messageId, at: timestamp, client });
      await enqueueCleanup({ roomId, messageId, attachments: attachments || [], at: timestamp, client });
      return {
        status: message.deleted_at ? 'already_deleted' : 'deleted',
        deletion: { roomId, messageId, deletedAt: timestamp.getTime() }
      };
    });

    if (result.deletion) await publishMessageDeleted(result.deletion);
    return result;
  }

  return Object.freeze({ deleteRoomMessage });
}

export type MessageModerationService = ReturnType<typeof createMessageModerationService>;

export { createMessageModerationService };
