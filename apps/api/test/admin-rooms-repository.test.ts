// The admin rooms repository over a migrated database: how an owner is shown.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomStore } from '../src/app/room-store.ts';
import { createUserStore } from '../src/app/user-store.ts';
import { createAdminRoomsRepository } from '../src/domains/admin/admin-rooms.repository.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;

test('an owner without a stored avatar colour is shown in the palette default', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  const users = createUserStore({ pool, logger: SILENT });
  const { user: owner } = await users.createUser({ login: 'olga', displayName: '', password: 'password123' });
  assert.ok(owner);
  const created = await createRoomStore({ pool }).createRoom({
    roomId: 'colour01',
    isStatic: true,
    now: 1000,
    ownerId: owner.id
  });
  assert.ok(created);
  await pool.query('ALTER TABLE users ALTER COLUMN avatar_color_key DROP NOT NULL');
  await pool.query('UPDATE users SET avatar_color_key = NULL WHERE id = $1', [owner.id]);

  const [row] = await createAdminRoomsRepository({ pool }).rooms(['colour01']);

  assert.equal(row?.owner?.avatarColorKey, 'blurple');
});
