'use strict';

exports.shorthands = undefined;

// Directed global blocks: blocker_id refuses contact from blocked_id. The edge
// is directed because either side may lift only their own block, but every
// enforcement point (DM send, friend request, room invite) treats a block in
// *either* direction as a hard stop.
exports.up = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.createTable('user_blocks', {
    blocker_id: {
      type: 'varchar(36)',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE'
    },
    blocked_id: {
      type: 'varchar(36)',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE'
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });

  pgm.addConstraint('user_blocks', 'user_blocks_pk', {
    primaryKey: ['blocker_id', 'blocked_id']
  });
  pgm.addConstraint('user_blocks', 'user_blocks_no_self_check', {
    check: 'blocker_id <> blocked_id'
  });
  // Enforcement checks both directions, so the reverse lookup needs its own index.
  pgm.createIndex('user_blocks', ['blocked_id', 'blocker_id'], {
    name: 'user_blocks_reverse_idx'
  });
};

exports.down = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropTable('user_blocks');
};
