'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const test = require('node:test');
const { runMigrations } = require('../src/lib/migrate');
const { createAttachmentRepository } = require('../src/domains/media/attachment-repository');
const { createTestDatabase } = require('./db-harness');
const SILENT = { log() {}, info() {}, warn() {}, error() {} };

async function setup(t) {
  const db = await createTestDatabase(t); await runMigrations({ databaseUrl: db.databaseUrl, logger: SILENT, noLock: true });
  const pool = new Pool({ connectionString: db.databaseUrl, max: 4 }); t.after(async () => { await pool.end(); await db.cleanup(); });
  await pool.query(`INSERT INTO users(id,login,display_name,password_hash) VALUES ('owner','bind-owner','Owner','x'),('peer','bind-peer','Peer','x'),('other','bind-other','Other','x'); INSERT INTO rooms(id,creator_ip) VALUES ('room',''); INSERT INTO room_messages(id,room_id,text) VALUES ('room-message','room','[Изображения: 2]'); INSERT INTO direct_messages(id,sender_id,recipient_id,body) VALUES ('dm-message','owner','peer','[Изображения: 1]')`);
  return { pool, repository: createAttachmentRepository({ pool }) };
}

async function ready(pool, { owner = 'owner', context = 'room' } = {}) {
  const id = crypto.randomUUID();
  await pool.query(`INSERT INTO message_attachments(id,owner_id,context,state,mime_type,original_bytes,processed_bytes,preview_bytes,width,height,original_storage_key,processed_storage_key,preview_storage_key,ready_at) VALUES ($1::uuid,$2,$3,'ready','image/jpeg',10,8,4,2,2,$1::text||'/original',$1::text||'/processed',$1::text||'/preview',current_timestamp)`, [id, owner, context]);
  return id;
}

test('G81-A01 room/DM bindings preserve order, owner/context and bind once', { skip: !process.env.TEST_DATABASE_URL, timeout: 120000 }, async (t) => {
  const { pool, repository } = await setup(t);
  const roomIds = [await ready(pool), await ready(pool)];
  assert.deepEqual((await repository.bindReady({ ownerId: 'owner', context: 'room', messageId: 'room-message', attachmentIds: roomIds })).map((item) => item.order), [0, 1]);
  await assert.rejects(repository.bindReady({ ownerId: 'owner', context: 'room', messageId: 'room-message', attachmentIds: roomIds }), /cannot be bound/);
  const dmId = await ready(pool, { context: 'dm' });
  assert.equal((await repository.bindReady({ ownerId: 'owner', context: 'dm', messageId: 'dm-message', attachmentIds: [dmId] }))[0].directMessageId, 'dm-message');
  assert.equal((await repository.listForMessage('room', 'room-message')).length, 2);
});

test('G81-A02 invalid/cross-owner draft rolls the message UoW back and fallback remains safe', { skip: !process.env.TEST_DATABASE_URL, timeout: 120000 }, async (t) => {
  const { pool, repository } = await setup(t);
  const foreign = await ready(pool, { owner: 'other' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO room_messages(id,room_id,text) VALUES ('rolled-back','room','[Изображения: 1]')`);
    await assert.rejects(repository.bindReady({ ownerId: 'owner', context: 'room', messageId: 'rolled-back', attachmentIds: [foreign] }, client), /cannot be bound/);
    await client.query('ROLLBACK');
  } finally { client.release(); }
  assert.equal((await pool.query(`SELECT count(*)::int count FROM room_messages WHERE id='rolled-back'`)).rows[0].count, 0);
  assert.equal((await pool.query(`SELECT text FROM room_messages WHERE id='room-message'`)).rows[0].text, '[Изображения: 2]');
});
