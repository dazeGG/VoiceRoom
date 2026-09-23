'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('notification_preferences', {
    user_id: {
      type: 'varchar(36)',
      primaryKey: true,
      references: 'users(id)',
      onDelete: 'CASCADE'
    },
    private_notifications: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") }
  });

  pgm.createTable('notification_dm_mutes', {
    id: { type: 'varchar(36)', primaryKey: true },
    user_id: {
      type: 'varchar(36)',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE'
    },
    peer_user_id: {
      type: 'varchar(36)',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE'
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") }
  });

  pgm.addConstraint('notification_dm_mutes', 'notification_dm_mutes_no_self_check', {
    check: 'user_id <> peer_user_id'
  });
  pgm.createIndex('notification_dm_mutes', ['user_id', 'peer_user_id'], {
    name: 'notification_dm_mutes_user_peer_unique_idx',
    unique: true
  });
  pgm.createIndex('notification_dm_mutes', ['peer_user_id'], {
    name: 'notification_dm_mutes_peer_idx'
  });

  pgm.createTable('notification_room_mutes', {
    id: { type: 'varchar(36)', primaryKey: true },
    user_id: {
      type: 'varchar(36)',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE'
    },
    room_id: {
      type: 'varchar(48)',
      notNull: true,
      references: 'rooms(id)',
      onDelete: 'CASCADE'
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") }
  });

  pgm.createIndex('notification_room_mutes', ['user_id', 'room_id'], {
    name: 'notification_room_mutes_user_room_unique_idx',
    unique: true
  });
  pgm.createIndex('notification_room_mutes', ['room_id'], {
    name: 'notification_room_mutes_room_idx'
  });
};

exports.down = (pgm) => {
  pgm.dropTable('notification_room_mutes');
  pgm.dropTable('notification_dm_mutes');
  pgm.dropTable('notification_preferences');
};
