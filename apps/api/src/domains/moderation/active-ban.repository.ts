import crypto from 'node:crypto';
import { sql, type ExpressionBuilder } from 'kysely';
import type pg from 'pg';
import { kyselyOn, type Database } from '../../platform/db/kysely.ts';
import type { DB } from '../../platform/db/schema.ts';
import { storedIpKey, type IpKeyOf } from '../../lib/ip-key.ts';

type QueryClient = Pick<pg.PoolClient, 'query'>;
type Client = QueryClient | null | undefined;
type TimeInput = Date | number | string;

type BanRow = {
  id: string;
  room_id: string;
  user_id: string | null;
  ip: string | null;
  created_at: Date | string;
  expires_at: Date | string | null;
  metadata: Record<string, unknown> | null;
};

export type ActiveBanRecord = {
  id: string;
  roomId: string;
  userId: string | null;
  /** The key of the banned guest's address (lib/ip-key.ts), never the address; '' for an account ban. */
  ip: string;
  createdAt: number | null;
  expiresAt: number | null;
  metadata: Record<string, unknown>;
};

export type BanPrincipal = { userId: string | null; ip: string };

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const numeric = Number(value);
  return new Date(Number.isFinite(numeric) ? numeric : Date.now());
}

function toMillis(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value as string);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapActiveBan(row: BanRow | null | undefined): ActiveBanRecord | null {
  if (!row) return null;
  return {
    id: row.id,
    roomId: row.room_id,
    userId: row.user_id || null,
    ip: row.ip || '',
    createdAt: toMillis(row.created_at),
    expiresAt: row.expires_at ? toMillis(row.expires_at) : null,
    metadata: row.metadata || {}
  };
}

