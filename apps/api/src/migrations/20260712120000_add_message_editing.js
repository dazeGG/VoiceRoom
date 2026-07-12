'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('room_messages', {
    edited_at: { type: 'timestamptz' }
  });
  pgm.addColumns('direct_messages', {
    edited_at: { type: 'timestamptz' }
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('direct_messages', ['edited_at']);
  pgm.dropColumns('room_messages', ['edited_at']);
};
