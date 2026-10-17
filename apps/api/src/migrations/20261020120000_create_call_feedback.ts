// Answers to "how was the call?": a thumbs up or down, the tags picked, an
// optional comment, and the call's own numbers as the client measured them.
// A guest's answer has no account; a deleted account's answers lose it. The
// room is a plain id because temporary rooms are pruned while the answers stay
// useful.

import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.createTable('call_feedback', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'varchar(36)', references: 'users(id)', onDelete: 'SET NULL' },
    rating: { type: 'varchar(8)', notNull: true },
    tags: { type: 'text[]', notNull: true, default: pgm.func("'{}'::text[]") },
    comment: { type: 'text', notNull: true, default: '' },
    room_id: { type: 'varchar(64)', notNull: true },
    duration_s: { type: 'integer', notNull: true },
    peers: { type: 'integer', notNull: true },
    platform: { type: 'varchar(16)', notNull: true },
    quality: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.addConstraint('call_feedback', 'call_feedback_rating_check', { check: "rating IN ('good', 'bad')" });
  pgm.addConstraint('call_feedback', 'call_feedback_comment_check', { check: 'char_length(comment) <= 1000' });
  pgm.addConstraint('call_feedback', 'call_feedback_call_check', { check: 'duration_s >= 0 AND peers >= 0' });
  pgm.addConstraint('call_feedback', 'call_feedback_platform_check', {
    check: "platform IN ('browser', 'desktop_app', 'mobile')"
  });
  pgm.createIndex('call_feedback', ['created_at'], { name: 'call_feedback_created_idx' });
  pgm.createIndex('call_feedback', ['user_id'], { name: 'call_feedback_user_idx', where: 'user_id IS NOT NULL' });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropTable('call_feedback');
}
