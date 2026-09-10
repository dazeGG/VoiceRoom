'use strict';

function createMediaQuotaRepository({ attachmentRepository, pool } = {}) {
  if (!attachmentRepository?.quotaUsage || !attachmentRepository?.lockOwner) {
    throw new TypeError('Attachment repository with quota support is required');
  }
  if (!pool?.connect) throw new TypeError('A PostgreSQL pool is required');

  async function withOwnerReservation(ownerId, operation) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await attachmentRepository.lockOwner(ownerId, client);
      const usage = await attachmentRepository.quotaUsage(ownerId, { client });
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

module.exports = { createMediaQuotaRepository };
