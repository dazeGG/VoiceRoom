'use strict';

const {
  buildModerationPage,
  durationToExpiresAt,
  normalizeBanMutation,
  normalizeIdempotencyKey,
  normalizeModerationPageRequest
} = require('@voice-room/shared/moderation');
const { transaction } = require('../../lib/db');
const { createModerationRepository } = require('./moderation-repository');

function createModerationService({ pool, repository = createModerationRepository({ pool }), now = Date.now, maxActiveBans = 100 } = {}) {
  async function authorizeOwner(roomId, actorUserId, options) {
    return repository.isRoomOwner(roomId, actorUserId, options);
  }

  async function listActive({ roomId, actorUserId, query = {} } = {}) {
    if (!await authorizeOwner(roomId, actorUserId)) return { status: 'forbidden', envelope: null };
    const page = normalizeModerationPageRequest(query);
    const result = await repository.listActive({ roomId, ...page, at: now() });
    return {
      status: 'ok',
      envelope: buildModerationPage({ roomId, ...result })
    };
  }

  async function putBan({ roomId, actorUserId, input, idempotencyKey } = {}) {
    const mutation = normalizeBanMutation(input);
    const key = normalizeIdempotencyKey(idempotencyKey);
    if (!mutation || !key) return { status: 'invalid', ban: null };
    return transaction(pool, async (client) => {
      if (!await authorizeOwner(roomId, actorUserId, { client })) return { status: 'forbidden', ban: null };
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`voice-room:room-bans:${roomId}`]);
      const replay = await repository.findByIdempotencyKey(roomId, key, { client });
      if (replay) return { status: 'replayed', ban: replay };

      const at = now();
      const existing = await repository.findActivePrincipal({ roomId, ...mutation, at, client });
      const expiresAt = durationToExpiresAt(mutation.duration, at);
      if (existing) {
        await repository.revoke({ roomId, banId: existing.id, at, client });
        const ban = await repository.create({
          roomId,
          ...mutation,
          expiresAt,
          idempotencyKey: key,
          at,
          client
        });
        return { status: 'updated', ban };
      }

      if (await repository.countActive(roomId, { at, client }) >= maxActiveBans) {
        return { status: 'cap_exceeded', ban: null };
      }
      const ban = await repository.create({
        roomId,
        ...mutation,
        expiresAt,
        idempotencyKey: key,
        at,
        client
      });
      return { status: 'created', ban };
    });
  }

  async function unban({ roomId, actorUserId, banId } = {}) {
    if (!roomId || !banId) return { status: 'invalid', ban: null };
    return transaction(pool, async (client) => {
      if (!await authorizeOwner(roomId, actorUserId, { client })) return { status: 'forbidden', ban: null };
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`voice-room:room-bans:${roomId}`]);
      const result = await repository.revoke({ roomId, banId, at: now(), client });
      return result.found ? { status: 'unbanned', ban: result.ban } : { status: 'not_found', ban: null };
    });
  }

  async function createPermanentBan(input = {}) {
    return putBan({ ...input, input: { ...input.input, duration: 'permanent' } });
  }

  return Object.freeze({ authorizeOwner, createPermanentBan, listActive, putBan, repository, unban });
}

module.exports = { createModerationService };
