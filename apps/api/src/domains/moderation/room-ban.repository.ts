// Room bans as the owner sets them, and server mutes. A ban is either an
// account ban or an address ban, never both: persisting both would turn an
// account moderation action into a shared-network ban. Bans in one room are
// serialized by an advisory lock, so the cap holds under concurrent bans.

import { sql, type Selectable } from 'kysely';
import type pg from 'pg';
import { transaction } from '../../platform/db/pool.ts';
import { kyselyOn, type Database } from '../../platform/db/kysely.ts';
import type { RoomBans } from '../../platform/db/schema.ts';
import type { GatePrincipal } from '../admission/admission.service.ts';
import { revokePrincipalInTransaction, type PrincipalRevocation } from '../admission/gate-credential.repository.ts';
import { isGatePrincipal } from '../admission/gate-principal.ts';
import { createRowId, normalizePositiveInt, toDate, toMillis } from '../rooms/room.repository.ts';
import type { ActiveBanService } from './active-ban.service.ts';

type BanLookups = Pick<ActiveBanService, 'getActiveBan' | 'repository'>;

function mapRoomBan(row: Selectable<RoomBans>) {
  return {
    createdAt: toMillis(row.created_at),
    expiresAt: row.expires_at ? toMillis(row.expires_at) : null,
    id: row.id,
    ip: row.ip || '',
    metadata: row.metadata || {},
    roomId: row.room_id,
    userId: row.user_id || null
  };
}

function banTarget(userId: unknown, ip: unknown) {
  const normalizedUserId = typeof userId === 'string' && userId ? userId : null;
  const normalizedIp = normalizedUserId ? '' : typeof ip === 'string' ? ip : '';
  return { userId: normalizedUserId, ip: normalizedIp };
}

async function lockRoomBans(db: Database, roomId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtext(${`voice-room:room-bans:${roomId}`}))`.execute(db);
}

async function liveRoomExists(db: Database, roomId: string): Promise<boolean> {
  const row = await db
    .selectFrom('rooms')
    .select('id')
    .where('id', '=', roomId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  return Boolean(row);
}

function insertBan(
  db: Database,
  {
    roomId,
    userId,
    ip,
    metadata,
    now
  }: { roomId: string; userId: string | null; ip: string; metadata: object; now: number }
) {
  return db
    .insertInto('room_bans')
    .values({
      id: createRowId(),
      room_id: roomId,
      user_id: userId,
      ip,
      created_at: toDate(now),
      metadata: JSON.stringify(metadata)
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export function createRoomBanRepository({ pool, bans }: { pool: pg.Pool; bans: () => BanLookups }) {
  // The active-ban count takes a raw client, so bans run as a raw pg
  // transaction with the typed queries on the same connection.
  async function atCapacity(client: pg.PoolClient, roomId: string, limit: number, now: number): Promise<boolean> {
    if (limit <= 0) return false;
    return (await bans().repository.countActive(roomId, { at: now, client })) >= limit;
  }

  async function createRoomBan({
    roomId,
    userId = null,
    ip = '',
    maxBans = 100,
    metadata = {},
    now = Date.now()
  }: {
    roomId?: string;
    userId?: unknown;
    ip?: unknown;
    maxBans?: unknown;
    metadata?: unknown;
    now?: number;
  } = {}) {
    const target = banTarget(userId, ip);
    if (!roomId || (!target.userId && !target.ip)) return { ban: null, status: 'invalid' };

    return transaction(pool, async (client) => {
      const trx = kyselyOn(client);
      await lockRoomBans(trx, roomId);
      if (!(await liveRoomExists(trx, roomId))) return { ban: null, status: 'not_found' };
      if (await atCapacity(client, roomId, normalizePositiveInt(maxBans, 100), now)) {
        return { ban: null, status: 'cap_exceeded' };
      }
      const inserted = await insertBan(trx, {
        roomId,
        ...target,
        metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {},
        now
      });
      return { ban: mapRoomBan(inserted), status: 'created' };
    });
  }

  // The ban and the revocation of every gate principal it covers commit
  // together: a banned peer never keeps a usable LiveKit credential.
  async function createRoomBanWithLiveKitGateRevocations({
    roomId,
    userId = null,
    ip = '',
    maxBans = 100,
    metadata = {},
    principals = [],
    now = Date.now()
  }: {
    roomId?: string;
    userId?: unknown;
    ip?: unknown;
    maxBans?: number;
    metadata?: unknown;
    principals?: GatePrincipal[];
    now?: number;
  } = {}) {
    const target = banTarget(userId, ip);
    if (!roomId || (!target.userId && !target.ip)) return { ban: null, revocations: [], status: 'invalid' };
    if (!Array.isArray(principals) || principals.length === 0 || !principals.every(isGatePrincipal)) {
      return { ban: null, revocations: [], status: 'invalid' };
    }

    return transaction(pool, async (client) => {
      const trx = kyselyOn(client);
      await lockRoomBans(trx, roomId);
      if (!(await liveRoomExists(trx, roomId))) return { ban: null, revocations: [], status: 'not_found' };
      if (await atCapacity(client, roomId, maxBans, now)) return { ban: null, revocations: [], status: 'cap_exceeded' };

      const inserted = await insertBan(trx, {
        roomId,
        ...target,
        metadata: metadata && typeof metadata === 'object' ? metadata : {},
        now
      });
      const revocations: PrincipalRevocation[] = [];
      const seen = new Set<string>();
      for (const principal of principals) {
        const key = `${principal.principalType}:${principal.principalId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        revocations.push(await revokePrincipalInTransaction(trx, { principal, roomId, now }));
      }
      return { ban: mapRoomBan(inserted), revocations, status: 'created' };
    });
  }

  async function deleteRoomBan({ roomId, banId }: { roomId?: string; banId?: string } = {}) {
    if (!roomId || !banId) return { ban: null, status: 'not_found' };
    const row = await kyselyOn(pool)
      .deleteFrom('room_bans')
      .where('room_id', '=', roomId)
      .where('id', '=', banId)
      .returningAll()
      .executeTakeFirst();
    const ban = row ? mapRoomBan(row) : null;
    return { ban, status: ban ? 'deleted' : 'not_found' };
  }

  async function findActiveRoomBan({
    roomId,
    userId = null,
    ip = ''
  }: { roomId?: string; userId?: string | null; ip?: string } = {}) {
    return bans().getActiveBan({ roomId, userId, ip });
  }

  return { createRoomBan, createRoomBanWithLiveKitGateRevocations, deleteRoomBan, findActiveRoomBan };
}

