'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('users', {
    dnd: { type: 'boolean', notNull: true, default: false }
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('users', ['dnd']);
};
