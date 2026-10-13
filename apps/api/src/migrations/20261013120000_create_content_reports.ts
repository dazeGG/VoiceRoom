// Reports to the service operator about a room or direct message. The report
// keeps only references: the reviewer reads the message itself, so a message
// its author already deleted shows as gone instead of living on in a copy. One
// account holds at most one open report per message; a resolution closes every
// open report of that message at once.

import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.createTable('content_reports', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    reporter_user_id: {
      type: 'varchar(36)',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE'
    },
    target_kind: { type: 'varchar(16)', notNull: true },
    room_id: { type: 'varchar(64)' },
    message_id: { type: 'varchar(64)', notNull: true },
    reason: { type: 'varchar(16)', notNull: true },
    comment: { type: 'text', notNull: true, default: '' },
    status: { type: 'varchar(16)', notNull: true, default: 'open' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    resolved_at: { type: 'timestamptz' },
    resolved_by_user_id: { type: 'varchar(36)' }
  });
  pgm.addConstraint('content_reports', 'content_reports_target_check', {
    check:
      "(target_kind = 'room_message' AND room_id IS NOT NULL) OR (target_kind = 'direct_message' AND room_id IS NULL)"
  });
  pgm.addConstraint('content_reports', 'content_reports_reason_check', {
    check: "reason IN ('spam', 'abuse', 'illegal', 'other')"
  });
  pgm.addConstraint('content_reports', 'content_reports_comment_check', {
    check: 'char_length(comment) <= 500'
  });
  pgm.addConstraint('content_reports', 'content_reports_status_check', {
    check:
      "(status = 'open' AND resolved_at IS NULL) OR (status IN ('actioned', 'dismissed') AND resolved_at IS NOT NULL)"
  });
  pgm.createIndex('content_reports', ['reporter_user_id', 'target_kind', 'message_id'], {
    name: 'content_reports_open_unique_idx',
    unique: true,
    where: "status = 'open'"
  });
  pgm.createIndex('content_reports', ['created_at'], {
    name: 'content_reports_open_created_idx',
    where: "status = 'open'"
  });
  pgm.createIndex('content_reports', ['target_kind', 'message_id'], {
    name: 'content_reports_target_idx'
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropTable('content_reports');
}
