// LiveKit gate credentials and principal epochs. A credential is valid while it
// is unexpired, unrevoked and issued at its principal's current epoch; bumping
// the epoch revokes everything issued to that principal in the room at once.
// Writes for one principal are serialized by an advisory lock.

import { sql } from 'kysely';
import type { Database } from '../../platform/db/kysely.ts';
import { createRowId, toDate } from '../rooms/room.repository.ts';
import type { GatePrincipal } from './admission.service.ts';
import { isGatePrincipal } from './gate-principal.ts';

export type PrincipalEpoch = { status: 'ready'; epoch: number } | { status: 'invalid'; epoch: null };
export type PrincipalRevocation = { status: 'revoked'; epoch: number };

async function lockPrincipal(db: Database, roomId: string, principal: GatePrincipal): Promise<void> {
  const key = `voice-room:livekit-gate:${roomId}:${principal.principalType}:${principal.principalId}`;
  await sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`.execute(db);
}

/** The principal a gate credential is issued to: the account, else the room-scoped guest. */
export function normalizeGatePrincipal({
  accountUserId,
  guestPrincipalId,
  roomId
}: { accountUserId?: unknown; guestPrincipalId?: unknown; roomId?: string } = {}): GatePrincipal | null {
  if (typeof accountUserId === 'string' || typeof accountUserId === 'number') {
    if (accountUserId) return { principalType: 'account', principalId: String(accountUserId) };
  }
  const guest = typeof guestPrincipalId === 'string' ? guestPrincipalId.trim() : '';
  if (!roomId || !guest) return null;
  return { principalType: 'guest', principalId: `${roomId}:${guest}` };
}

/** Ensures the principal's epoch row exists (at 0) and returns its epoch. */
async function currentEpoch(db: Database, roomId: string, principal: GatePrincipal, now: number): Promise<number> {
  const row = await db
    .insertInto('livekit_gate_principal_epochs')
    .values({
      room_id: roomId,
      principal_type: principal.principalType,
      principal_id: principal.principalId,
      epoch: 0,
      updated_at: toDate(now)
    })
    .onConflict((oc) =>
      oc
        .columns(['room_id', 'principal_type', 'principal_id'])
        .doUpdateSet((eb) => ({ updated_at: eb.ref('excluded.updated_at') }))
    )
    .returning('epoch')
    .executeTakeFirst();
  return Number(row?.epoch || 0);
}

/**
 * Bumps the principal's epoch and revokes its open credentials, inside the
 * caller's transaction (a ban revokes several principals with its insert).
 */
export async function revokePrincipalInTransaction(
  trx: Database,
  { principal, roomId, now = Date.now() }: { principal: GatePrincipal; roomId: string; now?: number }
): Promise<PrincipalRevocation> {
  await lockPrincipal(trx, roomId, principal);
  const at = toDate(now);
  const epoch = await trx
    .insertInto('livekit_gate_principal_epochs')
    .values({
      room_id: roomId,
      principal_type: principal.principalType,
      principal_id: principal.principalId,
      epoch: 1,
      updated_at: at
    })
    .onConflict((oc) =>
      oc.columns(['room_id', 'principal_type', 'principal_id']).doUpdateSet((eb) => ({
        epoch: sql<number>`livekit_gate_principal_epochs.epoch + 1`,
        updated_at: eb.ref('excluded.updated_at')
      }))
    )
    .returning('epoch')
    .executeTakeFirst();
  await trx
    .updateTable('livekit_gate_credentials')
    .set((eb) => ({ revoked_at: eb.fn.coalesce('revoked_at', eb.val(at)) }))
    .where('room_id', '=', roomId)
    .where('principal_type', '=', principal.principalType)
    .where('principal_id', '=', principal.principalId)
    .where('revoked_at', 'is', null)
    .execute();
  return { status: 'revoked', epoch: Number(epoch?.epoch || 0) };
}

export function createGateCredentialRepository({ db }: { db: Database }) {
  async function createLiveKitGateCredential({
    credentialHash,
    credentialId = createRowId(),
    expiresAt,
    peerId,
    principal,
    principalEpoch = null,
    roomId,
    now = Date.now()
  }: {
    credentialHash?: string;
    credentialId?: string;
    expiresAt?: unknown;
    peerId?: string;
    principal?: GatePrincipal | null;
    principalEpoch?: number | null;
    roomId?: string;
    now?: number;
  } = {}) {
    if (!roomId || !peerId || !credentialHash || !principal?.principalType || !principal?.principalId) {
      return { status: 'invalid', credential: null };
    }
    return db.transaction().execute(async (trx) => {
      await lockPrincipal(trx, roomId, principal);
      const storedPrincipalEpoch = await currentEpoch(trx, roomId, principal, now);
      const credentialEpoch = principalEpoch === null ? storedPrincipalEpoch : Number(principalEpoch);
      if (credentialEpoch !== storedPrincipalEpoch) return { status: 'epoch_mismatch', credential: null };
      const inserted = await trx
        .insertInto('livekit_gate_credentials')
        .values({
          id: credentialId,
          room_id: roomId,
          peer_id: peerId,
          principal_type: principal.principalType,
          principal_id: principal.principalId,
          principal_epoch: credentialEpoch,
          credential_hash: credentialHash,
          created_at: toDate(now),
          expires_at: toDate(expiresAt)
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return {
        credential: {
          id: inserted.id,
          principalEpoch: credentialEpoch,
          principalId: principal.principalId,
          principalType: principal.principalType
        },
        status: 'created'
      };
    });
  }

  async function getLiveKitGatePrincipalEpoch({
    principal,
    roomId,
    now = Date.now()
  }: { principal?: GatePrincipal | null; roomId?: string; now?: number } = {}): Promise<PrincipalEpoch> {
    if (!roomId || !principal?.principalType || !principal?.principalId) return { status: 'invalid', epoch: null };
    return db.transaction().execute(async (trx): Promise<PrincipalEpoch> => {
      await lockPrincipal(trx, roomId, principal);
      return { status: 'ready', epoch: await currentEpoch(trx, roomId, principal, now) };
    });
  }

  async function verifyLiveKitGateCredential({
    credentialHash,
    peerId,
    principalEpoch,
    principalId,
    principalType,
    roomId,
    now = Date.now()
  }: {
    credentialHash?: string;
    peerId?: string;
    principalEpoch?: unknown;
    principalId?: string;
    principalType?: string;
    roomId?: string;
    now?: number;
  } = {}) {
    if (!roomId || !peerId || !credentialHash || !principalType || !principalId) return { status: 'invalid' };
    const epoch = Number(principalEpoch);
    const row = await db
      .selectFrom('livekit_gate_credentials as c')
      .innerJoin('livekit_gate_principal_epochs as e', (join) =>
        join
          .onRef('e.room_id', '=', 'c.room_id')
          .onRef('e.principal_type', '=', 'c.principal_type')
          .onRef('e.principal_id', '=', 'c.principal_id')
      )
      .select('c.id')
      .where('c.credential_hash', '=', credentialHash)
      .where('c.room_id', '=', roomId)
      .where('c.peer_id', '=', peerId)
      .where('c.principal_type', '=', principalType)
      .where('c.principal_id', '=', principalId)
      .where('c.principal_epoch', '=', epoch)
      .where('e.epoch', '=', epoch)
      .where('c.revoked_at', 'is', null)
      .where('c.expires_at', '>', toDate(now))
      .limit(1)
      .executeTakeFirst();
    return { status: row ? 'allowed' : 'denied' };
  }

  async function revokeLiveKitGatePrincipal({
    principal,
    roomId,
    now = Date.now()
  }: { principal?: GatePrincipal | null; roomId?: string; now?: number } = {}) {
    if (!roomId || !principal?.principalType || !principal?.principalId) return { status: 'invalid', epoch: null };
    const validPrincipal = principal;
    return db
      .transaction()
      .execute((trx) => revokePrincipalInTransaction(trx, { principal: validPrincipal, roomId, now }));
  }

  async function revokeLiveKitGateCredential({
    credentialId,
    principal,
    roomId,
    now = Date.now()
  }: { credentialId?: string; principal?: GatePrincipal | null; roomId?: string; now?: number } = {}) {
    if (!credentialId || !roomId || !isGatePrincipal(principal)) return { status: 'invalid' };
    return db.transaction().execute(async (trx) => {
      await lockPrincipal(trx, roomId, principal);
      const at = toDate(now);
      const row = await trx
        .updateTable('livekit_gate_credentials')
        .set((eb) => ({ revoked_at: eb.fn.coalesce('revoked_at', eb.val(at)) }))
        .where('id', '=', credentialId)
        .where('room_id', '=', roomId)
        .where('principal_type', '=', principal.principalType)
        .where('principal_id', '=', principal.principalId)
        .returning('id')
        .executeTakeFirst();
      return { status: row ? 'revoked' : 'not_found' };
    });
  }

  // Revokes only what was issued to one peer id. A principal revocation would
  // bump the epoch and cut the account off on every device in the room; ending a
  // single account session must leave its other devices connected.
  async function revokeLiveKitGateCredentialsForPeer({
    peerId,
    principal,
    roomId,
    now = Date.now()
  }: { peerId?: string; principal?: GatePrincipal | null; roomId?: string; now?: number } = {}) {
    if (!peerId || !roomId || !isGatePrincipal(principal)) return { status: 'invalid', revoked: 0 };
    return db.transaction().execute(async (trx) => {
      await lockPrincipal(trx, roomId, principal);
      const result = await trx
        .updateTable('livekit_gate_credentials')
        .set({ revoked_at: toDate(now) })
        .where('room_id', '=', roomId)
        .where('peer_id', '=', peerId)
        .where('principal_type', '=', principal.principalType)
        .where('principal_id', '=', principal.principalId)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();
      return { status: 'revoked', revoked: Number(result.numUpdatedRows) };
    });
  }

  async function revokeLiveKitGatePeer({
    roomId,
    accountUserId = null,
    guestPrincipalId = '',
    now = Date.now()
  }: {
    roomId?: string;
    /** Accepted for callers that name it; the whole principal is revoked. */
    peerId?: string;
    accountUserId?: string | null;
    guestPrincipalId?: string;
    now?: number;
  } = {}) {
    const principal = normalizeGatePrincipal({ accountUserId, guestPrincipalId, roomId });
    if (!principal) return { status: 'invalid', epoch: null };
    return revokeLiveKitGatePrincipal({ principal, roomId, now });
  }

  // Fails when the gate tables are missing: a readiness probe, not a lookup.
  async function assertLiveKitGateReady(): Promise<true> {
    await db
      .selectFrom('livekit_gate_credentials as c')
      .innerJoin('livekit_gate_principal_epochs as e', (join) =>
        join
          .onRef('e.room_id', '=', 'c.room_id')
          .onRef('e.principal_type', '=', 'c.principal_type')
          .onRef('e.principal_id', '=', 'c.principal_id')
      )
      .select('c.id')
      .limit(0)
      .execute();
    return true;
  }

  return {
    assertLiveKitGateReady,
    createLiveKitGateCredential,
    getLiveKitGatePrincipalEpoch,
    normalizeGatePrincipal,
    revokeLiveKitGateCredential,
    revokeLiveKitGateCredentialsForPeer,
    revokeLiveKitGatePeer,
    revokeLiveKitGatePrincipal,
    verifyLiveKitGateCredential
  };
}
