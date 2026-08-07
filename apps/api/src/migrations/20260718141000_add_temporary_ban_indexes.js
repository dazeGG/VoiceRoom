'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('room_bans', {
    reason: { type: 'varchar(500)', notNull: true, default: '' },
    idempotency_key: { type: 'varchar(128)' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    revoked_at: { type: 'timestamptz' }
  });
  pgm.createIndex('room_bans', ['room_id', 'created_at', 'id'], {
    name: 'room_bans_active_page_idx',
    where: 'revoked_at IS NULL'
  });
  pgm.createIndex('room_bans', ['room_id', 'idempotency_key'], {
    name: 'room_bans_idempotency_idx',
    unique: true,
    where: 'idempotency_key IS NOT NULL'
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('room_bans', [], { name: 'room_bans_idempotency_idx' });
  pgm.dropIndex('room_bans', [], { name: 'room_bans_active_page_idx' });
  pgm.dropColumns('room_bans', ['revoked_at', 'updated_at', 'idempotency_key', 'reason']);
};
