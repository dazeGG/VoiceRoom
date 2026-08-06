'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { Pool } = require('pg');
const path = require('node:path');
const { runner } = require('node-pg-migrate');
const test = require('node:test');
const { runMigrations } = require('../src/lib/migrate');
const { createAttachmentRepository } = require('../src/domains/media/attachment-repository');
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
  const migration = fs.readFileSync(require.resolve('../src/migrations/20260720162000_limit_message_attachment_bytes.js'), 'utf8');
  assert.match(migration, /lock_timeout = '5s'/);
  assert.match(migration, /10485760/);
  assert.match(migration, /20971520/);
});

test('G73-A03 upgrade remediates historical 10-20MiB rows before validation and remains rollback safe', { skip: !process.env.TEST_DATABASE_URL, timeout: 120000 }, async (t) => {
  const db = await createTestDatabase(t); await runMigrations({ databaseUrl: db.databaseUrl, logger: SILENT, noLock: true });
  const pool = new Pool({ connectionString: db.databaseUrl, max: 2 }); t.after(async () => { await pool.end(); await db.cleanup(); });
  await runner({ databaseUrl: db.databaseUrl, dir: path.resolve(__dirname, '../src/migrations'), direction: 'down', count: 1, migrationsTable: 'pgmigrations', logger: SILENT, noLock: true });
  await pool.query(`INSERT INTO users(id,login,display_name,password_hash) VALUES ('rollback-owner','rollback-owner','Owner','x')`);
  const uploadingId=crypto.randomUUID(), processingId=crypto.randomUUID(), readyId=crypto.randomUUID(), safeId=crypto.randomUUID();
  await pool.query(`INSERT INTO message_attachments(id,owner_id,context,state,reserved_bytes,reservation_expires_at) VALUES ($1,'rollback-owner','room','uploading',15728640,current_timestamp+interval '1 hour'),($2,'rollback-owner','room','uploading',10485760,current_timestamp+interval '1 hour')`,[uploadingId,safeId]);
  await pool.query(`INSERT INTO message_attachments(id,owner_id,context,state,mime_type,original_bytes,width,height,original_storage_key,uploaded_at) VALUES ($1::uuid,'rollback-owner','room','processing','image/jpeg',18874368,10,10,$1::text||'/original',current_timestamp)`,[processingId]);
  await pool.query(`INSERT INTO message_attachments(id,owner_id,context,state,mime_type,original_bytes,processed_bytes,preview_bytes,width,height,original_storage_key,processed_storage_key,preview_storage_key,ready_at) VALUES ($1::uuid,'rollback-owner','room','ready','image/jpeg',12582912,100,50,10,10,$1::text||'/original',$1::text||'/processed',$1::text||'/preview',current_timestamp)`,[readyId]);
  await pool.query(`INSERT INTO media_processing_jobs(id,attachment_id,state) VALUES ($1,$2,'pending'),($3,$4,'pending')`,[crypto.randomUUID(),uploadingId,crypto.randomUUID(),processingId]);
  await runner({ databaseUrl: db.databaseUrl, dir: path.resolve(__dirname, '../src/migrations'), direction: 'up', count: 1, migrationsTable: 'pgmigrations', logger: SILENT, noLock: true });
  const remediated=(await pool.query(`SELECT id,state,reserved_bytes,original_bytes,failure_code,deleted_at,metadata,original_storage_key FROM message_attachments WHERE id=ANY($1::uuid[]) ORDER BY id`,[[uploadingId,processingId,readyId]])).rows;
  assert.equal(remediated.length,3);
  for(const row of remediated){assert.equal(row.state,'deleted');assert.equal(row.reserved_bytes,null);assert.equal(row.original_bytes,null);assert.equal(row.failure_code,'media_oversize_10mib');assert.ok(row.deleted_at);assert.equal(row.metadata.migrationRemediation.reason,'attachment_exceeds_10mib');assert.equal(row.metadata.migrationRemediation.migration,'20260720162000_limit_message_attachment_bytes');}
  assert.ok(remediated.find((row)=>row.id===processingId).original_storage_key.endsWith('/original'));
  assert.deepEqual((await pool.query(`SELECT DISTINCT state,last_error FROM media_processing_jobs ORDER BY state`)).rows,[{state:'dead',last_error:'attachment remediated: media_oversize_10mib'}]);
  assert.equal((await pool.query(`SELECT convalidated FROM pg_constraint WHERE conname='message_attachments_bytes_check'`)).rows[0].convalidated,true);
  const repository=createAttachmentRepository({pool}); assert.deepEqual(await repository.quotaUsage('rollback-owner'),{pendingCount:1,recentCount:4,usedBytes:10485760});
  await assert.rejects(pool.query(`INSERT INTO message_attachments(id,owner_id,context,state,reserved_bytes) VALUES ($1,'rollback-owner','room','uploading',15728640)`, [crypto.randomUUID()]));
  const snapshot=JSON.stringify(remediated); await runMigrations({databaseUrl:db.databaseUrl,logger:SILENT,noLock:true}); assert.equal(JSON.stringify((await pool.query(`SELECT id,state,reserved_bytes,original_bytes,failure_code,deleted_at,metadata,original_storage_key FROM message_attachments WHERE id=ANY($1::uuid[]) ORDER BY id`,[[uploadingId,processingId,readyId]])).rows),snapshot);
  await runner({ databaseUrl: db.databaseUrl, dir: path.resolve(__dirname, '../src/migrations'), direction: 'down', count: 1, migrationsTable: 'pgmigrations', logger: SILENT, noLock: true });
  const rollbackId=crypto.randomUUID(); await pool.query(`INSERT INTO message_attachments(id,owner_id,context,state,reserved_bytes) VALUES ($1,'rollback-owner','room','uploading',15728640)`,[rollbackId]);
  assert.equal((await repository.findById(readyId)).internalState,'deleted'); assert.equal((await repository.findById(rollbackId)).reservedBytes,15728640);
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
