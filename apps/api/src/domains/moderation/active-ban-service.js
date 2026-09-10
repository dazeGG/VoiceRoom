'use strict';

const { transaction } = require('../../lib/db');
const { createActiveBanRepository, normalizePrincipal } = require('./active-ban-repository');

function createActiveBanService({ pool, repository = createActiveBanRepository({ pool }), now = Date.now } = {}) {
  async function getActiveBan(input = {}) {
    return repository.findActive({ ...input, at: input.at ?? now() });
  }

  async function isBanned(input = {}) {
    return Boolean(await getActiveBan(input));
  }

  async function filterEligibleUserIds({ roomId, userIds = [], at = now(), client } = {}) {
    const normalized = Array.from(new Set(
      (Array.isArray(userIds) ? userIds : [])
        .filter((userId) => typeof userId === 'string' && userId.trim())
        .map((userId) => userId.trim())
    ));
    if (!roomId || normalized.length === 0) return [];
    const banned = new Set(await repository.filterActiveUserIds({ roomId, userIds: normalized, at, client }));
    return normalized.filter((userId) => !banned.has(userId));
  }

  async function createBan({ roomId, userId = null, ip = '', expiresAt = null, metadata = {}, maxActiveBans = 100 } = {}) {
    const principal = normalizePrincipal({ userId, ip });
    if (!roomId || (!principal.userId && !principal.ip)) return { ban: null, status: 'invalid' };
    const at = now();
    return transaction(pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`voice-room:admission:${roomId}`]);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`voice-room:room-bans:${roomId}`]);
      const room = await client.query('SELECT 1 FROM rooms WHERE id = $1 AND deleted_at IS NULL', [roomId]);
      if (room.rowCount === 0) return { ban: null, status: 'not_found' };

      const limit = Number.isInteger(maxActiveBans) && maxActiveBans >= 0 ? maxActiveBans : 100;
      if (limit > 0 && await repository.countActive(roomId, { at, client }) >= limit) {
        return { ban: null, status: 'cap_exceeded' };
      }
      const ban = await repository.insert({ roomId, ...principal, expiresAt, metadata, at, client });
      return { ban, status: 'created' };
    });
  }

  return { createBan, filterEligibleUserIds, getActiveBan, isBanned, repository };
}

module.exports = { createActiveBanService };
