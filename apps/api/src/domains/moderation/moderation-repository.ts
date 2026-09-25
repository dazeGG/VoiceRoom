import crypto from 'node:crypto';
import type pg from 'pg';
import type { ActiveBan, ActiveBanProfile } from '@voice-room/shared/moderation';

type QueryClient = Pick<pg.PoolClient, 'query'>;
type Client = QueryClient | null | undefined;
type TimeInput = Date | number | string;
type CursorTuple = { createdAtMicros: string; id: string };

export interface ModerationCursorCodec {
  encode(input: { purpose: string; context: string; tuple: CursorTuple }): string;
  decode(value: string, options: { purpose: string; context: string }): CursorTuple;
}

export type ModerationBanRow = {
  id: string;
  room_id: string;
  user_id: string | null;
  reason: string | null;
  created_at: Date | string;
  updated_at: Date | string | null;
  expires_at: Date | string | null;
  created_at_micros?: string | null;
  login?: string | null;
  display_name?: string | null;
  avatar_key?: string | null;
  avatar_color_key?: string | null;
  avatar_accent?: string | null;
};

export type ModerationBan = Omit<ActiveBan, 'createdAt' | 'updatedAt'> & {
  createdAt: number | null;
  updatedAt: number | null;
};

function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const number = Number(value);
  return new Date(Number.isFinite(number) ? number : Date.now());
}

function toMillis(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value as string);
  return Number.isFinite(parsed) ? parsed : null;
}

// Only the active list joins users, so rows from mutations carry no login and
// project no profile.
function mapBanProfile(row: ModerationBanRow): ActiveBanProfile | null {
  if (!row.user_id || !row.login) return null;
  return {
    displayName: row.display_name || '',
    login: row.login,
    avatarUrl: row.avatar_key ? `/api/avatars/${encodeURIComponent(row.avatar_key)}` : null,
    avatarColorKey: row.avatar_color_key || '',
    avatarAccent: row.avatar_accent || null
  };
}

function mapModerationBan(row: ModerationBanRow | null | undefined): ModerationBan | null {
  if (!row) return null;
  const profile = mapBanProfile(row);
  return {
    id: row.id,
    roomId: row.room_id,
    subject: {
      kind: row.user_id ? 'account' : 'guest',
      userId: row.user_id || null,
      ...(profile ? { profile } : {})
    },
    reason: row.reason || '',
    createdAt: toMillis(row.created_at),
    updatedAt: toMillis(row.updated_at || row.created_at),
    expiresAt: row.expires_at ? toMillis(row.expires_at) : null
  };
}

