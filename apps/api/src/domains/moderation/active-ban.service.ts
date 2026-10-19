import type pg from 'pg';
import { isArray } from '@voice-room/shared/guards';
import { createActiveBanRepository, type ActiveBanRecord, type ActiveBanRepository } from './active-ban.repository.ts';

type QueryClient = Pick<pg.PoolClient, 'query'>;
type TimeInput = Date | number | string;

function createActiveBanService({
  pool,
  repository = createActiveBanRepository({ pool }),
  now = Date.now
}: {
  pool?: pg.Pool | null;
  repository?: ActiveBanRepository;
  now?: () => number;
} = {}) {
  async function getActiveBan(
    input: Parameters<ActiveBanRepository['findActive']>[0] = {}
  ): Promise<ActiveBanRecord | null> {
    return repository.findActive({ ...input, at: input.at ?? now() });
  }

  async function isBanned(input: Parameters<ActiveBanRepository['findActive']>[0] = {}): Promise<boolean> {
    return Boolean(await getActiveBan(input));
  }

  async function filterEligibleUserIds({
    roomId,
    userIds = [],
    at = now(),
    client
  }: {
    roomId?: string;
    userIds?: unknown;
    at?: TimeInput;
    client?: QueryClient | null;
  } = {}): Promise<string[]> {
    const normalized = Array.from(
      new Set(
        (isArray(userIds) ? userIds : [])
          .filter((userId): userId is string => typeof userId === 'string' && Boolean(userId.trim()))
          .map((userId) => userId.trim())
      )
    );
    if (!roomId || normalized.length === 0) return [];
    const banned = new Set(await repository.filterActiveUserIds({ roomId, userIds: normalized, at, client }));
    return normalized.filter((userId) => !banned.has(userId));
  }

  return { filterEligibleUserIds, getActiveBan, isBanned, repository };
}

export type ActiveBanService = ReturnType<typeof createActiveBanService>;

export { createActiveBanService };
