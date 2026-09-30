import type pg from 'pg';
import { kyselyOn } from '../../platform/db/kysely.ts';
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
    this.name = 'MentionEligibilityError';
    this.code = code;
    this.statusCode = 422;
  }
}

function createMentionEligibilityService({
  activeBanService,
  pool
}: {
  activeBanService?: ActiveBanFilter;
  pool?: QueryClient | null;
} = {}) {
  if (!pool?.query) throw new TypeError('A PostgreSQL pool is required');
  if (!activeBanService?.filterEligibleUserIds) throw new TypeError('Active ban service is required');
  const defaultDb = pool;

  // An arrow function keeps the activeBanService narrowing from the check above.
  const validate = async ({
    roomId,
    creatorUserId,
    targetUserIds,
    client
  }: {
    roomId: string;
    creatorUserId: string;
    targetUserIds: unknown;
    client?: QueryClient | null;
  }): Promise<string[]> => {
    const normalized = normalizeMentionUserIds(targetUserIds, { creatorUserId });
    if (!normalized.ok) throw new MentionEligibilityError(normalized.code);
    const db = client?.query ? client : defaultDb;
    const q = kyselyOn(db);
    // The writer must be a member of a live room, and not banned from it.
    const creator = await q
      .selectFrom('room_memberships as rm')
      .innerJoin('rooms as r', 'r.id', 'rm.room_id')
      .select('rm.id')
      .where('rm.room_id', '=', roomId)
      .where('rm.user_id', '=', creatorUserId)
      .where('r.deleted_at', 'is', null)
      .executeTakeFirst();
    if (!creator) throw new MentionEligibilityError('creator_not_eligible');
    if ((await activeBanService.filterEligibleUserIds({ roomId, userIds: [creatorUserId], client: db })).length !== 1) {
      throw new MentionEligibilityError('creator_not_eligible');
    }
    if (!normalized.userIds.length) return [];
    // Every target must be a member too, and not banned.
    const targets = await q
      .selectFrom('room_memberships')
      .select('user_id')
      .where('room_id', '=', roomId)
      .where('user_id', 'in', normalized.userIds)
      .execute();
    const eligible = new Set(
      await activeBanService.filterEligibleUserIds({
        roomId,
        userIds: targets.map((row) => row.user_id),
        client: db
      })
    );
    if (eligible.size !== normalized.userIds.length) throw new MentionEligibilityError();
    return normalized.userIds;
  };

  return { validate };
}

export type MentionEligibilityService = ReturnType<typeof createMentionEligibilityService>;

export { MentionEligibilityError, createMentionEligibilityService };
