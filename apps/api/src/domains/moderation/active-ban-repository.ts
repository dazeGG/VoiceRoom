import crypto from 'node:crypto';
import type pg from 'pg';

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

function normalizePrincipal({ userId = null, ip = '' }: { userId?: unknown; ip?: unknown } = {}): BanPrincipal {
  const accountId = typeof userId === 'string' && userId.trim() ? userId.trim() : null;
  return {
    userId: accountId,
    ip: accountId ? '' : typeof ip === 'string' ? ip.trim() : ''
  };
}

function createActiveBanRepository({ pool, now = Date.now }: { pool?: QueryClient | null; now?: () => number } = {}) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('A PostgreSQL pool is required');
  const defaultDb = pool;

  function executor(client: Client): QueryClient {
    return client && typeof client.query === 'function' ? client : defaultDb;
  }

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
    const normalizedIp = typeof ip === 'string' ? ip.trim() : '';
    if (!roomId || (!normalizedUserId && !normalizedIp)) return null;
    const result = await executor(client).query<BanRow>(
      `SELECT *
       FROM room_bans
       WHERE room_id = $1
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > $4)
         AND (
           ($2::varchar(36) IS NOT NULL AND user_id = $2)
           OR (user_id IS NULL AND $3::text <> '' AND ip = $3)
         )
       ORDER BY CASE WHEN user_id IS NOT NULL THEN 0 ELSE 1 END,
                created_at DESC,
                id DESC
       LIMIT 1`,
      [roomId, normalizedUserId, normalizedIp, toDate(at)]
    );
    return mapActiveBan(result.rows[0]);
  }

  async function countActive(
    roomId: string | undefined,
    { at = now(), client }: { at?: TimeInput; client?: Client } = {}
  ): Promise<number> {
    if (!roomId) return 0;
    const result = await executor(client).query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM room_bans
       WHERE room_id = $1
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > $2)`,
      [roomId, toDate(at)]
    );
    return Number(result.rows[0]?.count || 0);
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
    const result = await executor(client).query<{ user_id: string | null }>(
      `SELECT DISTINCT user_id
       FROM room_bans
       WHERE room_id = $1
         AND user_id = ANY($2::varchar[])
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > $3)`,
      [roomId, normalizedUserIds, toDate(at)]
    );
    return result.rows.map((row) => row.user_id).filter((userId): userId is string => Boolean(userId));
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
    const result = await executor(client).query<BanRow>(
      `INSERT INTO room_bans (id, room_id, user_id, ip, created_at, expires_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        crypto.randomUUID(),
        roomId,
        principal.userId,
        principal.ip,
        toDate(at),
        expiresAt == null ? null : toDate(expiresAt),
        metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}
      ]
    );
    return mapActiveBan(result.rows[0]);
  }

  return { countActive, filterActiveUserIds, findActive, insert, mapActiveBan, normalizePrincipal };
}

export type ActiveBanRepository = ReturnType<typeof createActiveBanRepository>;

export { createActiveBanRepository, mapActiveBan, normalizePrincipal };
