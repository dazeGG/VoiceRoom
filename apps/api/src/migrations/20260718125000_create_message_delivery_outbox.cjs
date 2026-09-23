'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");

  pgm.createTable('message_delivery_outbox', {
    event_id: { type: 'varchar(160)', primaryKey: true },
    logical_key: { type: 'char(64)', notNull: true, unique: true },
    event_type: { type: 'varchar(32)', notNull: true },
    conversation_type: { type: 'varchar(16)', notNull: true },
    conversation_id: { type: 'varchar(160)', notNull: true },
    message_id: { type: 'varchar(160)', notNull: true },
    revision: { type: 'bigint', notNull: true, default: 1 },
    payload: { type: 'jsonb', notNull: true },
    status: { type: 'varchar(16)', notNull: true, default: 'pending' },
    attempts: { type: 'integer', notNull: true, default: 0 },
    available_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    claimed_at: { type: 'timestamptz' },
    claimed_fencing_token: { type: 'bigint' },
    delivered_at: { type: 'timestamptz' },
    dead_at: { type: 'timestamptz' },
    last_error: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });

  pgm.addConstraint('message_delivery_outbox', 'message_delivery_outbox_event_type_check', {
    check: "event_type IN ('message.created', 'message.updated', 'message.deleted')"
  });
  pgm.addConstraint('message_delivery_outbox', 'message_delivery_outbox_conversation_type_check', {
    check: "conversation_type IN ('room', 'dm')"
  });
  pgm.addConstraint('message_delivery_outbox', 'message_delivery_outbox_status_check', {
    check: "status IN ('pending', 'processing', 'delivered', 'dead')"
  });
  pgm.addConstraint('message_delivery_outbox', 'message_delivery_outbox_revision_check', {
    check: 'revision >= 1'
  });
  pgm.addConstraint('message_delivery_outbox', 'message_delivery_outbox_attempts_check', {
    check: 'attempts >= 0'
  });

  pgm.createIndex('message_delivery_outbox', ['available_at', 'created_at', 'event_id'], {
    name: 'message_delivery_outbox_pending_idx',
    where: "status = 'pending'"
  });
  pgm.createIndex('message_delivery_outbox', ['claimed_at'], {
    name: 'message_delivery_outbox_processing_idx',
    where: "status = 'processing'"
  });
  pgm.createIndex('message_delivery_outbox', ['dead_at'], {
    name: 'message_delivery_outbox_dead_idx',
    where: "status = 'dead'"
  });

  pgm.createTable('message_delivery_leases', {
    identity: { type: 'varchar(96)', primaryKey: true },
    owner_id: { type: 'varchar(96)' },
    fencing_token: { type: 'bigint', notNull: true, default: 0 },
    expires_at: { type: 'timestamptz', notNull: true, default: pgm.func("'-infinity'::timestamptz") },
    heartbeat_at: { type: 'timestamptz' },
    ready: { type: 'boolean', notNull: true, default: false },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
};

exports.down = (pgm) => {
  pgm.dropTable('message_delivery_leases');
  pgm.dropTable('message_delivery_outbox');
};
