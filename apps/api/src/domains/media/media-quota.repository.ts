import type pg from 'pg';
import type { Connectable } from '../../platform/db/connectable.ts';
import { transaction } from '../../platform/db/pool.ts';
import type { AttachmentRepository } from './attachment.repository.ts';

export type QuotaUsage = Awaited<ReturnType<AttachmentRepository['quotaUsage']>>;

function createMediaQuotaRepository({
  attachmentRepository: attachments,
  pool: db
}: {
  attachmentRepository: Pick<AttachmentRepository, 'quotaUsage' | 'lockOwner'>;
  pool: Connectable;
}) {
  async function withOwnerReservation<T>(
    ownerId: string,
    operation: (input: { client: pg.PoolClient; usage: QuotaUsage }) => Promise<T>
  ): Promise<T> {
    return transaction(db, async (client) => {
      await attachments.lockOwner(ownerId, client);
      const usage = await attachments.quotaUsage(ownerId, { client });
      return operation({ client, usage });
    });
  }

  return Object.freeze({ withOwnerReservation });
}

export type MediaQuotaRepository = ReturnType<typeof createMediaQuotaRepository>;

export { createMediaQuotaRepository };
