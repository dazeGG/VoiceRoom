import type pg from 'pg';
import { sql } from 'kysely';
import { kyselyOn } from '../../platform/db/kysely.ts';
import { transaction } from '../../platform/db/pool.ts';
import {
  createActiveBanRepository,
  normalizePrincipal,
  type ActiveBanRecord,
  type ActiveBanRepository
} from './active-ban.repository.ts';

type QueryClient = Pick<pg.PoolClient, 'query'>;
type TimeInput = Date | number | string;

export type BanCreation =
  { ban: null; status: 'invalid' | 'not_found' | 'cap_exceeded' } | { ban: ActiveBanRecord | null; status: 'created' };

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
        (Array.isArray(userIds) ? userIds : [])
          .filter((userId): userId is string => typeof userId === 'string' && Boolean(userId.trim()))
          .map((userId) => userId.trim())
      )
    );
    if (!roomId || normalized.length === 0) return [];
    const banned = new Set(await repository.filterActiveUserIds({ roomId, userIds: normalized, at, client }));
    return normalized.filter((userId) => !banned.has(userId));
  }

  async function createBan({
    roomId,
    userId = null,
    ip = '',
    expiresAt = null,
    metadata = {},
    maxActiveBans = 100
  }: {
    roomId?: string;
    userId?: unknown;
    ip?: unknown;
    expiresAt?: TimeInput | null;
    metadata?: unknown;
    maxActiveBans?: number;
  } = {}): Promise<BanCreation> {
    const principal = normalizePrincipal({ userId, ip });
    if (!roomId || (!principal.userId && !principal.ip)) return { ban: null, status: 'invalid' };
    const at = now();
    return transaction(pool, async (client: pg.PoolClient): Promise<BanCreation> => {
      const trx = kyselyOn(client);
      // Admission and bans in this room wait for each other.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`voice-room:admission:${roomId}`}))`.execute(trx);
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`voice-room:room-bans:${roomId}`}))`.execute(trx);
      const room = await trx
        .selectFrom('rooms')
        .select('id')
        .where('id', '=', roomId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!room) return { ban: null, status: 'not_found' };

      const limit = Number.isInteger(maxActiveBans) && maxActiveBans >= 0 ? maxActiveBans : 100;
      if (limit > 0 && (await repository.countActive(roomId, { at, client })) >= limit) {
        return { ban: null, status: 'cap_exceeded' };
      }
      const ban = await repository.insert({ roomId, ...principal, expiresAt, metadata, at, client });
      return { ban, status: 'created' };
    });
  }

  return { createBan, filterEligibleUserIds, getActiveBan, isBanned, repository };
}

export type ActiveBanService = ReturnType<typeof createActiveBanService>;

export { createActiveBanService };
