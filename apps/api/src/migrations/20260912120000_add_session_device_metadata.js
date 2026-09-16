'use strict';

exports.shorthands = undefined;

// Device metadata for the account's signed-in devices list. The primary key is
// the token hash and never leaves the server, so the client addresses a session
// by `public_id`. The client IP is not stored: only the city/country label
// resolved from it at sign-in and on the hourly session touch.
exports.up = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.addColumns('sessions', {
    public_id: { type: 'uuid', notNull: true, default: pgm.func('gen_random_uuid()') },
    user_agent: { type: 'text', notNull: true, default: '' },
    location_label: { type: 'text', notNull: true, default: '' }
  });
  pgm.createIndex('sessions', ['public_id'], {
    name: 'sessions_public_id_unique_idx',
    unique: true
  });
};

exports.down = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropIndex('sessions', ['public_id'], { name: 'sessions_public_id_unique_idx' });
  pgm.dropColumns('sessions', ['public_id', 'user_agent', 'location_label']);
};
