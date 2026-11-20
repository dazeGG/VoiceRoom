#!/usr/bin/env node
// Local deployment operator only. No public HTTP surface or credentials in output.
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { RoomServiceClient } from 'livekit-server-sdk';
import { readDatabaseConfig } from '../lib/config.ts';
import { transaction } from '../platform/db/pool.ts';
import { liveKitHttpUrl } from '../domains/admission/livekit-config.ts';
import { getLiveKitRoomName, normalizeLiveKitRoomPrefix } from '../domains/admission/livekit-token-binding.mts';
import type { RoomKind } from '../domains/rooms/room-surface.policy.ts';

export interface RecoveryMedia {
  listRooms(): Promise<Array<{ name: string; numParticipants: number }>>;
  deleteRoom(name: string): Promise<unknown>;
}
export async function runWidgetRecovery({
  pool,
  media,
  prefix,
  command
}: {
  pool: Pool;
  media: RecoveryMedia;
  prefix: string;
  command: 'recover' | 'verify-disabled';
}) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('voice-room:widget-recovery'))");
    let generation: string;
    if (command === 'recover') {
      const disabled = await client.query<{ generation: string }>(
        'UPDATE widget_boundary_activation SET widget_admission_enabled=false,recovery_generation=recovery_generation+1 WHERE singleton RETURNING recovery_generation::text AS generation'
      );
      if (!disabled.rows[0]) throw new Error('activation_state_missing');
      generation = disabled.rows[0].generation;
    } else {
      const state = await client.query<{ generation: string; enabled: boolean }>(
        'SELECT recovery_generation::text AS generation,widget_admission_enabled AS enabled FROM widget_boundary_activation WHERE singleton'
      );
      if (!state.rows[0] || state.rows[0].enabled) throw new Error('admission_not_disabled');
      generation = state.rows[0].generation;
    }
    type Proof = { role: 'api' | 'gate'; owner_id: string; ack: string | null; live: boolean };
    async function ownedProof(): Promise<Proof[]> {
      const result = await client.query<Proof>(`SELECT o.role,o.owner_id,o.acknowledged_generation::text AS ack,
        EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=o.backend_pid AND l.locktype='advisory' AND l.classid=870113 AND l.objid=CASE WHEN o.role='api' THEN 1 ELSE 2 END AND l.objsubid=2 AND l.mode='ExclusiveLock' AND l.granted AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())) AS live
        FROM widget_runtime_owners o WHERE o.owner_id IS NOT NULL ORDER BY o.role`);
      return result.rows;
    }
    const deadline = Date.now() + (command === 'recover' ? 20000 : 0);
    let proof: Proof[] = [];
    for (;;) {
      const state = await client.query<{ generation: string; enabled: boolean }>(
        'SELECT recovery_generation::text AS generation,widget_admission_enabled AS enabled FROM widget_boundary_activation WHERE singleton'
      );
      if (state.rows[0]?.generation !== generation || state.rows[0].enabled)
        throw new Error('recovery_generation_changed');
      proof = await ownedProof();
      if (proof.length === 2 && proof.every((row) => row.live && row.ack === generation)) break;
      if (Date.now() >= deadline) throw new Error('widget_runtime_quiescence_unproven');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const apiOwner = proof.find((row) => row.role === 'api')?.owner_id;
    const gateOwner = proof.find((row) => row.role === 'gate')?.owner_id;
    if (!apiOwner || !gateOwner) throw new Error('widget_runtime_owner_missing');
    if (command === 'recover') {
      await client.query('BEGIN');
      try {
        await client.query(
          "UPDATE livekit_gate_principal_epochs e SET epoch=epoch+1,updated_at=clock_timestamp() FROM rooms r WHERE r.id=e.room_id AND r.kind='widget'"
        );
        await client.query(
          "UPDATE livekit_gate_credentials c SET revoked_at=COALESCE(c.revoked_at,clock_timestamp()) FROM rooms r WHERE r.id=c.room_id AND r.kind='widget'"
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    const state = await client.query<{ widget_admission_enabled: boolean }>(
      'SELECT widget_admission_enabled FROM widget_boundary_activation WHERE singleton'
    );
    if (state.rows[0]?.widget_admission_enabled !== false) throw new Error('admission_not_disabled');
    const remaining = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM livekit_gate_credentials c JOIN rooms r ON r.id=c.room_id WHERE r.kind='widget' AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()"
    );
    if (remaining.rows[0]?.count !== 0) throw new Error('credentials_not_revoked');
    const rows = await client.query<{ id: string; kind: RoomKind }>('SELECT id,kind FROM rooms');
    const known = new Map(rows.rows.map((row) => [getLiveKitRoomName(row.id, prefix), row.kind]));
    const rooms = await media.listRooms();
    if (rooms.some((room) => room.name.startsWith(prefix) && !known.has(room.name)))
      throw new Error('unclassified_media_room');
    const widgets = rooms.filter((room) => known.get(room.name) === 'widget');
    if (command === 'recover') for (const room of widgets) await media.deleteRoom(room.name);
    const after = await media.listRooms();
    if (after.some((room) => room.name.startsWith(prefix) && !known.has(room.name)))
      throw new Error('unclassified_media_room');
    if (after.some((room) => known.get(room.name) === 'widget' && room.numParticipants !== 0))
      throw new Error('widget_media_not_terminated');
    // DB occupancy is supplemental; matching live runtime ACKs are the proof of WS/lease quiescence.
    const occupancy = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM rooms WHERE kind='widget' AND empty_since IS NULL"
    );
    if (occupancy.rows[0]?.count !== 0) throw new Error('widget_api_occupancy_not_empty');
    // Recheck after awaited SFU operations; concurrent activation cannot be mistaken for recovery.
    const final = await client.query<{
      enabled: boolean;
      credentials: number;
      generation: string;
    }>(`SELECT a.widget_admission_enabled AS enabled,a.recovery_generation::text AS generation,
      (SELECT count(*)::int FROM livekit_gate_credentials c JOIN rooms r ON r.id=c.room_id WHERE r.kind='widget' AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()) AS credentials FROM widget_boundary_activation a WHERE singleton`);
    if (final.rows[0]?.enabled !== false || final.rows[0].credentials !== 0 || final.rows[0].generation !== generation)
      throw new Error('recovery_state_changed');
    const finalProof = await ownedProof();
    if (
      finalProof.length !== 2 ||
      finalProof.some(
        (row) => !row.live || row.ack !== generation || row.owner_id !== (row.role === 'api' ? apiOwner : gateOwner)
      )
    )
      throw new Error('widget_runtime_owner_changed');
    return {
      recoveryGeneration: generation,
      apiOwner,
      gateOwner,
      widgetApiQuiescent: true,
      widgetGateQuiescent: true,
      ok: true,
      command,
      admissionDisabled: true,
      credentialsRevoked: true,
      widgetMediaEmpty: true,
      widgetOccupancyEmpty: true,
      widgetRooms: widgets.length
    };
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtext('voice-room:widget-recovery'))");
    } finally {
      client.release();
    }
  }
}
async function main() {
  const command = process.argv[2];
  if (command !== 'recover' && command !== 'verify-disabled') throw new Error('invalid_command');
  const env = process.env;
  const pool = new Pool({
    connectionString: readDatabaseConfig(env).url,
    connectionTimeoutMillis: 5000,
    query_timeout: 15000
  });
  try {
    const url = env.LIVEKIT_INTERNAL_URL || env.LIVEKIT_URL;
    if (!url || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
      if (command === 'recover') {
        await transaction(pool, async (client) => {
          await client.query("SET LOCAL lock_timeout = '5s'");
          await client.query("SELECT pg_advisory_xact_lock(hashtext('voice-room:widget-recovery'))");
          await client.query(
            'UPDATE widget_boundary_activation SET widget_admission_enabled=false,recovery_generation=recovery_generation+1 WHERE singleton'
          );
        });
      }
      throw new Error('media_configuration_missing');
    }
    const media = new RoomServiceClient(liveKitHttpUrl(url), env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
    console.log(
      JSON.stringify(
        await runWidgetRecovery({ pool, media, prefix: normalizeLiveKitRoomPrefix(env.LIVEKIT_ROOM_PREFIX), command })
      )
    );
  } finally {
    await pool.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main().catch((error: unknown) => {
    const code =
      error instanceof Error && error.message === 'media_configuration_missing'
        ? 'media_configuration_missing'
        : 'widget_recovery_failed';
    console.error(JSON.stringify({ ok: false, code }));
    process.exitCode = 1;
  });
