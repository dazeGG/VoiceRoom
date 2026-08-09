'use strict';

exports.shorthands = undefined;

// Pinned room messages. Any room participant may pin, so the row records who
// did it for the "закреплено N" affordance and for later moderation review.
// The pair (room_id, message_id) is the primary key: pinning is idempotent and
// a message can only be pinned once per room.
exports.up = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.createTable('room_message_pins', {
    room_id: {
      type: 'varchar(48)',
      notNull: true,
      references: 'rooms(id)',
      onDelete: 'CASCADE'
    },
    message_id: {
      type: 'varchar(64)',
      notNull: true,
      references: 'room_messages(id)',
      onDelete: 'CASCADE'
    },
    pinned_by: {
      type: 'varchar(36)',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE'
    },
    pinned_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });

  pgm.addConstraint('room_message_pins', 'room_message_pins_pk', {
    primaryKey: ['room_id', 'message_id']
  });

  // Newest-first listing for the pinned bar, and the count query behind it.
  pgm.createIndex('room_message_pins', [
    'room_id',
    { name: 'pinned_at', sort: 'DESC' },
    { name: 'message_id', sort: 'DESC' }
  ], {
    name: 'room_message_pins_room_recent_idx'
  });
};

exports.down = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropTable('room_message_pins');
};
