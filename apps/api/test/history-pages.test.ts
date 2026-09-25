// History pages around an anchor over a migrated database: a room and a DM
// thread (both directions of it) page forward and around a message, the
// anchor keeps its exact microseconds, and a thin side lends its space.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';

import { createRoomHistoryRepository } from '../src/domains/messaging/room-history-repository.ts';
import { createDmHistoryRepository } from '../src/domains/messaging/dm-history-repository.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;
const NOW = new Date('2026-08-02T00:00:00Z');
const ids = Array.from({ length: 9 }, (_, index) => `m${index + 1}`);

async function setup(t: TestContext) {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  await pool.query(
    `INSERT INTO users (id, login, display_name, password_hash) VALUES ('a', 'a', 'A', 'x'), ('b', 'b', 'B', 'x'), ('c', 'c', 'C', 'x');
     INSERT INTO friendships (id, user_a_id, user_b_id) VALUES ('f1', 'a', 'b');
     INSERT INTO rooms (id, creator_ip) VALUES ('room', '')`
  );
  // One message a microsecond apart; the DM thread alternates who sends.
  for (const [index, id] of ids.entries()) {
    const at = `2026-08-01T12:00:00.00000${index + 1}Z`;
    await pool.query(`INSERT INTO room_messages (id, room_id, text, created_at) VALUES ($1, 'room', $2, $3)`, [
      id,
      id,
      at
    ]);
    await pool.query(
      `INSERT INTO direct_messages (id, sender_id, recipient_id, body, created_at) VALUES ($1, $2, $3, $4, $5)`,
      [id, index % 2 ? 'b' : 'a', index % 2 ? 'a' : 'b', id, at]
    );
  }
  await pool.query(`UPDATE room_messages SET deleted_at = now() WHERE id = 'm9'`);
  return {
    rooms: createRoomHistoryRepository({ pool }),
    dms: createDmHistoryRepository({ pool })
  };
}

const idsOf = (page: { messages: { id: string }[] }) => page.messages.map((message) => message.id);

test('a room page opens around a message and pages forward from it', { skip }, async (t) => {
  const { rooms } = await setup(t);
  assert.equal(await rooms.roomExists('room'), true);
  assert.equal(await rooms.roomExists('other'), false);
  const anchor = await rooms.getAnchor({ roomId: 'room', messageId: 'm5' });
  assert.deepEqual(anchor, { id: 'm5', createdAtMicros: String(Date.parse('2026-08-01T12:00:00Z') * 1000 + 5) });
  assert.ok(anchor);
  assert.equal(await rooms.getAnchor({ roomId: 'room', messageId: 'missing' }), null);

  const around = await rooms.listAround({ roomId: 'room', anchor, limit: 4, now: NOW });
  assert.deepEqual(idsOf(around), ['m3', 'm4', 'm5', 'm6']);
  assert.deepEqual([around.hasMoreBefore, around.hasMoreAfter], [true, true]);

  const after = await rooms.listAfter({ roomId: 'room', anchor, limit: 2, now: NOW });
  assert.deepEqual(idsOf(after), ['m6', 'm7']);
  assert.equal(after.hasMoreAfter, true);
  const tail = await rooms.listAfter({ roomId: 'room', anchor, limit: 10, now: NOW });
  assert.deepEqual(idsOf(tail), ['m6', 'm7', 'm8'], 'a deleted message is not history');
  assert.equal(tail.hasMoreAfter, false);

  // Near the end the later side is thin, so the earlier side fills the page.
  const lastAnchor = await rooms.getAnchor({ roomId: 'room', messageId: 'm8' });
  assert.ok(lastAnchor);
  const nearEnd = await rooms.listAround({ roomId: 'room', anchor: lastAnchor, limit: 4, now: NOW });
  assert.deepEqual(idsOf(nearEnd), ['m5', 'm6', 'm7', 'm8']);
  assert.deepEqual([nearEnd.hasMoreBefore, nearEnd.hasMoreAfter], [true, false]);

  const latest = await rooms.listLatest({ roomId: 'room', limit: 3, now: NOW });
  assert.equal(latest.messages[0]?.createdAtMicros, String(Date.parse('2026-08-01T12:00:00Z') * 1000 + 6));
});

test('a DM thread pages around a message across both senders', { skip }, async (t) => {
  const { dms } = await setup(t);
  assert.equal(await dms.canReadThread({ userId: 'b', peerId: 'a' }), true);
  assert.equal(await dms.canReadThread({ userId: 'a', peerId: 'c' }), false, 'only friends read a thread');
  assert.equal(await dms.canReadThread({ userId: 'a', peerId: 'a' }), false);

  const anchor = { id: 'm2', createdAtMicros: String(Date.parse('2026-08-01T12:00:00Z') * 1000 + 2) };
  const around = await dms.listAround({ userId: 'a', peerId: 'b', anchor, limit: 4 });
  assert.deepEqual(idsOf(around), ['m1', 'm2', 'm3', 'm4'], 'the earlier side lends its space to the later');
  assert.deepEqual([around.hasMoreBefore, around.hasMoreAfter], [false, true]);
  assert.deepEqual(
    around.messages.map((message) => message.senderId),
    ['a', 'b', 'a', 'b']
  );

  const after = await dms.listAfter({ userId: 'b', peerId: 'a', anchor, limit: 3 });
  assert.deepEqual(idsOf(after), ['m3', 'm4', 'm5']);
  assert.equal(after.hasMoreAfter, true);
  const fifth = { id: 'm5', createdAtMicros: String(Date.parse('2026-08-01T12:00:00Z') * 1000 + 5) };
  const before = await dms.listBefore({ userId: 'a', peerId: 'b', anchor: fifth, limit: 3 });
  assert.deepEqual(idsOf(before), ['m2', 'm3', 'm4']);
  assert.equal(before.hasMoreBefore, true);
});
