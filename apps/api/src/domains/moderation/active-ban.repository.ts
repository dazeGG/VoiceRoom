import { sql, type ExpressionBuilder, type Selectable } from 'kysely';
import type pg from 'pg';
import { isArray, isRecord } from '@voice-room/shared/guards';
import { kyselyOn, type Database } from '../../platform/db/kysely.ts';
import type { DB, RoomBans } from '../../platform/db/schema.ts';
import { createRowId } from '../../platform/db/ids.ts';
import { epochMillis, toDate, toMillis } from '../../platform/epoch-millis.ts';
import { storedIpKey, type IpKeyOf } from '../../lib/ip-key.ts';

type QueryClient = Pick<pg.PoolClient, 'query'>;
type Client = QueryClient | null | undefined;
type TimeInput = Date | number | string;

type BanRow = Pick<
  Selectable<RoomBans>,
  'id' | 'room_id' | 'user_id' | 'ip' | 'created_at' | 'expires_at' | 'metadata'
>;

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

function timeOf(value: TimeInput): Date {
  return value instanceof Date ? value : toDate(toMillis(value));
}

function mapActiveBan(row: BanRow | null | undefined): ActiveBanRecord | null {
  if (!row) return null;
  return {
    id: row.id,
    roomId: row.room_id,
    userId: row.user_id || null,
    ip: row.ip || '',
    createdAt: epochMillis(row.created_at),
    expiresAt: row.expires_at ? epochMillis(row.expires_at) : null,
    metadata: isRecord(row.metadata) ? row.metadata : {}
  };
}

// A ban counts until it is revoked or runs out.
function active(at: TimeInput) {
  return (eb: ExpressionBuilder<DB, 'room_bans'>) =>
    eb.and([eb('revoked_at', 'is', null), eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', timeOf(at))])]);
}

// The one writer of room_bans. The caller passes the stored principal: an
// account ban has no address, a guest ban has the address key (lib/ip-key.ts).
// updated_at is the moment of the ban, and metadata is always an object.
async function insertRoomBan(
  db: Database,
  {
    roomId,
    userId = null,
    ip = '',
    expiresAt = null,
    metadata = {},
    reason = '',
    idempotencyKey = null,
    at
  }: {
    roomId?: string | undefined;
    userId?: string | null;
    ip?: string;
    expiresAt?: TimeInput | null | undefined;
    metadata?: unknown;
    reason?: string;
    idempotencyKey?: string | null;
    at: TimeInput;
  }
): Promise<Selectable<RoomBans> | undefined> {
  const accountId = typeof userId === 'string' && userId.trim() ? userId.trim() : null;
  const storedIp = accountId ? '' : ip;
  if (!roomId || (!accountId && !storedIp)) return undefined;
  const createdAt = timeOf(at);
  return db
    .insertInto('room_bans')
    .values({
      id: createRowId(),
      room_id: roomId,
      user_id: accountId,
      ip: storedIp,
      created_at: createdAt,
      updated_at: createdAt,
      expires_at: expiresAt == null ? null : timeOf(expiresAt),
      metadata: JSON.stringify(isRecord(metadata) ? metadata : {}),
      reason,
      idempotency_key: idempotencyKey
    })
    .returningAll()
    .executeTakeFirst();
}

function createActiveBanRepository({
  pool,
  ipKeyOf,
  now = Date.now
}: {
  pool: QueryClient;
  ipKeyOf: IpKeyOf;
  now?: () => number;
}) {
  const on = (client: Client): Database => kyselyOn(client ?? pool);

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
    roomId?: string | undefined;
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
      .where((eb) =>
        eb.or([
          ...(normalizedUserId ? [eb('user_id', '=', normalizedUserId)] : []),
          ...(normalizedIp ? [eb.and([eb('user_id', 'is', null), eb('ip', '=', normalizedIp)])] : [])
        ])
      )
      .orderBy(sql`CASE WHEN user_id IS NOT NULL THEN 0 ELSE 1 END`)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();
    return mapActiveBan(row);
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
        (isArray(userIds) ? userIds : [])
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
    const row = await insertRoomBan(on(client), { roomId, ...principal, expiresAt, metadata, at });
    return mapActiveBan(row);
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

export { createActiveBanRepository, insertRoomBan };
