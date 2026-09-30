import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { Pool } from 'pg';
import { createDmHistoryRepository } from '../src/domains/messaging/dm-history.repository.ts';
import { createRoomHistoryRepository } from '../src/domains/messaging/room-history.repository.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';

const quiet = { log() {}, info() {}, warn() {}, error() {} };

test('G24-A01 history indexes are additive tuple indexes', () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/migrations/20260718121000_add_message_history_cursor_indexes.cjs'),
    'utf8'
  );
  assert.match(source, /sender_id, recipient_id, created_at DESC, id DESC/);
  assert.match(source, /recipient_id, sender_id, created_at DESC, id DESC/);
  assert.match(source, /WHERE deleted_at IS NULL/g);
  assert.match(source, /exports\.down = \(\) => \{\}/);
});

// Messages written in the same microsecond are ordered by id, so paging
// through them neither repeats nor skips one (an OFFSET or a timestamp-only
// cursor would).
test(
  'G24-A02 room and DM history page through equal-time messages without gaps or repeats',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { cleanup, databaseUrl } = await createTestDatabase(t);
    await runMigrations({ databaseUrl, logger: quiet, noLock: true });
    const pool = new Pool({ connectionString: databaseUrl, max: 2 });
    t.after(async () => {
      await pool.end();
      await cleanup();
    });

    const at = new Date('2026-08-01T12:00:00.000Z');
    const ids = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'];
    await pool.query(
      `INSERT INTO users (id, login, display_name, password_hash) VALUES ('a', 'g24a', 'A', 'x'), ('b', 'g24b', 'B', 'x')`
    );
    await pool.query(`INSERT INTO rooms (id, creator_ip) VALUES ('room', '')`);
    for (const id of ids) {
      await pool.query(
        `INSERT INTO room_messages (id, room_id, peer_id, name, text, created_at) VALUES ($1, 'room', 'p', 'A', $2, $3)`,
        [id, id, at]
      );
      await pool.query(
        `INSERT INTO direct_messages (id, sender_id, recipient_id, body, created_at) VALUES ($1, 'a', 'b', $2, $3)`,
        [id, id, at]
      );
    }

    const now = new Date('2026-08-02T00:00:00.000Z');
    const rooms = createRoomHistoryRepository({ pool });
    const seenRoom: string[] = [];
    let page = await rooms.listLatest({ roomId: 'room', limit: 3, now });
    seenRoom.unshift(...page.messages.map((message) => message.id));
    while (page.hasMoreBefore) {
      const first = page.messages[0]!;
      page = await rooms.listBefore({
        roomId: 'room',
        anchor: { id: first.id, createdAtMicros: first.createdAtMicros },
        limit: 3,
        now
      });
      seenRoom.unshift(...page.messages.map((message) => message.id));
    }
    assert.deepEqual(seenRoom, ids);

    const dms = createDmHistoryRepository({ pool });
    const seenDm: string[] = [];
    let dmPage = await dms.listLatest({ userId: 'a', peerId: 'b', limit: 3 });
    seenDm.unshift(...dmPage.messages.map((message) => message.id));
    while (dmPage.hasMoreBefore) {
      const first = dmPage.messages[0]!;
      dmPage = await dms.listBefore({
        userId: 'a',
        peerId: 'b',
        anchor: { id: first.id, createdAtMicros: first.createdAtMicros },
        limit: 3
      });
      seenDm.unshift(...dmPage.messages.map((message) => message.id));
    }
    assert.deepEqual(seenDm, ids);
  }
);
