'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('room_chat_reads', {
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
    last_read_at: { type: 'timestamptz', notNull: true }
  });

  pgm.createIndex('room_chat_reads', ['room_id', 'user_id'], {
    name: 'room_chat_reads_room_user_unique_idx',
    unique: true
  });
  pgm.createIndex('room_chat_reads', ['user_id'], {
    name: 'room_chat_reads_user_idx'
  });
};

exports.down = (pgm) => {
  pgm.dropTable('room_chat_reads');
};
