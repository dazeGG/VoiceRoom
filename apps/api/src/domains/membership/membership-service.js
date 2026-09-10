'use strict';

const { transaction } = require('../../lib/db');
const { createMembershipRepository } = require('./membership-repository');

function createMembershipService({ pool, repository = createMembershipRepository({ pool }), activeBanService, now = Date.now } = {}) {
  async function getMembership(roomId, userId) {
    return repository.getActive(roomId, userId);
  }

  async function canAccessDirectory(roomId, userId) {
    return repository.isActive(roomId, userId);
  }

  async function persistSuccessfulAdmission({ roomId, userId, ip = '', metadata = {}, admissionSucceeded = true } = {}) {
    if (!admissionSucceeded || !roomId || !userId) return { membership: null, status: 'not_admitted' };
    return transaction(pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`voice-room:admission:${roomId}`]);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`voice-room:membership:${roomId}:${userId}`]);
      const room = await client.query('SELECT 1 FROM rooms WHERE id = $1 AND deleted_at IS NULL', [roomId]);
      if (room.rowCount === 0) return { membership: null, status: 'not_found' };
      if (activeBanService && await activeBanService.isBanned({ roomId, userId, ip, at: now(), client })) {
        return { membership: null, status: 'banned' };
      }
      const existing = await repository.getActive(roomId, userId, { client });
      const membership = await repository.upsertActive({ roomId, userId, metadata, at: now(), client });
      return { created: !existing, membership, status: 'active' };
    });
  }

  async function admitRegistered({ roomId, userId, ip = '', metadata = {}, completeAdmission } = {}) {
    if (!roomId || !userId || typeof completeAdmission !== 'function') {
      return { admission: null, membership: null, status: 'invalid' };
    }
    if (activeBanService && await activeBanService.isBanned({ roomId, userId, ip, at: now() })) {
      return { admission: null, membership: null, status: 'banned' };
    }
    const admission = await completeAdmission();
    if (!admission) return { admission: null, membership: null, status: 'admission_failed' };
    const persisted = await persistSuccessfulAdmission({ roomId, userId, ip, metadata, admissionSucceeded: true });
    return { admission, ...persisted };
  }

  async function leaveRoom({ roomId, userId } = {}) {
    if (!roomId || !userId) return { membership: null, status: 'invalid' };
    return transaction(pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`voice-room:membership:${roomId}:${userId}`]);
      const membership = await repository.getActive(roomId, userId, { client });
      if (!membership) return { membership: null, status: 'not_active' };
      if (membership.role === 'owner') return { membership, status: 'owner_required' };
      const deleted = await repository.deleteActive(roomId, userId, { client });
      if (!deleted) return { membership: membership, status: 'not_active' };
      // Leaving also removes the room from the user's list.
      await repository.deleteBookmark(roomId, userId, { client });
      return { membership: deleted, status: 'left' };
    });
  }

  async function rollbackSuccessfulAdmission({ roomId, userId, membershipId } = {}) {
    if (!roomId || !userId || !membershipId) return false;
    return transaction(pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`voice-room:membership:${roomId}:${userId}`]);
      const membership = await repository.getActive(roomId, userId, { client });
      if (!membership || membership.id !== membershipId || membership.role === 'owner') return false;
      return Boolean(await repository.deleteActive(roomId, userId, { client }));
    });
  }

  return {
    admitRegistered,
    canAccessDirectory,
    getMembership,
    leaveRoom,
    persistSuccessfulAdmission,
    repository,
    rollbackSuccessfulAdmission
  };
}

module.exports = { createMembershipService };
