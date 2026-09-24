// @ts-nocheck -- not type-checked yet; remove once the file passes tsconfig.json.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { test } from 'node:test';
import { createCredentialBoundaryService } from '../src/domains/admission/credential-boundary-service.ts';
import { createRoomStore } from '../src/lib/room-store.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';

const signer = {
  hash: (value) => `hash-${value}`.padEnd(64, '0').slice(0, 64),
  sign: (claims) => JSON.stringify({
    peer: claims.peerId,
    pEpoch: claims.principalEpoch,
    pId: claims.principalId,
    pType: claims.principalType,
    room: claims.roomId
  }),
  verify: (value) => {
    try { return { ok: true, claims: JSON.parse(value) }; } catch { return { ok: false, code: 'invalid' }; }
  }
};

test('G47-A01 persisted epoch denies the exact credential after revoke', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: { log() {}, info() {}, warn() {}, error() {} }, noLock: true });
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  t.after(async () => { await pool.end(); await cleanup(); });
  await pool.query(`INSERT INTO rooms (id, creator_ip) VALUES ('g47-room', '')`);
  const boundary = createCredentialBoundaryService({ roomStore: createRoomStore({ pool }), signer, now: () => 1_800_000_000_000 });
  const principal = boundary.resolvePrincipal({ roomId: 'g47-room', accountUserId: 'account-1' });
  const issued = await boundary.issueCredential({ roomId: 'g47-room', peerId: 'peer-1', principal });
  assert.equal(issued.status, 'issued');
  assert.equal((await boundary.authorizeCredential(issued.credential.value)).ok, true);
  assert.equal((await boundary.revokePrincipal({ roomId: 'g47-room', principal })).status, 'revoked');
  assert.deepEqual(await boundary.authorizeCredential(issued.credential.value), { ok: false, code: 'denied' });
});

test('G47-A02 migration catalog has one applied credential schema and an explicit amendment', () => {
  const root = path.resolve(import.meta.dirname, '../../..');
  const migrations = fs.readdirSync(path.join(root, 'apps/api/src/migrations')).filter((name) => /credential|livekit_gate/.test(name));
  assert.deepEqual(migrations, ['20260720160000_create_livekit_gate_credentials.cjs']);
  assert.equal(fs.existsSync(path.join(root, 'apps/api/src/migrations/20260718130000_create_room_credential_epochs.cjs')), false);
  const amendment = JSON.parse(fs.readFileSync(path.join(root, 'docs/releases/2.5.0/amendments/G47-MIGRATION-CATALOG.json'), 'utf8'));
  // The 2.5.0 amendment predates the .cjs rename; the migration is the same file.
  assert.equal(amendment.appliedPath.replace(/\.c?js$/, ''), 'apps/api/src/migrations/20260720160000_create_livekit_gate_credentials');
  assert.equal(amendment.supersedesCatalogEntry.replace(/\.c?js$/, ''), 'apps/api/src/migrations/20260718130000_create_room_credential_epochs');
});
