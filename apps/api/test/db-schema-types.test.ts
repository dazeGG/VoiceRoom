// src/platform/db/schema.ts is generated from the migrated schema. A migration
// that changes a table without regenerating it would leave Kysely queries
// type-checking against columns that no longer exist; this regenerates against
// a fresh database and fails on any difference.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { Pool } from 'pg';
import { createTestDatabase } from './db-harness.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createKysely } from '../src/platform/db/kysely.ts';

const API_ROOT = path.resolve(import.meta.dirname, '..');
const SILENT = { log() {}, info() {}, warn() {}, error() {} };

test('generated Kysely schema types match the migrated database', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const db = await createTestDatabase(t);
  await runMigrations({ databaseUrl: db.databaseUrl, logger: SILENT });

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['run', '--silent', 'db:types', '--', '--verify'], {
    cwd: API_ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: db.databaseUrl },
    shell: process.platform === 'win32'
  });
  assert.equal(result.status, 0, `schema.ts is stale; run "npm --workspace @voice-room/api run db:types" against a migrated database\n${result.stdout}\n${result.stderr}`);
});

test('the Kysely instance queries through the shared pg pool', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const db = await createTestDatabase(t);
  await runMigrations({ databaseUrl: db.databaseUrl, logger: SILENT });
  const pool = new Pool({ connectionString: db.databaseUrl });
  const kysely = createKysely(pool);
  t.after(() => kysely.destroy());

  await kysely.insertInto('users').values({ id: 'kysely-user', login: 'kysely-user', display_name: 'K', password_hash: 'x' }).execute();
  const row = await kysely.selectFrom('users').select(['id', 'login']).where('id', '=', 'kysely-user').executeTakeFirstOrThrow();
  assert.deepEqual(row, { id: 'kysely-user', login: 'kysely-user' });
});
