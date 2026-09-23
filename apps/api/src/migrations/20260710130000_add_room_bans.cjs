'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('room_bans', {
    id: { type: 'varchar(36)', primaryKey: true },
    room_id: {
      type: 'varchar(48)',
      notNull: true,
      references: 'rooms(id)',
      onDelete: 'CASCADE'
    },
    user_id: {
      type: 'varchar(36)',
      references: 'users(id)',
      onDelete: 'CASCADE'
    },
    ip: { type: 'text', notNull: true, default: '' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    expires_at: { type: 'timestamptz' },
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") }
  });

  pgm.createIndex('room_bans', ['room_id', 'user_id'], { name: 'room_bans_room_user_idx' });
  pgm.createIndex('room_bans', ['room_id', 'ip'], { name: 'room_bans_room_ip_idx' });
};

exports.down = (pgm) => {
  pgm.dropTable('room_bans');
};
