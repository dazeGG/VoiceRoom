import type pg from 'pg';
import { createMentionRepository } from './mention.repository.ts';
import type { ErrorCode } from '@voice-room/shared/contracts/errors';
import { normalizeMentionUserIds } from '@voice-room/shared/mentions';
import { DomainError } from '../../platform/http/domain-error.ts';

type QueryClient = Pick<pg.PoolClient, 'query'>;

export interface ActiveBanFilter {
  filterEligibleUserIds(input: { roomId: string; userIds: string[]; client: QueryClient }): Promise<string[]>;
}

class MentionEligibilityError extends DomainError {
  constructor(code: ErrorCode = 'mention_not_eligible') {
    super(code, 422, 'One or more mention targets are not eligible');
  }
}

function createMentionEligibilityService({
  activeBanService,
  pool
}: {
  activeBanService: ActiveBanFilter;
  pool: QueryClient;
}) {
  const defaultDb = pool;
  const mentions = createMentionRepository({ pool });

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
