import crypto from 'node:crypto';
import { sql } from 'kysely';
import type pg from 'pg';
import { kyselyOn, type Database } from '../../platform/db/kysely.ts';

type QueryClient = Pick<pg.PoolClient, 'query'>;
type Client = QueryClient | null | undefined;

type MembershipRow = {
  id: string;
  room_id: string;
  user_id: string;
  role: string;
  created_at: Date | string;
  updated_at: Date | string;
  metadata: Record<string, unknown> | null;
};

type DirectoryRow = {
  user_id: string;
  role: string;
  created_at: Date | string;
  created_at_micros: string | number;
  login: string | null;
  display_name: string | null;
  avatar_color_key: string | null;
  avatar_key: string | null;
  avatar_accent: string | null;
};

export type MembershipRole = 'owner' | 'member';

export type Membership = {
  id: string;
  roomId: string;
  userId: string;
  role: MembershipRole;
  createdAt: number | null;
  updatedAt: number | null;
  metadata: Record<string, unknown>;
};

export type DirectoryCursorTuple = { createdAtMicros: string; id: string };

export type DirectoryMember = {
  userId: string;
  displayName: string;
  login: string;
  avatarColorKey: string;
  avatarUrl: string | null;
  avatarAccent: string | null;
  role: MembershipRole;
  joinedAt: number | null;
  cursorTuple: DirectoryCursorTuple;
};

function toMillis(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value as string);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapMembership(row: MembershipRow | null | undefined): Membership | null {
  if (!row) return null;
  return {
    id: row.id,
    roomId: row.room_id,
    userId: row.user_id,
    role: row.role === 'owner' ? 'owner' : 'member',
    createdAt: toMillis(row.created_at),
    updatedAt: toMillis(row.updated_at),
    metadata: row.metadata || {}
  };
}

function mapDirectoryMember(row: DirectoryRow | null | undefined): DirectoryMember | null {
  if (!row) return null;
  return {
    userId: row.user_id,
    displayName: row.display_name || '',
    login: row.login || '',
    avatarColorKey: row.avatar_color_key || '',
    avatarUrl: row.avatar_key ? `/api/avatars/${encodeURIComponent(row.avatar_key)}` : null,
    avatarAccent: row.avatar_accent || null,
    role: row.role === 'owner' ? 'owner' : 'member',
    joinedAt: toMillis(row.created_at),
    cursorTuple: {
      createdAtMicros: String(row.created_at_micros),
      id: row.user_id
    }
  };
}

function createMembershipRepository({ pool }: { pool?: QueryClient | null } = {}) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('A PostgreSQL pool is required');
  const base = pool;
  const on = (client: Client): Database => kyselyOn(client && typeof client.query === 'function' ? client : base);

  async function getActive(
    roomId: string,
    userId: string,
    { client }: { client?: Client } = {}
  ): Promise<Membership | null> {
    if (!roomId || !userId) return null;
    const row = await on(client)
      .selectFrom('room_memberships')
      .selectAll()
      .where('room_id', '=', roomId)
      .where('user_id', '=', userId)
      .limit(1)
      .executeTakeFirst();
    return mapMembership(row as MembershipRow | undefined);
  }

  async function isActive(roomId: string, userId: string, options?: { client?: Client }): Promise<boolean> {
    return Boolean(await getActive(roomId, userId, options));
  }

  async function deleteActive(
    roomId: string,
    userId: string,
    { client }: { client?: Client } = {}
  ): Promise<Membership | null> {
    if (!roomId || !userId) return null;
    const row = await on(client)
      .deleteFrom('room_memberships')
      .where('room_id', '=', roomId)
      .where('user_id', '=', userId)
      .returningAll()
      .executeTakeFirst();
    return mapMembership(row as MembershipRow | undefined);
  }

  // Joining again keeps an owner an owner and merges the metadata.
  async function upsertActive({
    roomId,
    userId,
    role = 'member',
    metadata = {},
    at = Date.now(),
    client
  }: {
    roomId?: string;
    userId?: string;
    role?: string;
    metadata?: unknown;
    at?: unknown;
    client?: Client;
  } = {}): Promise<Membership | null> {
    if (!roomId || !userId) return null;
    const date = new Date(Number.isFinite(Number(at)) ? Number(at) : Date.now());
    const row = await on(client)
      .insertInto('room_memberships')
      .values({
        id: crypto.randomUUID(),
        room_id: roomId,
        user_id: userId,
        role: role === 'owner' ? 'owner' : 'member',
        created_at: date,
        updated_at: date,
        metadata: JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {})
      })
      .onConflict((oc) =>
        oc.columns(['room_id', 'user_id']).doUpdateSet((eb) => ({
          role: sql<string>`CASE WHEN room_memberships.role = 'owner' THEN 'owner' ELSE EXCLUDED.role END`,
          updated_at: eb.ref('excluded.updated_at'),
          metadata: sql`room_memberships.metadata || EXCLUDED.metadata`
        }))
      )
      .returningAll()
      .executeTakeFirst();
    return mapMembership(row as MembershipRow | undefined);
  }

  // Members in joining order, optionally by name or login prefix.
  async function listDirectoryPage({
    roomId,
    query = '',
    limit,
    after = null,
    client
  }: {
    roomId?: string;
    query?: unknown;
    limit?: unknown;
    after?: Partial<DirectoryCursorTuple> | null;
    client?: Client;
  } = {}): Promise<{ members: DirectoryMember[]; hasMore: boolean }> {
    const pageSize = Math.min(100, Math.max(1, Number(limit) || 50));
    const normalizedQuery = typeof query === 'string' ? query.trim().slice(0, 80) : '';
    let page = on(client)
      .selectFrom('room_memberships as rm')
      .innerJoin('users as u', 'u.id', 'rm.user_id')
      .innerJoin('rooms as r', 'r.id', 'rm.room_id')
      .select([
        'rm.user_id',
        'rm.role',
        'rm.created_at',
        sql<string>`floor(extract(epoch FROM rm.created_at) * 1000000)::numeric(20, 0)`.as('created_at_micros'),
        'u.login',
        'u.display_name',
        'u.avatar_color_key',
        'u.avatar_key',
        'u.avatar_accent'
      ])
      .where('rm.room_id', '=', roomId as string)
      .where('r.deleted_at', 'is', null);
    if (normalizedQuery) {
      page = page.where(
        sql<boolean>`(lower(COALESCE(NULLIF(u.display_name, ''), u.login)) LIKE lower(${normalizedQuery}) || '%'
          OR lower(u.login) LIKE lower(${normalizedQuery}) || '%')`
      );
    }
    if (after?.createdAtMicros && after.createdAtMicros !== '0') {
      page = page.where(
        sql<boolean>`(rm.created_at, rm.user_id) > (to_timestamp(${after.createdAtMicros}::numeric / 1000000.0), ${after.id || ''}::varchar(36))`
      );
    }
    const found = (await page
      .orderBy('rm.created_at', 'asc')
      .orderBy('rm.user_id', 'asc')
      .limit(pageSize + 1)
      .execute()) as DirectoryRow[];
    const hasMore = found.length > pageSize;
    const rows = hasMore ? found.slice(0, pageSize) : found;
    return { members: rows.map((row) => mapDirectoryMember(row) as DirectoryMember), hasMore };
  }

  return { deleteActive, getActive, isActive, listDirectoryPage, mapDirectoryMember, mapMembership, upsertActive };
}

export type MembershipRepository = ReturnType<typeof createMembershipRepository>;

export { createMembershipRepository, mapDirectoryMember, mapMembership };
