'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createIndex('room_bans', ['room_id', 'user_id', 'expires_at', 'created_at'], {
    name: 'room_bans_active_room_user_idx'
  });
  pgm.createIndex('room_bans', ['room_id', 'ip', 'expires_at', 'created_at'], {
    name: 'room_bans_active_room_ip_idx',
    where: 'user_id IS NULL'
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('room_bans', ['room_id', 'ip', 'expires_at', 'created_at'], {
    name: 'room_bans_active_room_ip_idx'
  });
  pgm.dropIndex('room_bans', ['room_id', 'user_id', 'expires_at', 'created_at'], {
    name: 'room_bans_active_room_user_idx'
  });
};
