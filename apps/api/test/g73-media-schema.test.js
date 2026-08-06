'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { Pool } = require('pg');
const test = require('node:test');
const { runMigrations } = require('../src/lib/migrate');
const { createTestDatabase } = require('./db-harness');
const SILENT = { log() {}, info() {}, warn() {}, error() {} };

test('G73-A01 fresh PG schema is repeatable, bounded and N-1-readable', { skip: !process.env.TEST_DATABASE_URL, timeout: 120000 }, async (t) => {
  const db = await createTestDatabase(t);
  await runMigrations({ databaseUrl: db.databaseUrl, logger: SILENT, noLock: true });
  const pool = new Pool({ connectionString: db.databaseUrl, max: 2 });
  t.after(async () => { await pool.end(); await db.cleanup(); });
  const digest = async () => crypto.createHash('sha256').update(JSON.stringify((await pool.query(`SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_name IN ('message_attachments','media_processing_jobs') ORDER BY 1,ordinal_position`)).rows)).digest('hex');
  const before = await digest();
  await runMigrations({ databaseUrl: db.databaseUrl, logger: SILENT, noLock: true });
  assert.equal(await digest(), before);
  const indexes = (await pool.query(`SELECT indexdef FROM pg_indexes WHERE tablename IN ('message_attachments','media_processing_jobs')`)).rows.map((row) => row.indexdef).join('\n');
  assert.match(indexes, /message_attachments_cleanup_idx/);
  assert.match(indexes, /media_processing_jobs_claim_idx/);
  assert.equal((await pool.query('SELECT count(*)::int count FROM room_messages')).rows[0].count, 0);
  const migration = fs.readFileSync(require.resolve('../src/migrations/20260718140000_create_message_attachments_and_media_jobs.js'), 'utf8');
  assert.match(migration, /lock_timeout = '5s'/);
  assert.doesNotMatch(migration, /20971520/);
});

test('G73-A02 constraints reject illegal bytes/states/transitions and application rollback is clean', { skip: !process.env.TEST_DATABASE_URL, timeout: 120000 }, async (t) => {
  const db = await createTestDatabase(t);
  await runMigrations({ databaseUrl: db.databaseUrl, logger: SILENT, noLock: true });
  const pool = new Pool({ connectionString: db.databaseUrl, max: 2 });
  t.after(async () => { await pool.end(); await db.cleanup(); });
  await pool.query(`INSERT INTO users(id,login,display_name,password_hash) VALUES ('media-owner','media-owner','Owner','x')`);
  const insert = (id, state = 'uploading', bytes = 1) => pool.query(`INSERT INTO message_attachments(id,owner_id,context,state,reserved_bytes) VALUES ($1,'media-owner','room',$2,$3)`, [id, state, bytes]);
  await assert.rejects(insert(crypto.randomUUID(), 'unknown', 1));
  await assert.rejects(insert(crypto.randomUUID(), 'uploading', 10 * 1024 * 1024 + 1));
  const id = crypto.randomUUID(); await insert(id);
  await assert.rejects(pool.query(`UPDATE message_attachments SET state='ready' WHERE id=$1`, [id]));
  const client = await pool.connect();
  try { await client.query('BEGIN'); await client.query(`INSERT INTO message_attachments(id,owner_id,context) VALUES ($1,'media-owner','dm')`, [crypto.randomUUID()]); await client.query('ROLLBACK'); }
  finally { client.release(); }
  assert.equal((await pool.query(`SELECT count(*)::int count FROM message_attachments`)).rows[0].count, 1);
});
