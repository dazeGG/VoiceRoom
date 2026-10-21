// Staff roles and the admin app's own sessions. A role sits on the account;
// the accounts named in PLATFORM_ADMIN_USER_IDS are superadmins whatever the
// column says. An admin-app session hangs off the main-site session it was
// handed over from: signing out there, or everywhere, ends it with the row.
// Giving and taking a role goes into admin_actions like any staff action.

import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.addColumns('users', { staff_role: { type: 'varchar(16)' } });
  pgm.addConstraint('users', 'users_staff_role_check', {
    check: "staff_role IS NULL OR staff_role IN ('moderator', 'admin', 'superadmin')"
  });
  pgm.createIndex('users', ['staff_role'], { name: 'users_staff_role_idx', where: 'staff_role IS NOT NULL' });

  pgm.createTable('staff_sessions', {
    /** SHA-256 of the cookie token; the token itself is never stored. */
    id: { type: 'varchar(64)', primaryKey: true },
    user_id: { type: 'varchar(36)', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    main_session_id: { type: 'varchar(64)', notNull: true, references: 'sessions(id)', onDelete: 'CASCADE' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    expires_at: { type: 'timestamptz', notNull: true }
  });
  pgm.createIndex('staff_sessions', ['expires_at'], { name: 'staff_sessions_expires_idx' });

  pgm.dropConstraint('admin_actions', 'admin_actions_action_check');
  pgm.addConstraint('admin_actions', 'admin_actions_action_check', {
    check: "action IN ('block', 'unblock', 'logout', 'delete', 'cancel_deletion', 'badge', 'staff_role')"
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.sql("DELETE FROM admin_actions WHERE action = 'staff_role'");
  pgm.dropConstraint('admin_actions', 'admin_actions_action_check');
  pgm.addConstraint('admin_actions', 'admin_actions_action_check', {
    check: "action IN ('block', 'unblock', 'logout', 'delete', 'cancel_deletion', 'badge')"
  });
  pgm.dropTable('staff_sessions');
  pgm.dropIndex('users', ['staff_role'], { name: 'users_staff_role_idx' });
  pgm.dropConstraint('users', 'users_staff_role_check');
  pgm.dropColumns('users', ['staff_role']);
}
