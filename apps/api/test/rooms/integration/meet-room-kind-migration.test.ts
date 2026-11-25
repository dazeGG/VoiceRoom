import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminRoomsRepository } from '../../../src/domains/admin/admin-rooms.repository.ts';
import { createRoomRepository } from '../../../src/domains/rooms/room.repository.ts';
import { runMigrations } from '../../../src/lib/migrate.ts';
import { kyselyOn } from '../../../src/platform/db/kysely.ts';
import { createTestDatabase } from '../../db-harness.ts';
import { rollBackThrough } from '../../migration-steps.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;
const MIGRATION = '20261120120000_add_meet_room_kind';

test(
  'Meet rooms survive the repository round trip while widget fencing and voice history stay intact',
  { skip },
  async (t) => {
    const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
    t.after(cleanup);
    await rollBackThrough(databaseUrl, MIGRATION);
    await pool.query(`
    INSERT INTO rooms (id) VALUES ('app');
    UPDATE widget_boundary_activation SET widget_boundary_required = true, widget_admission_enabled = true;
    INSERT INTO rooms (id, kind, widget_chat_enabled) VALUES ('site', 'widget', true);
    UPDATE widget_boundary_activation SET widget_admission_enabled = false;
    INSERT INTO users (id, login, display_name, password_hash) VALUES ('owner', 'owner', 'Owner', 'x');
  `);

    await runMigrations({ databaseUrl, logger: SILENT });
    const rooms = createRoomRepository({ db: kyselyOn(pool) });
    const created = await rooms.createRoomWithQuota({ roomId: 'meeting', kind: 'meet' });
    assert.equal(created.status, 'created');
    assert.deepEqual(await rooms.getRoom('meeting'), created.room);
    assert.equal(created.room?.kind, 'meet');
    assert.equal(created.room?.isStatic, false);
    assert.equal(created.room?.ownerId, null);
    assert.equal(created.room?.widgetChatEnabled, false);
    assert.equal((await rooms.getRoom('app'))?.kind, 'main');
    assert.equal((await rooms.getRoom('site'))?.kind, 'widget');
    assert.equal((await rooms.getRoom('site'))?.widgetChatEnabled, true);
    const adminRooms = await createAdminRoomsRepository({ pool }).rooms(['app', 'site', 'meeting']);
    assert.deepEqual(adminRooms.map(({ id, kind }) => [id, kind]).sort(), [
      ['app', 'main'],
      ['site', 'widget']
    ]);

    await assert.rejects(
      rooms.createRoom({ roomId: 'static', kind: 'meet', isStatic: true }),
      /rooms_meet_shape_check/
    );
    await assert.rejects(
      rooms.createRoom({ roomId: 'owned', kind: 'meet', ownerId: 'owner' }),
      /rooms_meet_shape_check/
    );
    await assert.rejects(
      rooms.createRoom({ roomId: 'chat', kind: 'meet', widgetChatEnabled: true }),
      /rooms_widget_shape_check/
    );
    await assert.rejects(rooms.createRoom({ roomId: 'fenced', kind: 'widget' }), /widget boundary is not activated/);
    await assert.rejects(pool.query(`UPDATE rooms SET kind = 'main' WHERE id = 'meeting'`), /immutable/);
    await assert.rejects(pool.query(`UPDATE rooms SET kind = 'meet' WHERE id = 'site'`), /immutable/);
    await assert.rejects(
      pool.query(
        `INSERT INTO voice_sessions (room_id, room_kind, joined_at, left_at) VALUES ('meeting', 'meet', now(), now())`
      ),
      /voice_sessions_room_kind_check/
    );

    await pool.query(`DELETE FROM rooms WHERE id = 'meeting'`);
    await rollBackThrough(databaseUrl, MIGRATION);
    await assert.rejects(rooms.createRoom({ roomId: 'rolled-back', kind: 'meet' }), /rooms_kind_check/);
    const remaining = await pool.query<{ id: string; kind: string; widget_chat_enabled: boolean }>(
      `SELECT id, kind, widget_chat_enabled FROM rooms ORDER BY id`
    );
    assert.deepEqual(remaining.rows, [
      { id: 'app', kind: 'main', widget_chat_enabled: false },
      { id: 'site', kind: 'widget', widget_chat_enabled: true }
    ]);
    await assert.rejects(
      rooms.createRoom({ roomId: 'still-fenced', kind: 'widget' }),
      /widget boundary is not activated/
    );
  }
);

test('rolling back cannot discard existing Meet rooms or change their surface', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  const rooms = createRoomRepository({ db: kyselyOn(pool) });
  const meeting = await rooms.createRoom({ roomId: 'meeting', kind: 'meet' });

  await assert.rejects(rollBackThrough(databaseUrl, MIGRATION), /rooms_kind_check/);
  assert.deepEqual(await rooms.getRoom(meeting.id), meeting);
  const next = await rooms.createRoom({ roomId: 'next-meeting', kind: 'meet' });
  assert.equal(next.kind, 'meet');
});
