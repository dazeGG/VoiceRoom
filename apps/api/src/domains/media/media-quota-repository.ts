import type pg from 'pg';
import type { AttachmentRepository } from './attachment-repository.ts';

export type QuotaUsage = Awaited<ReturnType<AttachmentRepository['quotaUsage']>>;

function createMediaQuotaRepository({
  attachmentRepository,
  pool
}: {
  attachmentRepository?: Pick<AttachmentRepository, 'quotaUsage' | 'lockOwner'>;
  pool?: { connect?: () => Promise<pg.PoolClient> } | null;
} = {}) {
  if (!attachmentRepository?.quotaUsage || !attachmentRepository?.lockOwner) {
    throw new TypeError('Attachment repository with quota support is required');
  }
  if (!pool?.connect) throw new TypeError('A PostgreSQL pool is required');
  const attachments = attachmentRepository;
  const db = pool as { connect: () => Promise<pg.PoolClient> };

  async function withOwnerReservation<T>(
    ownerId: string,
    operation: (input: { client: pg.PoolClient; usage: QuotaUsage }) => Promise<T>
  ): Promise<T> {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await attachments.lockOwner(ownerId, client);
      const usage = await attachments.quotaUsage(ownerId, { client });
      const result = await operation({ client, usage });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  return Object.freeze({ withOwnerReservation });
}

export type MediaQuotaRepository = ReturnType<typeof createMediaQuotaRepository>;

export { createMediaQuotaRepository };
