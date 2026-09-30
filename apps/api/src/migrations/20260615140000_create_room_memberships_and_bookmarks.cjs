'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('room_memberships', {
    id: { type: 'varchar(36)', primaryKey: true },
    room_id: {
      type: 'varchar(48)',
      notNull: true,
      references: 'rooms(id)',
      onDelete: 'CASCADE'
    },
    user_id: {
      type: 'varchar(36)',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE'
    },
    role: { type: 'varchar(16)', notNull: true, default: 'member' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") }
  });

  pgm.addConstraint('room_memberships', 'room_memberships_role_check', {
    check: "role IN ('owner', 'member')"
  });
  pgm.createIndex('room_memberships', ['room_id', 'user_id'], {
    name: 'room_memberships_room_user_unique_idx',
    unique: true
  });
  pgm.createIndex('room_memberships', ['user_id', 'role'], {
    name: 'room_memberships_user_role_idx'
  });
  pgm.createIndex('room_memberships', ['room_id', 'role'], {
    name: 'room_memberships_room_role_idx'
  });

  pgm.createTable('room_bookmarks', {
    id: { type: 'varchar(36)', primaryKey: true },
    room_id: {
      type: 'varchar(48)',
      notNull: true,
      references: 'rooms(id)',
      onDelete: 'CASCADE'
    },
    user_id: {
      type: 'varchar(36)',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE'
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") }
  });
  pgm.createIndex('room_bookmarks', ['user_id', 'room_id'], {
    name: 'room_bookmarks_user_room_unique_idx',
    unique: true
  });
  pgm.createIndex('room_bookmarks', ['room_id'], { name: 'room_bookmarks_room_idx' });

  pgm.sql(`
    INSERT INTO room_memberships (id, room_id, user_id, role, created_at, updated_at)
    SELECT md5(r.id || ':' || r.owner_id || ':owner'), r.id, r.owner_id, 'owner', r.created_at, r.updated_at
    FROM rooms r
    WHERE r.owner_id IS NOT NULL
      AND r.is_static = true
    ON CONFLICT (room_id, user_id) DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('room_bookmarks');
  pgm.dropTable('room_memberships');
};
