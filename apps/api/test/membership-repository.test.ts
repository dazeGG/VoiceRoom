// Room memberships over a migrated database: joining again keeps an owner an
// owner and merges metadata, leaving returns the removed row, and the member
// directory pages in joining order with a name or login prefix search.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';

import { createMembershipRepository } from '../src/domains/membership/membership-repository.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;

async function setup(t: TestContext) {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  await pool.query(
    `INSERT INTO users (id, login, display_name, password_hash)
     VALUES ('ada', 'ada', 'Ада', 'x'), ('bob', 'bob', '', 'x'), ('bea', 'beatrice', 'Bea', 'x'), ('eve', 'eve', 'Eve', 'x');
     INSERT INTO rooms (id, creator_ip) VALUES ('room', ''), ('gone', '');
     UPDATE rooms SET deleted_at = now() WHERE id = 'gone'`
  );
  return { pool, memberships: createMembershipRepository({ pool }) };
}

test('joining again keeps an owner an owner and merges the metadata', { skip }, async (t) => {
  const { memberships } = await setup(t);
  assert.equal(await memberships.upsertActive({ roomId: '', userId: 'ada' }), null);

  const owner = await memberships.upsertActive({
    roomId: 'room',
    userId: 'ada',
    role: 'owner',
    metadata: { source: 'create' },
    at: 1_000
  });
  assert.deepEqual([owner?.role, owner?.createdAt, owner?.metadata], ['owner', 1_000, { source: 'create' }]);

  const again = await memberships.upsertActive({
    roomId: 'room',
    userId: 'ada',
    role: 'member',
    metadata: { invite: 'link' },
    at: 2_000
  });
  assert.deepEqual(
    [again?.id, again?.role, again?.createdAt, again?.updatedAt, again?.metadata],
    [owner?.id, 'owner', 1_000, 2_000, { source: 'create', invite: 'link' }]
  );

  const member = await memberships.upsertActive({ roomId: 'room', userId: 'bob', role: 'admin', metadata: 'bad' });
  assert.deepEqual([member?.role, member?.metadata], ['member', {}]);
  assert.equal(await memberships.isActive('room', 'bob'), true);

  const removed = await memberships.deleteActive('room', 'bob');
  assert.equal(removed?.id, member?.id);
  assert.equal(await memberships.deleteActive('room', 'bob'), null);
  assert.equal(await memberships.getActive('room', 'bob'), null);
  assert.equal(await memberships.getActive('', 'bob'), null);
});

test('the directory pages in joining order and searches by name or login prefix', { skip }, async (t) => {
  const { memberships } = await setup(t);
  for (const [index, userId] of ['ada', 'bob', 'bea', 'eve'].entries()) {
    await memberships.upsertActive({ roomId: 'room', userId, at: Date.UTC(2026, 7, 1, 12, 0, index) });
  }
  await memberships.upsertActive({ roomId: 'gone', userId: 'ada' });

  const first = await memberships.listDirectoryPage({ roomId: 'room', limit: 2 });
  assert.deepEqual(
    first.members.map((member) => [member.userId, member.displayName]),
    [
      ['ada', 'Ада'],
      ['bob', '']
    ]
  );
  assert.equal(first.hasMore, true);
  assert.equal(first.members[0]?.cursorTuple.createdAtMicros, String(Date.UTC(2026, 7, 1, 12, 0, 0) * 1000));

  const second = await memberships.listDirectoryPage({
    roomId: 'room',
    limit: 2,
    after: first.members[1]?.cursorTuple
  });
  assert.deepEqual(
    second.members.map((member) => member.userId),
    ['bea', 'eve']
  );
  assert.equal(second.hasMore, false);

  const byName = await memberships.listDirectoryPage({ roomId: 'room', query: ' B ' });
  assert.deepEqual(
    byName.members.map((member) => member.userId),
    ['bob', 'bea'],
    'an empty display name falls back to the login; a login prefix matches too'
  );
  const byLogin = await memberships.listDirectoryPage({ roomId: 'room', query: 'beatr' });
  assert.deepEqual(
    byLogin.members.map((member) => member.userId),
    ['bea']
  );
  assert.deepEqual(await memberships.listDirectoryPage({ roomId: 'gone' }), { members: [], hasMore: false });
});
