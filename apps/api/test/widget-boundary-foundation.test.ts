import test from 'node:test';
import assert from 'node:assert/strict';
import { roomAllowsSurface, roomAllowsChat, roomAllowsAttachments } from '../src/domains/rooms/room-surface.policy.ts';
import { createTestDatabase } from './db-harness.ts';
import { mapRoom, type RoomRow } from '../src/domains/rooms/room.repository.ts';

test('trusted room surface defaults legacy objects to main and denies cross-surface capabilities', () => {
  const main = {};
  const off = { kind: 'widget' as const, widgetChatEnabled: false };
  const on = { kind: 'widget' as const, widgetChatEnabled: true };
  for (const missing of [null, undefined]) {
    assert.equal(roomAllowsSurface(missing, 'main'), false);
    assert.equal(roomAllowsChat(missing, 'widget'), false);
  }
  assert.equal(roomAllowsSurface(main, 'main'), true);
  assert.equal(roomAllowsSurface(main, 'widget'), false);
  assert.equal(roomAllowsChat(main, 'main'), true);
  for (const widget of [off, on]) {
    assert.equal(roomAllowsSurface(widget, 'main'), false);
    assert.equal(roomAllowsSurface(widget, 'widget'), true);
    assert.equal(roomAllowsChat(widget, 'main'), false);
    assert.equal(roomAllowsChat(widget, 'widget'), false);
    assert.equal(roomAllowsAttachments(widget, 'widget'), false);
    assert.equal(roomAllowsAttachments(widget, 'main'), false);
  }
});

test(
  'PostgreSQL enforces room shape, immutable capabilities and persistent activation floor',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { pool, cleanup } = await createTestDatabase(t);
    t.after(cleanup);
    const legacy = await pool.query<RoomRow>("INSERT INTO rooms(id) VALUES ('legacy') RETURNING *");
    assert.ok(legacy.rows[0]);
    assert.equal(legacy.rows[0].kind, 'main');
    assert.equal(legacy.rows[0].widget_chat_enabled, false);
    const mapped = mapRoom(legacy.rows[0]);
    assert.equal(mapped.kind, 'main');
    assert.equal(mapped.widgetChatEnabled, false);
    await assert.rejects(pool.query("INSERT INTO rooms(id,kind) VALUES ('before','widget')"), /not activated/);
    await pool.query(
      'UPDATE widget_boundary_activation SET widget_boundary_required=true,widget_admission_enabled=true WHERE singleton'
    );
    await assert.rejects(
      pool.query("INSERT INTO rooms(id,kind,is_static) VALUES ('static','widget',true)"),
      /rooms_widget_shape_check/
    );
    await assert.rejects(
      pool.query("INSERT INTO rooms(id,widget_chat_enabled) VALUES ('mainchat',true)"),
      /rooms_widget_shape_check/
    );
    await pool.query("INSERT INTO rooms(id,kind,widget_chat_enabled) VALUES ('widget','widget',true)");
    await assert.rejects(
      pool.query("UPDATE rooms SET kind='main',widget_chat_enabled=false WHERE id='widget'"),
      /immutable/
    );
    await assert.rejects(pool.query("UPDATE rooms SET widget_chat_enabled=false WHERE id='widget'"), /immutable/);
    await assert.rejects(pool.query("UPDATE rooms SET kind='widget' WHERE id='legacy'"), /immutable/);
    await pool.query("UPDATE rooms SET empty_since=NULL WHERE id='widget'");
    await pool.query("DELETE FROM rooms WHERE id='widget'");
    await assert.rejects(
      pool.query('UPDATE widget_boundary_activation SET widget_boundary_required=false'),
      /cannot be cleared/
    );
    await assert.rejects(pool.query('DELETE FROM widget_boundary_activation'), /cannot be cleared/);
  }
);
