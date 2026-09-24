import type pg from 'pg';
import { transaction } from '../../lib/db.ts';
import { createMembershipRepository, type Membership, type MembershipRepository } from './membership-repository.ts';

type QueryClient = Pick<pg.PoolClient, 'query'>;

export interface BanCheck {
  isBanned(input: { roomId: string; userId: string; ip: string; at: number; client?: QueryClient }): Promise<boolean>;
}

export type PersistedAdmission =
  | { membership: null; status: 'not_admitted' | 'not_found' | 'banned' }
  | { created: boolean; membership: Membership | null; status: 'active' };

export type RegisteredAdmission<A> =
  | { admission: null; membership: null; status: 'invalid' | 'banned' | 'admission_failed' }
  | ({ admission: A } & PersistedAdmission);

export type LeaveOutcome =
  | { membership: null; status: 'invalid' | 'not_active' }
  | { membership: Membership; status: 'owner_required' | 'left' | 'not_active' };

function createMembershipService({ pool, repository = createMembershipRepository({ pool }), activeBanService, now = Date.now }: {
  pool?: pg.Pool | null;
  repository?: MembershipRepository;
  activeBanService?: BanCheck | null;
  now?: () => number;
} = {}) {
  async function getMembership(roomId: string, userId: string): Promise<Membership | null> {
    return repository.getActive(roomId, userId);
  }

  async function canAccessDirectory(roomId: string, userId: string): Promise<boolean> {
    return repository.isActive(roomId, userId);
  }

  async function persistSuccessfulAdmission({ roomId, userId, ip = '', metadata = {}, admissionSucceeded = true }: {
    roomId?: string;
    userId?: string;
    ip?: string;
    metadata?: unknown;
    admissionSucceeded?: boolean;
  } = {}): Promise<PersistedAdmission> {
    if (!admissionSucceeded || !roomId || !userId) return { membership: null, status: 'not_admitted' };
    return transaction(pool, async (client: pg.PoolClient): Promise<PersistedAdmission> => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`voice-room:admission:${roomId}`]);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`voice-room:membership:${roomId}:${userId}`]);
      const room = await client.query('SELECT 1 FROM rooms WHERE id = $1 AND deleted_at IS NULL', [roomId]);
      if (room.rowCount === 0) return { membership: null, status: 'not_found' };
      if (activeBanService && await activeBanService.isBanned({ roomId, userId, ip, at: now(), client })) {
        return { membership: null, status: 'banned' };
      }
      const existing = await repository.getActive(roomId, userId, { client });
      const membership = await repository.upsertActive({ roomId, userId, metadata, at: now(), client });
      return { created: !existing, membership, status: 'active' };
    });
  }

  async function admitRegistered<A>({ roomId, userId, ip = '', metadata = {}, completeAdmission }: {
    roomId?: string;
    userId?: string;
    ip?: string;
    metadata?: unknown;
    completeAdmission?: () => Promise<A | null | undefined> | A | null | undefined;
  } = {}): Promise<RegisteredAdmission<A>> {
    if (!roomId || !userId || typeof completeAdmission !== 'function') {
      return { admission: null, membership: null, status: 'invalid' };
    }
    if (activeBanService && await activeBanService.isBanned({ roomId, userId, ip, at: now() })) {
      return { admission: null, membership: null, status: 'banned' };
    }
    const admission = await completeAdmission();
    if (!admission) return { admission: null, membership: null, status: 'admission_failed' };
    const persisted = await persistSuccessfulAdmission({ roomId, userId, ip, metadata, admissionSucceeded: true });
    return { admission, ...persisted };
  }

  async function leaveRoom({ roomId, userId }: { roomId?: string; userId?: string } = {}): Promise<LeaveOutcome> {
    if (!roomId || !userId) return { membership: null, status: 'invalid' };
    return transaction(pool, async (client: pg.PoolClient): Promise<LeaveOutcome> => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`voice-room:membership:${roomId}:${userId}`]);
      const membership = await repository.getActive(roomId, userId, { client });
      if (!membership) return { membership: null, status: 'not_active' };
      if (membership.role === 'owner') return { membership, status: 'owner_required' };
      const deleted = await repository.deleteActive(roomId, userId, { client });
      return deleted
        ? { membership: deleted, status: 'left' }
        : { membership: membership, status: 'not_active' };
    });
  }

  async function rollbackSuccessfulAdmission({ roomId, userId, membershipId }: {
    roomId?: string;
    userId?: string;
    membershipId?: string;
  } = {}): Promise<boolean> {
    if (!roomId || !userId || !membershipId) return false;
    return transaction(pool, async (client: pg.PoolClient): Promise<boolean> => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`voice-room:membership:${roomId}:${userId}`]);
      const membership = await repository.getActive(roomId, userId, { client });
      if (!membership || membership.id !== membershipId || membership.role === 'owner') return false;
      return Boolean(await repository.deleteActive(roomId, userId, { client }));
    });
  }

  return {
    admitRegistered,
    canAccessDirectory,
    getMembership,
    leaveRoom,
    persistSuccessfulAdmission,
    repository,
    rollbackSuccessfulAdmission
  };
}

export type MembershipService = ReturnType<typeof createMembershipService>;

export { createMembershipService };
