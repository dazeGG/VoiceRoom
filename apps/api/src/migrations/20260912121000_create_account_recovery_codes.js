'use strict';

exports.shorthands = undefined;

// One-time account recovery codes. Only a SHA-256 of `<user id>:<code>` is kept:
// each code carries 80 random bits, so a slow password hash buys nothing, and
// binding the user id keeps a hash from matching the same code on another
// account. Generating a new set deletes the previous one.
exports.up = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.createTable('account_recovery_codes', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: {
      type: 'varchar(36)',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE'
    },
    code_hash: { type: 'char(64)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    used_at: { type: 'timestamptz' }
  });
  pgm.createIndex('account_recovery_codes', ['code_hash'], {
    name: 'account_recovery_codes_hash_unique_idx',
    unique: true
  });
  pgm.createIndex('account_recovery_codes', ['user_id'], {
    name: 'account_recovery_codes_user_idx'
  });
};

exports.down = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropTable('account_recovery_codes');
};
