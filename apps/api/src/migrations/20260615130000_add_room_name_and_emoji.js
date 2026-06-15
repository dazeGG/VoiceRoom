'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('rooms', {
    name: { type: 'varchar(60)', notNull: true, default: '' },
    emoji: { type: 'varchar(16)', notNull: true, default: '' }
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('rooms', ['name', 'emoji']);
};
