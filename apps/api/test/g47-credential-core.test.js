'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { test } = require('node:test');
const { createCredentialBoundaryService } = require('../src/domains/admission/credential-boundary-service');
const { createRoomStore } = require('../src/lib/room-store');
const { runMigrations } = require('../src/lib/migrate');
const { createTestDatabase } = require('./db-harness');

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
  const root = path.resolve(__dirname, '../../..');
  const migrations = fs.readdirSync(path.join(root, 'apps/api/src/migrations')).filter((name) => /credential|livekit_gate/.test(name));
  assert.deepEqual(migrations, ['20260720160000_create_livekit_gate_credentials.js']);
  assert.equal(fs.existsSync(path.join(root, 'apps/api/src/migrations/20260718130000_create_room_credential_epochs.js')), false);
  const amendment = JSON.parse(fs.readFileSync(path.join(root, 'docs/releases/2.5.0/amendments/G47-MIGRATION-CATALOG.json'), 'utf8'));
  assert.equal(amendment.appliedPath, 'apps/api/src/migrations/20260720160000_create_livekit_gate_credentials.js');
  assert.equal(amendment.supersedesCatalogEntry, 'apps/api/src/migrations/20260718130000_create_room_credential_epochs.js');
});
