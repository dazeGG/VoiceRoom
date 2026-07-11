'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('users', {
    avatar_key: { type: 'text' },
    avatar_accent: { type: 'varchar(7)' }
  });
  pgm.addConstraint('users', 'users_avatar_accent_check', {
    check: "avatar_accent IS NULL OR avatar_accent ~ '^#[0-9A-Fa-f]{6}$'"
  });
  pgm.addColumns('rooms', {
    avatar_key: { type: 'text' }
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('rooms', ['avatar_key']);
  pgm.dropConstraint('users', 'users_avatar_accent_check');
  pgm.dropColumns('users', ['avatar_key', 'avatar_accent']);
};
