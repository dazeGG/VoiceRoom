import crypto from 'node:crypto';
import type pg from 'pg';

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
  const defaultDb = pool;
  const executor = (client: Client): QueryClient => client && typeof client.query === 'function' ? client : defaultDb;

  async function getActive(roomId: string, userId: string, { client }: { client?: Client } = {}): Promise<Membership | null> {
    if (!roomId || !userId) return null;
    const result = await executor(client).query<MembershipRow>(
      `SELECT * FROM room_memberships WHERE room_id = $1 AND user_id = $2 LIMIT 1`,
      [roomId, userId]
    );
    return mapMembership(result.rows[0]);
  }

  async function isActive(roomId: string, userId: string, options?: { client?: Client }): Promise<boolean> {
    return Boolean(await getActive(roomId, userId, options));
  }

  async function deleteActive(roomId: string, userId: string, { client }: { client?: Client } = {}): Promise<Membership | null> {
    if (!roomId || !userId) return null;
    const result = await executor(client).query<MembershipRow>(
      `DELETE FROM room_memberships
       WHERE room_id = $1 AND user_id = $2
       RETURNING *`,
      [roomId, userId]
    );
    return mapMembership(result.rows[0]);
  }

  async function upsertActive({ roomId, userId, role = 'member', metadata = {}, at = Date.now(), client }: {
    roomId?: string;
    userId?: string;
    role?: string;
    metadata?: unknown;
    at?: unknown;
    client?: Client;
  } = {}): Promise<Membership | null> {
    if (!roomId || !userId) return null;
    const normalizedRole = role === 'owner' ? 'owner' : 'member';
    const date = new Date(Number.isFinite(Number(at)) ? Number(at) : Date.now());
    const result = await executor(client).query<MembershipRow>(
      `INSERT INTO room_memberships (id, room_id, user_id, role, created_at, updated_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $5, $6)
       ON CONFLICT (room_id, user_id) DO UPDATE
       SET role = CASE
                    WHEN room_memberships.role = 'owner' THEN 'owner'
                    ELSE EXCLUDED.role
                  END,
           updated_at = EXCLUDED.updated_at,
           metadata = room_memberships.metadata || EXCLUDED.metadata
       RETURNING *`,
      [crypto.randomUUID(), roomId, userId, normalizedRole, date, metadata && typeof metadata === 'object' ? metadata : {}]
    );
    return mapMembership(result.rows[0]);
  }

  async function listDirectoryPage({ roomId, query = '', limit, after = null, client }: {
    roomId?: string;
    query?: unknown;
    limit?: unknown;
    after?: Partial<DirectoryCursorTuple> | null;
    client?: Client;
  } = {}): Promise<{ members: DirectoryMember[]; hasMore: boolean }> {
    const pageSize = Math.min(100, Math.max(1, Number(limit) || 50));
    const normalizedQuery = typeof query === 'string' ? query.trim().slice(0, 80) : '';
    const afterMicros = after?.createdAtMicros || '0';
    const afterId = after?.id || '';
    const result = await executor(client).query<DirectoryRow>(
      `SELECT rm.user_id,
              rm.role,
              rm.created_at,
              floor(extract(epoch FROM rm.created_at) * 1000000)::numeric(20, 0) AS created_at_micros,
              u.login,
              u.display_name,
              u.avatar_color_key,
              u.avatar_key,
              u.avatar_accent
       FROM room_memberships rm
       JOIN users u ON u.id = rm.user_id
       JOIN rooms r ON r.id = rm.room_id
       WHERE rm.room_id = $1
         AND r.deleted_at IS NULL
         AND ($2::text = '' OR lower(COALESCE(NULLIF(u.display_name, ''), u.login)) LIKE lower($2) || '%' OR lower(u.login) LIKE lower($2) || '%')
         AND (
           $3::numeric = 0
           OR (rm.created_at, rm.user_id) > (to_timestamp($3::numeric / 1000000.0), $4::varchar(36))
         )
       ORDER BY rm.created_at ASC, rm.user_id ASC
       LIMIT $5`,
      [roomId, normalizedQuery, afterMicros, afterId, pageSize + 1]
    );
    const hasMore = result.rows.length > pageSize;
    const rows = hasMore ? result.rows.slice(0, pageSize) : result.rows;
    return { members: rows.map(mapDirectoryMember) as DirectoryMember[], hasMore };
  }

  return { deleteActive, getActive, isActive, listDirectoryPage, mapDirectoryMember, mapMembership, upsertActive };
}

export type MembershipRepository = ReturnType<typeof createMembershipRepository>;

export { createMembershipRepository, mapDirectoryMember, mapMembership };
