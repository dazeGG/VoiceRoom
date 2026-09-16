'use strict';

exports.shorthands = undefined;

// Account deletion keeps the user row so messages others still hold keep a
// (now anonymous) author, and so do direct messages, which reference both
// sides. `deletion_requested_at` starts the grace period; `deleted_at` marks the
// finished, anonymized account. The original login is kept only as a hash in
// `reserved_logins`, so nobody can register it and pose as the old account.
exports.up = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.addColumns('users', {
    deletion_requested_at: { type: 'timestamptz' },
    deleted_at: { type: 'timestamptz' }
  });
  pgm.createIndex('users', ['deletion_requested_at'], {
    name: 'users_pending_deletion_idx',
    where: 'deletion_requested_at IS NOT NULL AND deleted_at IS NULL'
  });
  pgm.createTable('reserved_logins', {
    login_hash: { type: 'char(64)', primaryKey: true },
    reserved_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
};

exports.down = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropTable('reserved_logins');
  pgm.dropIndex('users', ['deletion_requested_at'], { name: 'users_pending_deletion_idx' });
  pgm.dropColumns('users', ['deletion_requested_at', 'deleted_at']);
};
