'use strict';

const { transaction } = require('../../lib/db');

function requireOperation(target, names, label) {
  for (const name of names) {
    if (typeof target?.[name] === 'function') return target[name].bind(target);
  }
  throw new TypeError(`${label} is required`);
}

function attachmentRevoker(repository) {
  if (repository?.revokeForRoomMessage || repository?.revokeForMessage) {
    return requireOperation(repository, ['revokeForRoomMessage', 'revokeForMessage'], 'An attachment revocation operation');
  }
  if (repository?.listForMessage && repository?.markDeleted) {
    return async ({ messageId, client }) => {
      const attachments = await repository.listForMessage('room', messageId, { client });
      const revoked = [];
      for (const attachment of attachments) {
        revoked.push(await repository.markDeleted(attachment.id, client));
      }
      return revoked;
    };
  }
  throw new TypeError('An attachment revocation operation is required');
}

function cleanupEnqueuer(repository) {
  if (repository?.enqueueCleanupForRoomMessage || repository?.enqueueCleanupForAttachments) {
    return requireOperation(repository, ['enqueueCleanupForRoomMessage', 'enqueueCleanupForAttachments'], 'A media cleanup enqueue operation');
  }
  if (repository?.enqueue) {
    return async ({ attachments, at, client }) => {
      const jobs = [];
      for (const attachment of attachments) {
        if (attachment?.id) jobs.push(await repository.enqueue(attachment.id, { kind: 'cleanup', availableAt: at, client }));
      }
      return jobs;
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
} = {}) {
  if (!pool?.connect || !moderationService?.authorizeOwner) {
    throw new TypeError('Message moderation requires a pool and moderation service');
  }
  const revokeAttachments = attachmentRevoker(attachmentRepository);
  const enqueueCleanup = cleanupEnqueuer(mediaJobRepository);

  async function deleteRoomMessage({ roomId, messageId, actorUserId } = {}) {
    if (!roomId || !messageId || !actorUserId) return { status: 'invalid', deletion: null };
    const timestamp = new Date(now());
    const result = await transaction(pool, async (client) => {
      if (!await moderationService.authorizeOwner(roomId, actorUserId, { client })) {
        return { status: 'forbidden', deletion: null };
      }
      const selected = await client.query(
        `SELECT id, room_id, deleted_at
         FROM room_messages
         WHERE room_id = $1 AND id = $2
         LIMIT 1
         FOR UPDATE`,
        [roomId, messageId]
      );
      const message = selected.rows[0];
      if (!message) return { status: 'not_found', deletion: null };

      if (!message.deleted_at) {
        await client.query(
          'UPDATE room_messages SET deleted_at = $3 WHERE room_id = $1 AND id = $2 AND deleted_at IS NULL',
          [roomId, messageId, timestamp]
        );
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

module.exports = { createMessageModerationService };
