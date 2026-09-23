import type pg from 'pg';
import { normalizeMentionUserIds } from '@voice-room/shared/mentions';

type QueryClient = Pick<pg.PoolClient, 'query'>;

export interface ActiveBanFilter {
  filterEligibleUserIds(input: { roomId: string; userIds: string[]; client: QueryClient }): Promise<string[]>;
}

class MentionEligibilityError extends Error {
  declare code: string;
  declare statusCode: number;

  constructor(code = 'mention_not_eligible') {
    super('One or more mention targets are not eligible');
    this.name = 'MentionEligibilityError'; this.code = code; this.statusCode = 422;
  }
}

function createMentionEligibilityService({ activeBanService, pool }: {
  activeBanService?: ActiveBanFilter;
  pool?: QueryClient | null;
} = {}) {
  if (!pool?.query) throw new TypeError('A PostgreSQL pool is required');
  if (!activeBanService?.filterEligibleUserIds) throw new TypeError('Active ban service is required');
  const defaultDb = pool;

  // An arrow function keeps the activeBanService narrowing from the check above.
  const validate = async ({ roomId, creatorUserId, targetUserIds, client }: {
    roomId: string;
    creatorUserId: string;
    targetUserIds: unknown;
    client?: QueryClient | null;
  }): Promise<string[]> => {
    const normalized = normalizeMentionUserIds(targetUserIds, { creatorUserId });
    if (!normalized.ok) throw new MentionEligibilityError(normalized.code);
    const db = client?.query ? client : defaultDb;
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
    const targets = await db.query<{ user_id: string }>(
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
  };

  return { validate };
}

export type MentionEligibilityService = ReturnType<typeof createMentionEligibilityService>;

export { MentionEligibilityError, createMentionEligibilityService };
