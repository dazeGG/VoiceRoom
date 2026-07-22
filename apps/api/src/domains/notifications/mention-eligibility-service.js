'use strict';

const { normalizeMentionUserIds } = require('@voice-room/shared/mentions');

class MentionEligibilityError extends Error {
  constructor(code = 'mention_not_eligible') {
    super('One or more mention targets are not eligible');
    this.name = 'MentionEligibilityError'; this.code = code; this.statusCode = 422;
  }
}

function createMentionEligibilityService({ pool } = {}) {
  if (!pool?.query) throw new TypeError('A PostgreSQL pool is required');

  async function validate({ roomId, creatorUserId, targetUserIds, client } = {}) {
    const normalized = normalizeMentionUserIds(targetUserIds, { creatorUserId });
    if (!normalized.ok) throw new MentionEligibilityError(normalized.code);
    const db = client?.query ? client : pool;
    const creator = await db.query(
      `SELECT 1 FROM room_memberships rm JOIN rooms r ON r.id = rm.room_id
       WHERE rm.room_id=$1 AND rm.user_id=$2 AND r.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM room_bans b WHERE b.room_id=$1 AND b.user_id=$2 AND (b.expires_at IS NULL OR b.expires_at > current_timestamp))`,
      [roomId, creatorUserId]
    );
    if (!creator.rowCount) throw new MentionEligibilityError('creator_not_eligible');
    if (!normalized.userIds.length) return [];
    const targets = await db.query(
      `SELECT rm.user_id FROM room_memberships rm
       WHERE rm.room_id=$1 AND rm.user_id = ANY($2::varchar[])
         AND NOT EXISTS (SELECT 1 FROM room_bans b WHERE b.room_id=$1 AND b.user_id=rm.user_id AND (b.expires_at IS NULL OR b.expires_at > current_timestamp))`,
      [roomId, normalized.userIds]
    );
    const eligible = new Set(targets.rows.map((row) => row.user_id));
    if (eligible.size !== normalized.userIds.length) throw new MentionEligibilityError();
    return normalized.userIds;
  }

  return { validate };
}

module.exports = { MentionEligibilityError, createMentionEligibilityService };
