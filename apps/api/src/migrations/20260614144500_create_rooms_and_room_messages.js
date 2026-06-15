'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('rooms', {
    id: { type: 'varchar(48)', primaryKey: true },
    creator_ip: { type: 'text', notNull: true, default: '' },
    is_static: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    empty_since: { type: 'timestamptz' },
    deleted_at: { type: 'timestamptz' },
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") }
  });

  pgm.createTable('room_messages', {
    id: { type: 'varchar(64)', primaryKey: true },
    room_id: {
      type: 'varchar(48)',
      notNull: true,
      references: 'rooms(id)',
      onDelete: 'CASCADE'
    },
    peer_id: { type: 'text', notNull: true, default: '' },
    name: { type: 'text', notNull: true, default: '' },
    text: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    expires_at: { type: 'timestamptz' },
    deleted_at: { type: 'timestamptz' },
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") }
  });

  pgm.createIndex('rooms', ['id'], {
    name: 'rooms_active_id_idx',
    where: 'deleted_at IS NULL'
  });
  pgm.createIndex('rooms', ['creator_ip', 'is_static'], {
    name: 'rooms_quota_idx',
    where: 'deleted_at IS NULL'
  });
  pgm.createIndex('rooms', ['empty_since'], {
    name: 'rooms_idle_prune_idx',
    where: 'deleted_at IS NULL AND empty_since IS NOT NULL'
  });
  pgm.createIndex('room_messages', ['room_id', 'created_at', 'id'], {
    name: 'room_messages_room_created_idx',
    where: 'deleted_at IS NULL'
  });
  pgm.createIndex('room_messages', ['expires_at'], {
    name: 'room_messages_expiry_idx',
    where: 'deleted_at IS NULL AND expires_at IS NOT NULL'
  });
};

exports.down = (pgm) => {
  pgm.dropTable('room_messages');
  pgm.dropTable('rooms');
};
