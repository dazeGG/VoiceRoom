'use strict';

exports.shorthands = undefined;

// Moderator-applied microphone mutes. Keyed by LiveKit gate principal rather
// than peer id so the mute survives a reconnect: an account keeps its identity
// across sessions, and a guest keeps its per-room principal. Only the room
// owner can create or lift a row — the muted participant cannot unmute itself.
exports.up = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.createTable('room_server_mutes', {
    room_id: {
      type: 'varchar(48)',
      notNull: true,
      references: 'rooms(id)',
      onDelete: 'CASCADE'
    },
    principal_type: { type: 'text', notNull: true },
    principal_id: { type: 'text', notNull: true },
    muted_by: {
      type: 'varchar(36)',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE'
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });

  pgm.addConstraint('room_server_mutes', 'room_server_mutes_pk', {
    primaryKey: ['room_id', 'principal_type', 'principal_id']
  });
  pgm.addConstraint('room_server_mutes', 'room_server_mutes_principal_type_chk', {
    check: "principal_type IN ('account', 'guest')"
  });
};

exports.down = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropTable('room_server_mutes');
};
