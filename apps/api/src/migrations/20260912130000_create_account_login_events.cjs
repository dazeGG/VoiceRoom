'use strict';

exports.shorthands = undefined;

// Sign-ins of an account, kept for 90 days. They decide whether a new sign-in
// comes from a familiar device and city, and the ones flagged as `alert` are
// the "was this you?" questions shown on the account's other devices until
// someone answers them.
exports.up = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.createTable('account_login_events', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: {
      type: 'varchar(36)',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE'
    },
    session_public_id: { type: 'uuid' },
    kind: { type: 'varchar(16)', notNull: true },
    client: { type: 'text', notNull: true, default: '' },
    os: { type: 'text', notNull: true, default: '' },
    location_label: { type: 'text', notNull: true, default: '' },
    alert: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    resolved_at: { type: 'timestamptz' },
    resolution: { type: 'varchar(16)' }
  });
  pgm.addConstraint('account_login_events', 'account_login_events_kind_check', {
    check: "kind IN ('register', 'login', 'recovery')"
  });
  pgm.addConstraint('account_login_events', 'account_login_events_resolution_check', {
    check: "(resolution IS NULL AND resolved_at IS NULL) OR (resolution IN ('confirmed', 'denied') AND resolved_at IS NOT NULL)"
  });
  pgm.createIndex('account_login_events', ['user_id', 'created_at'], {
    name: 'account_login_events_user_created_idx'
  });
  pgm.createIndex('account_login_events', ['user_id', 'created_at'], {
    name: 'account_login_events_pending_idx',
    where: 'alert AND resolved_at IS NULL'
  });
  pgm.createIndex('account_login_events', ['session_public_id'], {
    name: 'account_login_events_session_idx',
    where: 'session_public_id IS NOT NULL'
  });
};

exports.down = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropTable('account_login_events');
};
