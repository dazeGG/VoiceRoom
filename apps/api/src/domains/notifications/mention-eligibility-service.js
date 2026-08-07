'use strict';

const { normalizeMentionUserIds } = require('@voice-room/shared/mentions');

class MentionEligibilityError extends Error {
  constructor(code = 'mention_not_eligible') {
    super('One or more mention targets are not eligible');
    this.name = 'MentionEligibilityError'; this.code = code; this.statusCode = 422;
  }
}

function createMentionEligibilityService({ activeBanService, pool } = {}) {
  if (!pool?.query) throw new TypeError('A PostgreSQL pool is required');
  if (!activeBanService?.filterEligibleUserIds) throw new TypeError('Active ban service is required');

  async function validate({ roomId, creatorUserId, targetUserIds, client } = {}) {
    const normalized = normalizeMentionUserIds(targetUserIds, { creatorUserId });
    if (!normalized.ok) throw new MentionEligibilityError(normalized.code);
    const db = client?.query ? client : pool;
    const creator = await db.query(
      `SELECT 1 FROM room_memberships rm JOIN rooms r ON r.id = rm.room_id
       WHERE rm.room_id=$1 AND rm.user_id=$2 AND r.deleted_at IS NULL`,
      [roomId, creatorUserId]
    );
    if (!creator.rowCount) throw new MentionEligibilityError('creator_not_eligible');
    if ((await activeBanService.filterEligibleUserIds({ roomId, userIds: [creatorUserId], client: db })).length !== 1) {
      throw new MentionEligibilityError('creator_not_eligible');
    }
    if (!normalized.userIds.length) return [];
    const targets = await db.query(
      `SELECT rm.user_id FROM room_memberships rm
       WHERE rm.room_id=$1 AND rm.user_id = ANY($2::varchar[])`,
      [roomId, normalized.userIds]
    );
    const eligible = new Set(await activeBanService.filterEligibleUserIds({
      roomId,
      userIds: targets.rows.map((row) => row.user_id),
      client: db
    }));
    if (eligible.size !== normalized.userIds.length) throw new MentionEligibilityError();
    return normalized.userIds;
  }

  return { validate };
}

module.exports = { MentionEligibilityError, createMentionEligibilityService };
