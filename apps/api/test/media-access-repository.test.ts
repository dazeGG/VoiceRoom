// Who may see an attachment's message, over a migrated database: a room member
// sees a live, unexpired message in a live room; a direct message is seen only
// by its sender and recipient.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createMediaAccessRepository } from '../src/domains/media/media-access.repository.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;

test('attachment messages are visible to room members and to both sides of a DM', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  await pool.query(
    `INSERT INTO users (id, login, display_name, password_hash) VALUES ('ada', 'ada', 'A', 'x'), ('bob', 'bob', 'B', 'x'), ('eve', 'eve', 'E', 'x');
     INSERT INTO rooms (id, creator_ip) VALUES ('room', ''), ('gone', '');
     INSERT INTO room_memberships (id, room_id, user_id) VALUES ('m1', 'room', 'ada'), ('m2', 'gone', 'ada');
     INSERT INTO room_messages (id, room_id, text) VALUES ('live', 'room', 'x'), ('deleted', 'room', 'x'), ('in-gone', 'gone', 'x');
     INSERT INTO room_messages (id, room_id, text, expires_at) VALUES
       ('expired', 'room', 'x', now() - interval '1 minute'), ('expiring', 'room', 'x', now() + interval '1 hour');
     UPDATE room_messages SET deleted_at = now() WHERE id = 'deleted';
     UPDATE rooms SET deleted_at = now() WHERE id = 'gone';
     INSERT INTO direct_messages (id, sender_id, recipient_id, body) VALUES ('dm', 'ada', 'bob', 'x'), ('dm-deleted', 'ada', 'bob', 'x');
     UPDATE direct_messages SET deleted_at = now() WHERE id = 'dm-deleted'`
  );
  const access = createMediaAccessRepository({ pool });
  const room = (messageId: string, viewerId = 'ada') => access.roomOfVisibleRoomMessage({ messageId, viewerId });

  assert.equal(await room('live'), 'room');
  assert.equal(await room('expiring'), 'room');
  assert.equal(await room('live', 'eve'), null, 'not a member');
  assert.equal(await room('deleted'), null);
  assert.equal(await room('expired'), null);
  assert.equal(await room('in-gone'), null, 'the room was deleted');

  const direct = (messageId: string, viewerId: string) => access.canSeeDirectMessage({ messageId, viewerId });
  assert.equal(await direct('dm', 'ada'), true);
  assert.equal(await direct('dm', 'bob'), true);
  assert.equal(await direct('dm', 'eve'), false);
  assert.equal(await direct('dm-deleted', 'bob'), false);
});
