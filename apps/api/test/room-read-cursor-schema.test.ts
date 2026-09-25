import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { createMessageReadRepository } from '../src/domains/messaging/message-read-repository.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };

// Messages are stored to the microsecond; node-pg reads created_at as a
// millisecond Date. Reads bound by that Date excluded the newest message
// itself, and room reads once wrote a column room_chat_reads does not have,
// so nothing was stored — both brought the unread badge back on reload.
test('room and DM reads by cursor are stored and cover the microsecond-exact newest message', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: SILENT, noLock: true });
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  t.after(async () => { await pool.end(); await cleanup(); });

  const at = '2026-08-01 12:00:00.123456+00';
  const micros = String(Date.parse('2026-08-01T12:00:00.123Z') * 1000 + 456);
  await pool.query(`INSERT INTO users (id, login, display_name, password_hash) VALUES ('me', 'readme', 'Me', 'x'), ('peer', 'readpeer', 'Peer', 'x')`);
  await pool.query(`INSERT INTO rooms (id, creator_ip) VALUES ('room', '')`);
  await pool.query(`INSERT INTO room_messages (id, room_id, peer_id, name, text, created_at) VALUES ('r1', 'room', 'p', 'Peer', 'hi', $1)`, [at]);
  await pool.query(`INSERT INTO direct_messages (id, sender_id, recipient_id, body, created_at) VALUES ('d1', 'peer', 'me', 'hi', $1)`, [at]);

  const reads = createMessageReadRepository({ pool });
  const room = await reads.advanceRoom({ roomId: 'room', userId: 'me', tuple: { id: 'r1', createdAtMicros: micros } });
  assert.equal((room as { last_read_message_id: string }).last_read_message_id, 'r1');
  const stored = await pool.query<{ last_read_message_id: string }>(`SELECT last_read_message_id FROM room_chat_reads WHERE room_id = 'room' AND user_id = 'me'`);
  assert.equal(stored.rows[0]?.last_read_message_id, 'r1');
  assert.deepEqual(await reads.advanceRoom({ roomId: 'room', userId: 'me', tuple: { id: 'r1', createdAtMicros: micros } }), { unchanged: true });

  const dm = await reads.advanceDm({ peerId: 'peer', userId: 'me', tuple: { id: 'd1', createdAtMicros: micros } });
  assert.equal((dm as { last_read_message_id: string }).last_read_message_id, 'd1');
  const message = await pool.query<{ read_at: Date | null }>(`SELECT read_at FROM direct_messages WHERE id = 'd1'`);
  assert.ok(message.rows[0]?.read_at, 'the newest message itself is marked read');

  // A cursor that does not name the stored microsecond finds no message.
  assert.equal(await reads.advanceDm({ peerId: 'peer', userId: 'me', tuple: { id: 'd1', createdAtMicros: String(Number(micros) - 456) } }), null);
});
