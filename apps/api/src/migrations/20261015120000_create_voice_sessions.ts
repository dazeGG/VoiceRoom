// One row per stay in a room's voice: who (an account, or NULL for a guest),
// where, and from when to when. The row is written once, when the stay ends,
// so the table never holds an open session. The room is a plain id because
// temporary rooms are pruned while their history stays useful.

import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.createTable('voice_sessions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    room_id: { type: 'varchar(64)', notNull: true },
    user_id: { type: 'varchar(36)', references: 'users(id)', onDelete: 'CASCADE' },
    joined_at: { type: 'timestamptz', notNull: true },
    left_at: { type: 'timestamptz', notNull: true }
  });
  pgm.addConstraint('voice_sessions', 'voice_sessions_order_check', { check: 'left_at >= joined_at' });
  pgm.createIndex('voice_sessions', ['joined_at'], { name: 'voice_sessions_joined_idx' });
  pgm.createIndex('voice_sessions', ['room_id', 'joined_at'], { name: 'voice_sessions_room_idx' });
  pgm.createIndex('voice_sessions', ['user_id', 'joined_at'], {
    name: 'voice_sessions_user_idx',
    where: 'user_id IS NOT NULL'
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropTable('voice_sessions');
}
