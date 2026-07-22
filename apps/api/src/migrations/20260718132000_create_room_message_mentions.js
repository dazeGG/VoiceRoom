'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.createTable('room_message_mentions', {
    id: { type: 'varchar(36)', primaryKey: true },
    room_id: { type: 'varchar(48)', notNull: true, references: 'rooms(id)', onDelete: 'CASCADE' },
    message_id: { type: 'varchar(64)', notNull: true, references: 'room_messages(id)', onDelete: 'CASCADE' },
    creator_user_id: { type: 'varchar(36)', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    target_user_id: { type: 'varchar(36)', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    retracted_at: { type: 'timestamptz' },
    revision: { type: 'bigint', notNull: true, default: 1 }
  });
  pgm.addConstraint('room_message_mentions', 'room_message_mentions_no_self_check', { check: 'creator_user_id <> target_user_id' });
  pgm.addConstraint('room_message_mentions', 'room_message_mentions_revision_check', { check: 'revision >= 1' });
  pgm.createIndex('room_message_mentions', ['message_id', 'target_user_id'], { name: 'room_message_mentions_message_target_unique_idx', unique: true });
  pgm.createIndex('room_message_mentions', ['target_user_id', 'created_at', 'id'], { name: 'room_message_mentions_target_active_idx', where: 'retracted_at IS NULL' });
  pgm.createIndex('room_message_mentions', ['room_id', 'message_id'], { name: 'room_message_mentions_room_message_idx' });
};

exports.down = (pgm) => pgm.dropTable('room_message_mentions');
