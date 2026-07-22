'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');

const { createAttachmentRepository } = require('../src/domains/media/attachment-repository');
const { runMigrations } = require('../src/lib/migrate');
const { createUserStore } = require('../src/lib/user-store');
const { createTestDatabase } = require('./db-harness');

const SILENT = { log() {}, info() {}, warn() {}, error() {} };

test('markCleanupDeleted executes the stale-upload predicate against PostgreSQL', async (t) => {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: SILENT });

  const users = createUserStore({ databaseUrl, logger: SILENT });
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  t.after(async () => {
    await pool.end();
    await users.close();
    await cleanup();
  });

  const created = await users.createUser({
    login: 'cleanup-owner',
    displayName: 'Cleanup Owner',
    password: 'password123'
  });
  assert.equal(created.status, 'created');

  const attachmentId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO message_attachments (id, owner_id, context, state, updated_at)
     VALUES ($1, $2, 'room', 'uploading', current_timestamp - interval '2 hours')`,
    [attachmentId, created.user.id]
  );

  const repository = createAttachmentRepository({ pool });
  const deleted = await repository.markCleanupDeleted(attachmentId);

  assert.equal(deleted?.id, attachmentId);
  assert.equal(deleted?.internalState, 'deleted');
  assert.ok(deleted?.deletedAt);

  const persisted = await pool.query(
    'SELECT state, deleted_at FROM message_attachments WHERE id = $1',
    [attachmentId]
  );
  assert.equal(persisted.rows[0].state, 'deleted');
  assert.ok(persisted.rows[0].deleted_at);
});
