// Separate storage keeps legacy message-report targets and uniqueness unchanged.
import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.createTable('user_reports', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    reporter_user_id: { type: 'varchar(36)', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    // Keep the reference after target deletion so staff can still close the report; no profile snapshot.
    target_user_id: { type: 'varchar(36)', notNull: true },
    reason: { type: 'varchar(16)', notNull: true },
    comment: { type: 'text', notNull: true, default: '' },
    status: { type: 'varchar(16)', notNull: true, default: 'open' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    resolved_at: { type: 'timestamptz' },
    resolved_by_user_id: { type: 'varchar(36)' }
  });
  pgm.addConstraint('user_reports', 'user_reports_not_self_check', { check: 'reporter_user_id <> target_user_id' });
  pgm.addConstraint('user_reports', 'user_reports_reason_check', { check: "reason IN ('spam', 'abuse', 'illegal', 'other')" });
  pgm.addConstraint('user_reports', 'user_reports_comment_check', { check: 'char_length(comment) <= 500' });
  pgm.addConstraint('user_reports', 'user_reports_status_check', {
    check: "(status = 'open' AND resolved_at IS NULL) OR (status IN ('actioned', 'dismissed') AND resolved_at IS NOT NULL)"
  });
  pgm.createIndex('user_reports', ['reporter_user_id', 'target_user_id'], {
    name: 'user_reports_open_unique_idx', unique: true, where: "status = 'open'"
  });
  pgm.createIndex('user_reports', ['created_at'], { name: 'user_reports_open_created_idx', where: "status = 'open'" });
  pgm.createIndex('user_reports', ['target_user_id'], { name: 'user_reports_target_idx' });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropTable('user_reports');
}