// A ban counts until it is revoked or runs out.
function active(at: TimeInput) {
  return (eb: ExpressionBuilder<DB, 'room_bans'>) =>
    eb.and([eb('revoked_at', 'is', null), eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', toDate(at))])]);
}

// A guest is banned by the key of their address (lib/ip-key.ts), the same key
// their stays in voice keep: the address itself never reaches the table.
function createActiveBanRepository({
  pool,
  ipKeyOf,
  now = Date.now
}: {
  pool?: QueryClient | null;
  ipKeyOf: IpKeyOf;
  now?: () => number;
}) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('A PostgreSQL pool is required');
  const base = pool;
  const on = (client: Client): Database => kyselyOn(client && typeof client.query === 'function' ? client : base);

  function normalizePrincipal({ userId = null, ip = '' }: { userId?: unknown; ip?: unknown } = {}): BanPrincipal {
    const accountId = typeof userId === 'string' && userId.trim() ? userId.trim() : null;
    return { userId: accountId, ip: accountId ? '' : storedIpKey(ipKeyOf, ip) };
  }

  // The ban that stops this account, or this address for a guest; an account
  // ban wins over an address ban, the newest over older ones.
  async function findActive({
    roomId,
    userId = null,
    ip = '',
    at = now(),
    client
  }: {
    roomId?: string;
    userId?: unknown;
    ip?: unknown;
    at?: TimeInput;
    client?: Client;
  } = {}): Promise<ActiveBanRecord | null> {
    const normalizedUserId = typeof userId === 'string' && userId.trim() ? userId.trim() : null;
    const normalizedIp = storedIpKey(ipKeyOf, ip);
    if (!roomId || (!normalizedUserId && !normalizedIp)) return null;
    const row = await on(client)
      .selectFrom('room_bans')
      .selectAll()
      .where('room_id', '=', roomId)
      .where(active(at))
      .where((eb) => {
        const matches = [];
        if (normalizedUserId) matches.push(eb('user_id', '=', normalizedUserId));
        if (normalizedIp) matches.push(eb.and([eb('user_id', 'is', null), eb('ip', '=', normalizedIp)]));
        return eb.or(matches);
      })
      .orderBy(sql`CASE WHEN user_id IS NOT NULL THEN 0 ELSE 1 END`)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();
    return mapActiveBan(row as BanRow | undefined);
  }

  async function countActive(
    roomId: string | undefined,
    { at = now(), client }: { at?: TimeInput; client?: Client } = {}
  ): Promise<number> {
    if (!roomId) return 0;
    const row = await on(client)
      .selectFrom('room_bans')
      .select(sql<number>`COUNT(*)::int`.as('count'))
      .where('room_id', '=', roomId)
      .where(active(at))
      .executeTakeFirst();
    return Number(row?.count || 0);
  }

  async function filterActiveUserIds({
    roomId,
    userIds = [],
    at = now(),
    client
  }: {
    roomId?: string;
    userIds?: unknown;
    at?: TimeInput;
    client?: Client;
  } = {}): Promise<string[]> {
    const normalizedUserIds = Array.from(
      new Set(
        (Array.isArray(userIds) ? userIds : [])
          .filter((userId): userId is string => typeof userId === 'string' && Boolean(userId.trim()))
          .map((userId) => userId.trim())
      )
    );
    if (!roomId || normalizedUserIds.length === 0) return [];
    const rows = await on(client)
      .selectFrom('room_bans')
      .select('user_id')
      .distinct()
      .where('room_id', '=', roomId)
      .where('user_id', 'in', normalizedUserIds)
      .where(active(at))
      .execute();
    return rows.map((row) => row.user_id).filter((userId): userId is string => Boolean(userId));
  }

  async function insert({
    roomId,
    userId = null,
    ip = '',
    expiresAt = null,
    metadata = {},
    at = now(),
    client
  }: {
    roomId?: string;
    userId?: unknown;
    ip?: unknown;
    expiresAt?: TimeInput | null;
    metadata?: unknown;
    at?: TimeInput;
    client?: Client;
  } = {}): Promise<ActiveBanRecord | null> {
    const principal = normalizePrincipal({ userId, ip });
    if (!roomId || (!principal.userId && !principal.ip)) return null;
    const row = await on(client)
      .insertInto('room_bans')
      .values({
        id: crypto.randomUUID(),
        room_id: roomId,
        user_id: principal.userId,
        ip: principal.ip,
        created_at: toDate(at),
        expires_at: expiresAt == null ? null : toDate(expiresAt),
        metadata: JSON.stringify(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {})
      })
      .returningAll()
      .executeTakeFirst();
    return mapActiveBan(row as BanRow | undefined);
  }

  // Bans written before 2.10.4 hold the address itself. SQL cannot compute the
  // key, so the API rewrites such rows, a batch at a time. A key holds neither
  // '.' nor ':', so every pass finds only what is left: running it again, or on
  // two replicas at once, changes nothing already done. Returns the rows keyed.
  async function keyStoredAddresses({ batchSize = 500 }: { batchSize?: number } = {}): Promise<number> {
    const db = on(null);
    let keyed = 0;
    for (;;) {
      const rows = await db
        .selectFrom('room_bans')
        .select(['id', 'ip'])
        .where((eb) => eb.or([eb('ip', 'like', '%.%'), eb('ip', 'like', '%:%')]))
        .orderBy('id')
        .limit(batchSize)
        .execute();
      if (rows.length === 0) return keyed;
      const result = await sql`
        UPDATE room_bans AS b SET ip = v.key
        FROM unnest(${rows.map((row) => row.id)}::text[], ${rows.map((row) => row.ip)}::text[],
                    ${rows.map((row) => storedIpKey(ipKeyOf, row.ip))}::text[]) AS v(id, raw, key)
        WHERE b.id = v.id AND b.ip = v.raw`.execute(db);
      keyed += Number(result.numAffectedRows ?? 0n);
      if (rows.length < batchSize) return keyed;
    }
  }

  return {
    countActive,
    filterActiveUserIds,
    findActive,
    insert,
    keyStoredAddresses,
    mapActiveBan,
    normalizePrincipal
  };
}

export type ActiveBanRepository = ReturnType<typeof createActiveBanRepository>;

export { createActiveBanRepository };
