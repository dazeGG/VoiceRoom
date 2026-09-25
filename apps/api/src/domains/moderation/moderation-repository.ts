import crypto from 'node:crypto';
import { sql } from 'kysely';
import type pg from 'pg';
import { kyselyOn, type Database } from '../../platform/db/kysely.ts';
import { fromMicros, microsOf } from '../../platform/db/micros.ts';
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
  const base = pool;
  const codec = cursorCodec;
  const on = (client: Client): Database => kyselyOn(client?.query ? client : base);
  const bans = (row: unknown) => mapModerationBan(row as ModerationBanRow | undefined);

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
    const row = await on(client)
      .selectFrom('rooms')
      .select('id')
      .where('id', '=', roomId)
      .where('owner_id', '=', userId)
      .where('deleted_at', 'is', null)
      .limit(1)
      .executeTakeFirst();
    return Boolean(row);
  }

  function activeBans(db: Database, roomId: string, at: TimeInput) {
    return db
      .selectFrom('room_bans as rb')
      .where('rb.room_id', '=', roomId)
      .where('rb.revoked_at', 'is', null)
      .where((eb) => eb.or([eb('rb.expires_at', 'is', null), eb('rb.expires_at', '>', asDate(at))]));
  }

  async function countActive(
    roomId: string,
    { at = Date.now(), client }: { at?: TimeInput; client?: Client } = {}
  ): Promise<number> {
    const row = await activeBans(on(client), roomId, at)
      .select(sql<number>`COUNT(*)::int`.as('count'))
      .executeTakeFirst();
    return Number(row?.count || 0);
  }

  async function findByIdempotencyKey(
    roomId: string,
    idempotencyKey: string,
    { client }: { client?: Client } = {}
  ): Promise<ModerationBan | null> {
    if (!roomId || !idempotencyKey) return null;
    const row = await on(client)
      .selectFrom('room_bans')
      .selectAll()
      .where('room_id', '=', roomId)
      .where('idempotency_key', '=', idempotencyKey)
      .limit(1)
      .executeTakeFirst();
    return bans(row);
  }

  // The live ban on this account, or on this address for a guest, locked for
  // the caller's transaction.
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
    const row = await activeBans(on(client), roomId, at)
      .selectAll('rb')
      .where((eb) =>
        userId ? eb('rb.user_id', '=', userId) : eb.and([eb('rb.user_id', 'is', null), eb('rb.ip', '=', guestIp || '')])
      )
      .orderBy('rb.created_at', 'desc')
      .orderBy('rb.id', 'desc')
      .limit(1)
      .forUpdate()
      .executeTakeFirst();
    return (row as ModerationBanRow | undefined) || null;
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
    const row = await on(client)
      .insertInto('room_bans')
      .values({
        id: crypto.randomUUID(),
        room_id: roomId,
        user_id: userId,
        // A guest ban needs the address; without one the NOT NULL column refuses it.
        ip: userId ? '' : (guestIp as string),
        created_at: timestamp,
        expires_at: expiresAt == null ? null : asDate(expiresAt),
        metadata: '{}',
        reason,
        idempotency_key: idempotencyKey,
        updated_at: timestamp
      })
      .returningAll()
      .executeTakeFirst();
    return bans(row);
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
    const row = await on(client)
      .updateTable('room_bans')
      .set({
        expires_at: expiresAt == null ? null : asDate(expiresAt),
        reason,
        idempotency_key: idempotencyKey,
        updated_at: asDate(at)
      })
      .where('id', '=', id)
      .where('revoked_at', 'is', null)
      .returningAll()
      .executeTakeFirst();
    return bans(row);
  }

  // Live bans with the banned account's profile, newest first, paged by an
  // opaque cursor bound to the room.
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
    let query = activeBans(on(client), roomId, at)
      .leftJoin('users as u', 'u.id', 'rb.user_id')
      .selectAll('rb')
      .select([
        microsOf('rb.created_at').as('created_at_micros'),
        'u.login',
        'u.display_name',
        'u.avatar_color_key',
        'u.avatar_key',
        'u.avatar_accent'
      ]);
    if (after) {
      query = query.where(
        sql<boolean>`(rb.created_at, rb.id) < (${fromMicros(after.createdAtMicros)}, ${after.id}::varchar(36))`
      );
    }
    const found = (await query
      .orderBy('rb.created_at', 'desc')
      .orderBy('rb.id', 'desc')
      .limit(limit + 1)
      .execute()) as ModerationBanRow[];
    const hasMore = found.length > limit;
    const rows = hasMore ? found.slice(0, limit) : found;
    return {
      bans: rows.map((row) => bans(row) as ModerationBan),
      hasMore,
      nextCursor: hasMore ? encodeCursor(roomId, rows.at(-1)) : undefined
    };
  }

  // Revoking twice keeps the first revocation.
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
    const timestamp = asDate(at);
    const row = await on(client)
      .updateTable('room_bans')
      .set({
        revoked_at: sql<Date>`COALESCE(revoked_at, ${timestamp})`,
        expires_at: sql<Date | null>`CASE WHEN revoked_at IS NULL THEN ${timestamp} ELSE expires_at END`,
        updated_at: sql<Date>`CASE WHEN revoked_at IS NULL THEN ${timestamp} ELSE updated_at END`
      })
      .where('room_id', '=', roomId)
      .where('id', '=', banId)
      .returningAll()
      .executeTakeFirst();
    return row ? { ban: bans(row), found: true } : { ban: null, found: false };
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
