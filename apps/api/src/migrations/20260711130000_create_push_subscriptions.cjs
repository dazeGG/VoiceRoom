'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('push_subscriptions', {
    id: { type: 'varchar(36)', primaryKey: true },
    user_id: {
      type: 'varchar(36)',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE'
    },
    endpoint: { type: 'text', notNull: true, unique: true },
    p256dh: { type: 'text', notNull: true },
    auth: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    last_success_at: { type: 'timestamptz' },
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") }
  });

  pgm.createIndex('push_subscriptions', ['user_id'], {
    name: 'push_subscriptions_user_idx'
  });
  pgm.createIndex('push_subscriptions', ['user_id', 'created_at', 'id'], {
    name: 'push_subscriptions_user_created_idx'
  });
};

exports.down = (pgm) => {
  pgm.dropTable('push_subscriptions');
};
