'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('users', {
    id: { type: 'varchar(36)', primaryKey: true },
    login: { type: 'varchar(32)', notNull: true },
    display_name: { type: 'text', notNull: true, default: '' },
    password_hash: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") }
  });

  // Logins are stored already lower-cased, so a plain unique index enforces
  // case-insensitive uniqueness without the citext extension.
  pgm.createIndex('users', ['login'], { name: 'users_login_unique_idx', unique: true });

  pgm.createTable('sessions', {
    id: { type: 'varchar(64)', primaryKey: true },
    user_id: {
      type: 'varchar(36)',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE'
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    last_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    expires_at: { type: 'timestamptz', notNull: true }
  });

  pgm.createIndex('sessions', ['user_id'], { name: 'sessions_user_idx' });
  pgm.createIndex('sessions', ['expires_at'], { name: 'sessions_expiry_idx' });

  pgm.addColumns('rooms', {
    owner_id: {
      type: 'varchar(36)',
      references: 'users(id)',
      onDelete: 'SET NULL'
    }
  });

  pgm.createIndex('rooms', ['owner_id'], {
    name: 'rooms_owner_idx',
    where: 'deleted_at IS NULL AND owner_id IS NOT NULL'
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('rooms', ['owner_id'], { name: 'rooms_owner_idx' });
  pgm.dropColumns('rooms', ['owner_id']);
  pgm.dropTable('sessions');
  pgm.dropTable('users');
};