// --- Server mutes -------------------------------------------------------
//
// Keyed by gate principal, not peer id, so the mute survives a reconnect:
// rejoining with a fresh peer id must not silently clear a moderator action.

export function createServerMuteRepository({ db }: { db: Database }) {
  async function setRoomServerMute({
    roomId,
    principal,
    mutedBy
  }: { roomId?: string; principal?: GatePrincipal | null; mutedBy?: unknown } = {}) {
    if (!isGatePrincipal(principal)) return { status: 'invalid' };
    const result = await db
      .insertInto('room_server_mutes')
      .values({
        room_id: roomId as string,
        principal_type: principal.principalType,
        principal_id: principal.principalId,
        muted_by: mutedBy as string
      })
      .onConflict((oc) => oc.columns(['room_id', 'principal_type', 'principal_id']).doNothing())
      .executeTakeFirst();
    return { status: Number(result.numInsertedOrUpdatedRows ?? 0) > 0 ? 'muted' : 'already_muted' };
  }

  async function clearRoomServerMute({
    roomId,
    principal
  }: { roomId?: string; principal?: GatePrincipal | null } = {}) {
    if (!isGatePrincipal(principal)) return { status: 'invalid' };
    const result = await db
      .deleteFrom('room_server_mutes')
      .where('room_id', '=', roomId as string)
      .where('principal_type', '=', principal.principalType)
      .where('principal_id', '=', principal.principalId)
      .executeTakeFirst();
    return { status: result.numDeletedRows > 0n ? 'unmuted' : 'not_found' };
  }

  async function isRoomServerMuted({
    roomId,
    principal
  }: { roomId?: string; principal?: GatePrincipal | null } = {}): Promise<boolean> {
    if (!isGatePrincipal(principal)) return false;
    const row = await db
      .selectFrom('room_server_mutes')
      .select('room_id')
      .where('room_id', '=', roomId as string)
      .where('principal_type', '=', principal.principalType)
      .where('principal_id', '=', principal.principalId)
      .executeTakeFirst();
    return Boolean(row);
  }

  async function listRoomServerMutes(roomId: string): Promise<GatePrincipal[]> {
    const rows = await db
      .selectFrom('room_server_mutes')
      .select(['principal_type', 'principal_id'])
      .where('room_id', '=', roomId)
      .execute();
    return rows.map((row) => ({
      principalType: row.principal_type as GatePrincipal['principalType'],
      principalId: row.principal_id
    }));
  }

  return { clearRoomServerMute, isRoomServerMuted, listRoomServerMutes, setRoomServerMute };
}
