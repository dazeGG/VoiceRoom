import type pg from 'pg';
import { createMentionRepository } from './mention.repository.ts';
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
  const mentions = createMentionRepository({ pool });

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
    // The writer must be a member of a live room, and not banned from it.
    if (!(await mentions.isLiveRoomMember(roomId, creatorUserId, { client: db }))) {
      throw new MentionEligibilityError('creator_not_eligible');
    }
    if ((await activeBanService.filterEligibleUserIds({ roomId, userIds: [creatorUserId], client: db })).length !== 1) {
      throw new MentionEligibilityError('creator_not_eligible');
    }
    if (!normalized.userIds.length) return [];
    // Every target must be a member too, and not banned.
    const targets = await mentions.memberUserIds(roomId, normalized.userIds, { client: db });
    const eligible = new Set(
      await activeBanService.filterEligibleUserIds({
        roomId,
        userIds: targets,
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
