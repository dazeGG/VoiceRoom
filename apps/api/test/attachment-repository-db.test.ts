import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Pool } from 'pg';

import { createAttachmentRepository } from '../src/domains/media/attachment-repository.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createUserStore } from '../src/lib/user-store.ts';
import { createTestDatabase } from './db-harness.ts';

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
    [attachmentId, created.user!.id]
  );

  const repository = createAttachmentRepository({ pool });
  const deleted = await repository.markCleanupDeleted(attachmentId);

  assert.equal(deleted?.id, attachmentId);
  assert.equal(deleted?.internalState, 'deleted');
  assert.ok(deleted?.deletedAt);

  const persisted = await pool.query('SELECT state, deleted_at FROM message_attachments WHERE id = $1', [attachmentId]);
  assert.equal(persisted.rows[0].state, 'deleted');
  assert.ok(persisted.rows[0].deleted_at);
});

// Retention: failed and abandoned uploads go after an hour, a ready image
// nobody attached after a day; a bound one stays.
test('cleanup lists only stale unbound attachments, each state with its own age', async (t) => {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: SILENT });
  const users = createUserStore({ databaseUrl, logger: SILENT });
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  t.after(async () => {
    await pool.end();
    await users.close();
    await cleanup();
  });
  const created = await users.createUser({ login: 'retention-owner', displayName: 'Owner', password: 'password123' });
  const ownerId = String(created.user?.id);
  await pool.query(
    `INSERT INTO rooms (id, creator_ip) VALUES ('room', ''); INSERT INTO room_messages (id, room_id, text) VALUES ('bound-message', 'room', 'x')`
  );

  const rows: Array<[string, string, string, boolean]> = [
    ['uploading-old', 'uploading', '2 hours', false],
    ['uploading-new', 'uploading', '30 minutes', false],
    ['failed-old', 'failed', '2 hours', false],
    ['ready-old', 'ready', '25 hours', false],
    ['ready-recent', 'ready', '2 hours', false],
    ['ready-bound', 'ready', '25 hours', true]
  ];
  const ids = new Map<string, string>();
  for (const [name, state, age, bound] of rows) {
    const id = crypto.randomUUID();
    ids.set(id, name);
    const ready = state === 'ready';
    await pool.query(
      `INSERT INTO message_attachments (id, owner_id, context, state, updated_at, bound_at, room_message_id, attachment_order,
         mime_type, original_bytes, width, height, original_storage_key, processed_storage_key, preview_storage_key,
         processed_bytes, preview_bytes, ready_at)
       VALUES ($1, $2, 'room', $3, current_timestamp - $4::interval, $5, $6, $7,
         $8, $9::int, $9::int, $9::int, $10, $10, $10, $9::int, $9::int, $11)`,
      [
        id,
        ownerId,
        state,
        age,
        bound ? new Date() : null,
        bound ? 'bound-message' : null,
        bound ? 0 : null,
        ready ? 'image/webp' : null,
        ready ? 10 : null,
        ready ? `key-${name}` : null,
        ready ? new Date() : null
      ]
    );
  }

  const candidates = await createAttachmentRepository({ pool }).listCleanupCandidates();
  assert.deepEqual(candidates.map((attachment) => ids.get(attachment.id)).sort(), [
    'failed-old',
    'ready-old',
    'uploading-old'
  ]);
});
