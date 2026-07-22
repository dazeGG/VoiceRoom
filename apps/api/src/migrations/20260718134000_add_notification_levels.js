'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.addColumn('notification_room_mutes', { level: { type: 'varchar(16)', notNull: true, default: 'none' } }, { ifNotExists: true });
  pgm.addConstraint('notification_room_mutes', 'notification_room_mutes_level_check', { check: "level IN ('all','mentions','none')" });
  pgm.sql("UPDATE notification_room_mutes SET level = 'none' WHERE level IS NULL");
};

exports.down = (pgm) => pgm.dropColumn('notification_room_mutes', 'level', { ifExists: true });
