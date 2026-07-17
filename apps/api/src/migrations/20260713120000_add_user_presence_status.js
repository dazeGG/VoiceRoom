'use strict';

exports.shorthands = undefined;

const CONSTRAINT = 'users_presence_status_check';

exports.up = (pgm) => {
  pgm.addColumns('users', {
    presence_status: { type: 'text', notNull: true, default: 'online' }
  });
  pgm.sql(`UPDATE users SET presence_status = 'dnd' WHERE dnd = true`);
  pgm.addConstraint('users', CONSTRAINT, {
    check: "presence_status IN ('online', 'away', 'dnd', 'offline')"
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint('users', CONSTRAINT);
  pgm.dropColumns('users', ['presence_status']);
};
