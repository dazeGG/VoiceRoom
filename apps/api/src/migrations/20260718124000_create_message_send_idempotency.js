'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");

  pgm.createTable('message_send_idempotency', {
    ledger_key: { type: 'char(64)', primaryKey: true },
    actor_type: { type: 'varchar(16)', notNull: true },
    actor_id: { type: 'varchar(160)', notNull: true },
    conversation_type: { type: 'varchar(16)', notNull: true },
    conversation_id: { type: 'varchar(160)', notNull: true },
    idempotency_key: { type: 'varchar(160)', notNull: true },
    fingerprint: { type: 'varchar(256)', notNull: true },
    state: { type: 'varchar(16)', notNull: true, default: 'pending' },
    message_id: { type: 'varchar(160)' },
    response_status: { type: 'integer' },
    response_body: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    completed_at: { type: 'timestamptz' },
    expires_at: { type: 'timestamptz', notNull: true }
  });

  pgm.addConstraint('message_send_idempotency', 'message_send_idempotency_actor_type_check', {
    check: "actor_type IN ('account', 'guest')"
  });
  pgm.addConstraint('message_send_idempotency', 'message_send_idempotency_conversation_type_check', {
    check: "conversation_type IN ('room', 'dm')"
  });
  pgm.addConstraint('message_send_idempotency', 'message_send_idempotency_state_check', {
    check: "state IN ('pending', 'completed')"
  });
  pgm.addConstraint('message_send_idempotency', 'message_send_idempotency_response_check', {
    check: "(state = 'pending' AND response_status IS NULL AND response_body IS NULL AND completed_at IS NULL) OR (state = 'completed' AND response_status BETWEEN 100 AND 599 AND response_body IS NOT NULL AND completed_at IS NOT NULL)"
  });

  pgm.createIndex('message_send_idempotency', ['actor_type', 'actor_id', 'expires_at'], {
    name: 'message_send_idempotency_actor_expiry_idx'
  });
  pgm.createIndex('message_send_idempotency', ['expires_at'], {
    name: 'message_send_idempotency_expiry_idx'
  });
};

exports.down = (pgm) => {
  pgm.dropTable('message_send_idempotency');
};
