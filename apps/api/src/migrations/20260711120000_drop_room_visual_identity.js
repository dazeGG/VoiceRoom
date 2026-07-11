'use strict';

exports.shorthands = undefined;

const ROOM_ICON_CHECK = "room_icon_key IN ('headphones', 'pin', 'moon', 'sun', 'gamepad', 'mic', 'fire', 'coffee', 'music', 'book')";
const ROOM_COLOR_CHECK = "room_color_key IN ('blue', 'slate', 'violet', 'amber', 'indigo', 'rose', 'rust', 'green')";

exports.up = (pgm) => {
  pgm.dropConstraint('rooms', 'rooms_room_icon_key_check');
  pgm.dropConstraint('rooms', 'rooms_room_color_key_check');
  pgm.dropColumns('rooms', ['emoji', 'room_icon_key', 'room_color_key']);
};

exports.down = (pgm) => {
  pgm.addColumns('rooms', {
    emoji: { type: 'varchar(16)', notNull: true, default: '' },
    room_icon_key: { type: 'varchar(32)', notNull: true, default: 'headphones' },
    room_color_key: { type: 'varchar(32)', notNull: true, default: 'blue' }
  });
  pgm.addConstraint('rooms', 'rooms_room_icon_key_check', {
    check: ROOM_ICON_CHECK
  });
  pgm.addConstraint('rooms', 'rooms_room_color_key_check', {
    check: ROOM_COLOR_CHECK
  });
};