function createModerationRepository({
  cursorCodec,
  pool
}: { cursorCodec?: ModerationCursorCodec; pool?: QueryClient | null } = {}) {
  if (!pool?.query) throw new TypeError('A PostgreSQL pool is required');
  if (!cursorCodec?.encode || !cursorCodec?.decode) throw new TypeError('Cursor codec is required');
  const defaultDb = pool;
  const codec = cursorCodec;
  const executor = (client: Client): QueryClient => (client?.query ? client : defaultDb);

  function encodeCursor(roomId: string, row: ModerationBanRow | undefined): string | undefined {
    if (!row?.created_at || !row?.id) return undefined;
    const createdAtMicros = row.created_at_micros
      ? String(row.created_at_micros)
      : (BigInt(new Date(row.created_at).getTime()) * 1000n).toString();
    return codec.encode({
      purpose: 'moderation-bans',
      context: `room:${roomId}`,
      tuple: {
        createdAtMicros,
        id: row.id
      }
    });
  }

  function decodeCursor(roomId: string, value: string | null | undefined): CursorTuple | null {
    if (!value) return null;
    try {
      return codec.decode(value, {
        purpose: 'moderation-bans',
        context: `room:${roomId}`
      });
    } catch {
      return null;
    }
  }

  async function isRoomOwner(roomId: string, userId: string, { client }: { client?: Client } = {}): Promise<boolean> {
    if (!roomId || !userId) return false;
    const result = await executor(client).query(
      'SELECT 1 FROM rooms WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL LIMIT 1',
      [roomId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async function countActive(
    roomId: string,
    { at = Date.now(), client }: { at?: TimeInput; client?: Client } = {}
  ): Promise<number> {
    const result = await executor(client).query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM room_bans
       WHERE room_id = $1
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > $2)`,
      [roomId, asDate(at)]
    );
    return Number(result.rows[0]?.count || 0);
  }

  async function findByIdempotencyKey(
    roomId: string,
    idempotencyKey: string,
    { client }: { client?: Client } = {}
  ): Promise<ModerationBan | null> {
    if (!roomId || !idempotencyKey) return null;
    const result = await executor(client).query<ModerationBanRow>(
      'SELECT * FROM room_bans WHERE room_id = $1 AND idempotency_key = $2 LIMIT 1',
      [roomId, idempotencyKey]
    );
    return mapModerationBan(result.rows[0]);
  }

  async function findActivePrincipal({
    roomId,
    userId = null,
    guestIp = null,
    at = Date.now(),
    client
  }: {
    roomId: string;
    userId?: string | null;
    guestIp?: string | null;
    at?: TimeInput;
    client?: Client;
  }): Promise<ModerationBanRow | null> {
    const result = await executor(client).query<ModerationBanRow>(
      `SELECT *
       FROM room_bans
       WHERE room_id = $1
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > $4)
         AND (($2::varchar(36) IS NOT NULL AND user_id = $2)
           OR ($2::varchar(36) IS NULL AND user_id IS NULL AND ip = $3))
       ORDER BY created_at DESC, id DESC
       LIMIT 1
       FOR UPDATE`,
      [roomId, userId, guestIp || '', asDate(at)]
    );
    return result.rows[0] || null;
  }

  async function create({
    roomId,
    userId = null,
    guestIp = null,
    expiresAt,
    reason = '',
    idempotencyKey,
    at = Date.now(),
    client
  }: {
    roomId: string;
    userId?: string | null;
    guestIp?: string | null;
    expiresAt?: TimeInput | null;
    reason?: string;
    idempotencyKey: string;
    at?: TimeInput;
    client?: Client;
  }): Promise<ModerationBan | null> {
    const timestamp = asDate(at);
    const result = await executor(client).query<ModerationBanRow>(
      `INSERT INTO room_bans
         (id, room_id, user_id, ip, created_at, expires_at, metadata, reason, idempotency_key, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb, $7, $8, $5)
       RETURNING *`,
      [
        crypto.randomUUID(),
        roomId,
        userId,
        userId ? '' : guestIp,
        timestamp,
        expiresAt == null ? null : asDate(expiresAt),
        reason,
        idempotencyKey
      ]
    );
    return mapModerationBan(result.rows[0]);
  }

  async function updateActive({
    id,
    expiresAt,
    reason = '',
    idempotencyKey,
    at = Date.now(),
    client
  }: {
    id: string;
    expiresAt?: TimeInput | null;
    reason?: string;
    idempotencyKey: string;
    at?: TimeInput;
    client?: Client;
  }): Promise<ModerationBan | null> {
    const timestamp = asDate(at);
    const result = await executor(client).query<ModerationBanRow>(
      `UPDATE room_bans
       SET expires_at = $2, reason = $3, idempotency_key = $4, updated_at = $5
       WHERE id = $1 AND revoked_at IS NULL
       RETURNING *`,
      [id, expiresAt == null ? null : asDate(expiresAt), reason, idempotencyKey, timestamp]
    );
    return mapModerationBan(result.rows[0]);
  }

  async function listActive({
    roomId,
    cursor = null,
    limit = 50,
    at = Date.now(),
    client
  }: {
    roomId: string;
    cursor?: string | null;
    limit?: number;
    at?: TimeInput;
    client?: Client;
  }): Promise<{ bans: ModerationBan[]; hasMore: boolean; nextCursor: string | undefined }> {
    const after = cursor ? decodeCursor(roomId, cursor) : null;
    if (cursor && !after) {
      const error = new Error('Invalid moderation cursor') as Error & { code?: string };
      error.code = 'invalid_cursor';
      throw error;
    }
    const result = await executor(client).query<ModerationBanRow>(
      `SELECT rb.*,
              FLOOR(EXTRACT(EPOCH FROM rb.created_at) * 1000000)::bigint::text AS created_at_micros,
              u.login,
              u.display_name,
              u.avatar_color_key,
              u.avatar_key,
              u.avatar_accent
       FROM room_bans rb
       LEFT JOIN users u ON u.id = rb.user_id
       WHERE rb.room_id = $1
         AND rb.revoked_at IS NULL
         AND (rb.expires_at IS NULL OR rb.expires_at > $2)
         AND ($3::bigint IS NULL OR (rb.created_at, rb.id) < (
           TIMESTAMPTZ 'epoch' + $3::bigint * INTERVAL '1 microsecond', $4::varchar(36)
         ))
       ORDER BY rb.created_at DESC, rb.id DESC
       LIMIT $5`,
      [roomId, asDate(at), after?.createdAtMicros || null, after?.id || null, limit + 1]
    );
    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
    return {
      bans: rows.map(mapModerationBan) as ModerationBan[],
      hasMore,
      nextCursor: hasMore ? encodeCursor(roomId, rows.at(-1)) : undefined
    };
  }

  async function revoke({
    roomId,
    banId,
    at = Date.now(),
    client
  }: {
    roomId: string;
    banId: string;
    at?: TimeInput;
    client?: Client;
  }): Promise<{ ban: ModerationBan | null; found: boolean }> {
    const result = await executor(client).query<ModerationBanRow>(
      `UPDATE room_bans
       SET revoked_at = COALESCE(revoked_at, $3),
           expires_at = CASE WHEN revoked_at IS NULL THEN $3 ELSE expires_at END,
           updated_at = CASE WHEN revoked_at IS NULL THEN $3 ELSE updated_at END
       WHERE room_id = $1 AND id = $2
       RETURNING *`,
      [roomId, banId, asDate(at)]
    );
    return result.rows[0] ? { ban: mapModerationBan(result.rows[0]), found: true } : { ban: null, found: false };
  }

  return Object.freeze({
    countActive,
    create,
    decodeCursor,
    findActivePrincipal,
    findByIdempotencyKey,
    isRoomOwner,
    listActive,
    mapModerationBan,
    revoke,
    updateActive
  });
}

export type ModerationRepository = ReturnType<typeof createModerationRepository>;

export { createModerationRepository, mapModerationBan };
