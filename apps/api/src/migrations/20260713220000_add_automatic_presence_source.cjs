'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('users', {
    presence_status_automatic: { type: 'boolean', notNull: true, default: false },
    presence_active_until: { type: 'timestamp with time zone' }
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('users', ['presence_status_automatic', 'presence_active_until']);
};
