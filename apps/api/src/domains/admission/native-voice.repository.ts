import { sql, type Selectable } from 'kysely';
import { nativeVoiceIdentity } from '@voiceroom/shared/validation';
import type { Database } from '../../platform/db/kysely.ts';
import type { NativeVoiceLeases } from '../../platform/db/schema.ts';
import type { GateClaims } from './gate-credential-signer.ts';

export type NativeVoiceLease = Selectable<NativeVoiceLeases>;

export function createNativeVoiceRepository(db: Database) {
  async function reserve(
    lease: Pick<NativeVoiceLease, 'id' | 'room_id' | 'peer_id' | 'generation' | 'account_id' | 'expires_at'>,
    cap: number
  ) {
    return db.transaction().execute(async (trx) => {
      const room = await trx
        .selectFrom('rooms')
        .select('id')
        .where('id', '=', lease.room_id)
        .where('kind', '=', 'main')
        .where('deleted_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!room) return false;
      // Pending and retiring leases both occupy physical capacity until cleanup confirms removal.
      const slots = await trx
        .selectFrom('native_voice_leases')
        .select('peer_id')
        .where('room_id', '=', lease.room_id)
        .limit(cap)
        .execute();
      if (slots.length >= cap || slots.some((slot) => slot.peer_id === lease.peer_id)) return false;
      await trx.insertInto('native_voice_leases').values(lease).execute();
      return true;
    });
  }

  async function activate(id: string, validUntil: Date): Promise<void> {
    await db
      .updateTable('native_voice_leases')
      .set({ valid_until: validUntil })
      .where('id', '=', id)
      .where('retired_at', 'is', null)
      .returning('id')
      .executeTakeFirstOrThrow();
  }

  async function extend(id: string, validUntil: Date): Promise<boolean> {
    const row = await db
      .updateTable('native_voice_leases')
      .set({ valid_until: validUntil })
      .where('id', '=', id)
      .where('retired_at', 'is', null)
      .where('valid_until', '>', sql<Date>`clock_timestamp()`)
      .where('expires_at', '>', sql<Date>`clock_timestamp()`)
      .where((eb) =>
        eb.exists(
          eb.selectFrom('livekit_gate_credentials').select('id').where('id', '=', id).where('revoked_at', 'is', null)
        )
      )
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('rooms')
            .select('id')
            .whereRef('rooms.id', '=', 'native_voice_leases.room_id')
            .where('deleted_at', 'is', null)
        )
      )
      .returning('id')
      .executeTakeFirst();
    return Boolean(row);
  }

  async function retire(lease: NativeVoiceLease, at: Date): Promise<boolean> {
    return db.transaction().execute(async (trx) => {
      const retired = await trx
        .updateTable('native_voice_leases')
        .set({ valid_until: null, retired_at: at })
        .where('id', '=', lease.id)
        .where('retired_at', 'is', null)
        .returning('id')
        .executeTakeFirst();
      if (!retired) return false;
      await trx
        .updateTable('livekit_gate_credentials')
        .set({ revoked_at: at })
        .where('id', '=', lease.id)
        .where('room_id', '=', lease.room_id)
        .where('peer_id', '=', nativeVoiceIdentity(lease.peer_id, lease.id))
        .where('principal_type', '=', 'account')
        .where('principal_id', '=', lease.account_id)
        .where('revoked_at', 'is', null)
        .execute();
      return true;
    });
  }

  async function finishCleanup(id: string, absent: boolean): Promise<void> {
    if (absent) {
      await db.deleteFrom('native_voice_leases').where('id', '=', id).where('retired_at', 'is not', null).execute();
    } else {
      await db
        .updateTable('native_voice_leases')
        .set({ cleanup_exhausted_at: new Date() })
        .where('id', '=', id)
        .where('retired_at', 'is not', null)
        .execute();
    }
  }

  function retired(limit: number, watched: string[], gateStartedAt: Date) {
    return db
      .selectFrom('native_voice_leases')
      .select(['id', 'room_id', 'peer_id', 'retired_at'])
      .where('retired_at', 'is not', null)
      .where((eb) => eb.or([eb('cleanup_exhausted_at', 'is', null), eb('cleanup_exhausted_at', '<', gateStartedAt)]))
      .$if(watched.length > 0, (query) => query.where('id', 'not in', watched))
      .orderBy('retired_at')
      .orderBy('id')
      .limit(limit)
      .$narrowType<{ retired_at: Date }>()
      .execute();
  }

  async function recover(roomId: string, identities: string[], signal: AbortSignal) {
    const now = new Date();
    const rows = await db
      .selectFrom('native_voice_leases as lease')
      .innerJoin('rooms as room', 'room.id', 'lease.room_id')
      .innerJoin('livekit_gate_credentials as credential', (join) =>
        join
          .on((eb) => eb('credential.id', '=', sql<string>`${eb.ref('lease.id')}::text`))
          .onRef('credential.room_id', '=', 'lease.room_id')
          .onRef('credential.principal_id', '=', 'lease.account_id')
          .on('credential.principal_type', '=', 'account')
      )
      .innerJoin('livekit_gate_principal_epochs as epoch', (join) =>
        join
          .onRef('epoch.room_id', '=', 'credential.room_id')
          .onRef('epoch.principal_id', '=', 'credential.principal_id')
          .onRef('epoch.principal_type', '=', 'credential.principal_type')
          .onRef('epoch.epoch', '=', 'credential.principal_epoch')
      )
      .select([
        'lease.id',
        'lease.peer_id',
        'lease.valid_until',
        'lease.expires_at',
        'credential.peer_id as identity',
        'credential.expires_at as credential_expiry'
      ])
      .where('room.kind', '=', 'main')
      .where('room.deleted_at', 'is', null)
      .where('lease.room_id', '=', roomId)
      .where('lease.retired_at', 'is', null)
      .where('lease.valid_until', '>', now)
      .where('lease.expires_at', '>', now)
      .where('credential.revoked_at', 'is', null)
      .where('credential.expires_at', '>', now)
      .where('credential.peer_id', 'in', identities)
      .$narrowType<{ valid_until: Date }>()
      .execute({ signal });
    return rows
      .filter((row) => row.identity === nativeVoiceIdentity(row.peer_id, row.id))
      .map((row) => {
        const expiresAt = Math.min(row.expires_at.getTime(), row.credential_expiry.getTime());
        return { identity: row.identity, expiresAt, deadline: Math.min(row.valid_until.getTime(), expiresAt) };
      });
  }

  function list(): Promise<NativeVoiceLease[]> {
    return db.selectFrom('native_voice_leases').selectAll().execute();
  }

  async function deadline(claims: GateClaims): Promise<number | null> {
    const now = new Date();
    const row = await db
      .selectFrom('native_voice_leases as lease')
      .innerJoin('rooms as room', 'room.id', 'lease.room_id')
      .select(['lease.valid_until', 'lease.expires_at'])
      .where('room.kind', '=', 'main')
      .where('room.deleted_at', 'is', null)
      .where('lease.id', '=', claims.cid)
      .where('lease.room_id', '=', claims.room)
      .where('lease.peer_id', '=', claims.peer)
      .where('lease.account_id', '=', claims.pId)
      .where('lease.retired_at', 'is', null)
      .where('lease.valid_until', '>', now)
      .where('lease.expires_at', '>', now)
      .executeTakeFirst();
    return row?.valid_until ? Math.min(row.valid_until.getTime(), row.expires_at.getTime(), claims.exp) : null;
  }

  return { reserve, activate, extend, retire, finishCleanup, retired, recover, list, deadline };
}

export type NativeVoiceRepository = ReturnType<typeof createNativeVoiceRepository>;
