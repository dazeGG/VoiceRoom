import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { createAttachmentRepository } from '../src/domains/media/attachment.repository.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createUserStore } from '../src/app/user-store.ts';
import { createTestDatabase } from './db-harness.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };

test('markCleanupDeleted executes the stale-upload predicate against PostgreSQL', async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: SILENT });

  const users = createUserStore({ pool, logger: SILENT });
  t.after(async () => {
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
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: SILENT });
  const users = createUserStore({ pool, logger: SILENT });
  t.after(async () => {
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

// A history page reads the attachments of all its messages at once.
test('the attachments of several messages come back by message, in their order', async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: SILENT });
  t.after(async () => {
    await cleanup();
  });
  await pool.query(
    `INSERT INTO users (id, login, display_name, password_hash) VALUES ('ada', 'ada', 'Ада', 'x'), ('bob', 'bob', 'Боб', 'x');
     INSERT INTO rooms (id, creator_ip) VALUES ('room', '');
     INSERT INTO room_messages (id, room_id, text) VALUES ('r1', 'room', 'x'), ('r2', 'room', 'y'), ('r3', 'room', 'z');
     INSERT INTO direct_messages (id, sender_id, recipient_id, body) VALUES ('d1', 'ada', 'bob', 'hi');`
  );
  const bind = async (context: 'room' | 'dm', messageId: string, order: number) => {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO message_attachments (id, owner_id, context, state, mime_type, original_bytes, processed_bytes,
         preview_bytes, width, height, original_storage_key, processed_storage_key, preview_storage_key, ready_at,
         bound_at, room_message_id, direct_message_id, attachment_order)
       VALUES ($1::uuid, 'ada', $2, 'ready', 'image/webp', 10, 8, 4, 2, 2, $1::text || '/o', $1::text || '/p',
         $1::text || '/v', now(), now(), $3, $4, $5)`,
      [id, context, context === 'room' ? messageId : null, context === 'dm' ? messageId : null, order]
    );
    return id;
  };
  const second = await bind('room', 'r1', 1);
  const first = await bind('room', 'r1', 0);
  const other = await bind('room', 'r2', 0);
  const direct = await bind('dm', 'd1', 0);
  const repository = createAttachmentRepository({ pool });

  const room = await repository.listForMessages('room', ['r1', 'r2', 'r3']);
  assert.deepEqual(
    room.get('r1')?.map((attachment) => attachment.id),
    [first, second]
  );
  assert.deepEqual(
    room.get('r2')?.map((attachment) => attachment.id),
    [other]
  );
  assert.equal(room.has('r3'), false);
  assert.deepEqual(
    (await repository.listForMessages('dm', ['d1'])).get('d1')?.map((attachment) => attachment.id),
    [direct]
  );
  assert.equal((await repository.listForMessages('room', [])).size, 0);
  await assert.rejects(() => repository.listForMessages('channel', ['r1']), /Invalid attachment context/);
});
