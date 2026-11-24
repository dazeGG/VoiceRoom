import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { GateClaims } from '../src/domains/admission/gate-credential-signer.ts';
import { createNativeVoiceRepository } from '../src/domains/admission/native-voice.repository.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { kyselyOn } from '../src/platform/db/kysely.ts';
import { createTestDatabase } from './db-harness.ts';
import { rollBackThrough } from './migration-steps.ts';

const MIGRATION = '20261124120000_create_native_voice_leases';
const SILENT = { log() {}, info() {}, warn() {}, error() {} };

test('the native lease migration rolls down and back up without touching existing gate credentials', async (t) => {
  const { databaseUrl, pool, cleanup } = await createTestDatabase(t);
  t.after(cleanup);
  const roomId = 'native-migration';
  const peerId = 'native-peer';
  await pool.query('INSERT INTO rooms(id) VALUES ($1)', [roomId]);
  await pool.query(
    `
    INSERT INTO livekit_gate_credentials(id, room_id, peer_id, principal_type, principal_id, principal_epoch, credential_hash, expires_at)
    VALUES ('ordinary-credential', $1, $2, 'account', 'account', 0, repeat('a', 64), now() + interval '1 hour')
  `,
    [roomId, peerId]
  );
  const leases = createNativeVoiceRepository(kyselyOn(pool));
  const lease = {
    id: randomUUID(),
    room_id: roomId,
    peer_id: peerId,
    generation: 'a'.repeat(32),
    account_id: 'account',
    expires_at: new Date(Date.now() + 60_000)
  };
  assert.equal(await leases.reserve(lease, 2), true);
  assert.equal(await leases.reserve({ ...lease, id: randomUUID() }, 2), false);
  assert.equal((await leases.list()).length, 1);
  await rollBackThrough(databaseUrl, MIGRATION);
  await assert.rejects(leases.list(), { code: '42P01' });
  assert.equal(
    (await pool.query("SELECT id FROM livekit_gate_credentials WHERE id = 'ordinary-credential'")).rowCount,
    1
  );
  const applied = await runMigrations({ databaseUrl, logger: SILENT });
  assert.deepEqual(
    applied.map((migration) => migration.name),
    [MIGRATION]
  );
  assert.deepEqual(await leases.list(), []);
  assert.equal(await leases.reserve(lease, 1), true);
});

test('native voice cannot reserve a missing room or revive a retired lease', async (t) => {
  const { pool, cleanup } = await createTestDatabase(t);
  t.after(cleanup);
  const db = kyselyOn(pool);
  const leases = createNativeVoiceRepository(db);
  const lease = {
    id: randomUUID(),
    room_id: 'native-room',
    peer_id: 'native-peer',
    generation: 'a'.repeat(32),
    account_id: 'account',
    expires_at: new Date(Date.now() + 60_000),
    valid_until: null,
    retired_at: null,
    cleanup_exhausted_at: null
  };
  assert.equal(await leases.reserve(lease, 1), false);
  assert.deepEqual(await leases.list(), []);
  await db.insertInto('rooms').values({ id: lease.room_id }).execute();
  assert.equal(await leases.reserve(lease, 1), true);
  const validUntil = new Date(Date.now() + 30_000);
  await leases.activate(lease.id, validUntil);
  const claims: GateClaims = {
    cid: lease.id,
    companion: true,
    exp: lease.expires_at.getTime(),
    iat: Date.now(),
    peer: lease.peer_id,
    pEpoch: 0,
    pId: lease.account_id,
    pType: 'account',
    room: lease.room_id
  };
  assert.equal(await leases.deadline(claims), validUntil.getTime());
  const retiredAt = new Date();
  assert.equal(await leases.retire(lease, retiredAt), true);
  assert.equal(await leases.retire(lease, new Date(retiredAt.getTime() + 1_000)), false);
  assert.equal(await leases.deadline(claims), null);
  assert.deepEqual(await leases.list(), [{ ...lease, retired_at: retiredAt }]);
});
