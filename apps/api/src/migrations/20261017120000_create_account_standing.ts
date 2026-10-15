// What the platform administrator decides about an account: a block over the
// whole service (until a moment, or for good when blocked_until is null; it
// lifts itself once that moment passes), the mark next to its name, and the
// log of every such decision with the administrator and the reason.

import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.addColumns('users', {
    blocked_at: { type: 'timestamptz' },
    blocked_until: { type: 'timestamptz' },
    block_reason: { type: 'text', notNull: true, default: '' },
    badge: { type: 'varchar(16)' }
  });
  pgm.addConstraint('users', 'users_block_check', {
    check: '(blocked_at IS NOT NULL) OR (blocked_until IS NULL)'
  });
  pgm.addConstraint('users', 'users_badge_check', { check: "badge IN ('official', 'verified')" });
  pgm.createIndex('users', ['badge'], { name: 'users_badge_idx', where: 'badge IS NOT NULL' });

  pgm.createTable('admin_actions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    admin_user_id: { type: 'varchar(36)', notNull: true },
    target_user_id: { type: 'varchar(36)', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    action: { type: 'varchar(24)', notNull: true },
    reason: { type: 'text', notNull: true, default: '' },
    details: { type: 'jsonb', notNull: true, default: '{}' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.addConstraint('admin_actions', 'admin_actions_action_check', {
    check: "action IN ('block', 'unblock', 'logout', 'delete', 'cancel_deletion', 'badge')"
  });
  pgm.addConstraint('admin_actions', 'admin_actions_reason_check', { check: 'char_length(reason) <= 300' });
  pgm.createIndex('admin_actions', ['target_user_id', 'created_at'], { name: 'admin_actions_target_idx' });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropTable('admin_actions');
  pgm.dropIndex('users', ['badge'], { name: 'users_badge_idx' });
  pgm.dropConstraint('users', 'users_badge_check');
  pgm.dropConstraint('users', 'users_block_check');
  pgm.dropColumns('users', ['blocked_at', 'blocked_until', 'block_reason', 'badge']);
}
