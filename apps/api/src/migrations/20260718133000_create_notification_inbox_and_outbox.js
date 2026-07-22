'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.createTable('user_notifications', {
    id: { type: 'varchar(36)', primaryKey: true },
    recipient_user_id: { type: 'varchar(36)', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    actor_user_id: { type: 'varchar(36)', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    room_id: { type: 'varchar(48)', notNull: true, references: 'rooms(id)', onDelete: 'CASCADE' },
    source_message_id: { type: 'varchar(64)', notNull: true, references: 'room_messages(id)', onDelete: 'CASCADE' },
    reasons: { type: 'text[]', notNull: true },
    body: { type: 'text', notNull: true, default: '' },
    revision: { type: 'bigint', notNull: true, default: 1 },
    read_at: { type: 'timestamptz' },
    retracted_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.addConstraint('user_notifications', 'user_notifications_reasons_check', { check: "cardinality(reasons) > 0 AND reasons <@ ARRAY['mention','reply']::text[]" });
  pgm.addConstraint('user_notifications', 'user_notifications_revision_check', { check: 'revision >= 1' });
  pgm.createIndex('user_notifications', ['recipient_user_id', 'source_message_id'], { name: 'user_notifications_recipient_source_unique_idx', unique: true });
  pgm.createIndex('user_notifications', ['recipient_user_id', 'created_at', 'id'], { name: 'user_notifications_recipient_cursor_idx' });
  pgm.createIndex('user_notifications', ['recipient_user_id', 'created_at', 'id'], { name: 'user_notifications_unread_cursor_idx', where: 'read_at IS NULL AND retracted_at IS NULL' });

  pgm.createTable('notification_outbox', {
    event_id: { type: 'varchar(160)', primaryKey: true },
    notification_id: { type: 'varchar(36)', notNull: true, references: 'user_notifications(id)', onDelete: 'CASCADE' },
    recipient_user_id: { type: 'varchar(36)', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    revision: { type: 'bigint', notNull: true },
    channel: { type: 'varchar(16)', notNull: true, default: 'web_push' },
    payload: { type: 'jsonb', notNull: true },
    status: { type: 'varchar(16)', notNull: true, default: 'pending' },
    attempts: { type: 'integer', notNull: true, default: 0 },
    available_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    claimed_at: { type: 'timestamptz' },
    claimed_fencing_token: { type: 'bigint' },
    delivered_at: { type: 'timestamptz' },
    suppressed_at: { type: 'timestamptz' },
    dead_at: { type: 'timestamptz' },
    last_error: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.addConstraint('notification_outbox', 'notification_outbox_revision_check', { check: 'revision >= 1' });
  pgm.addConstraint('notification_outbox', 'notification_outbox_channel_check', { check: "channel IN ('web_push')" });
  pgm.addConstraint('notification_outbox', 'notification_outbox_status_check', { check: "status IN ('pending','processing','delivered','suppressed','dead')" });
  pgm.addConstraint('notification_outbox', 'notification_outbox_attempts_check', { check: 'attempts >= 0' });
  pgm.createIndex('notification_outbox', ['notification_id', 'revision', 'channel'], { name: 'notification_outbox_notification_revision_channel_unique_idx', unique: true });
  pgm.createIndex('notification_outbox', ['available_at', 'created_at', 'event_id'], { name: 'notification_outbox_pending_idx', where: "status = 'pending'" });
  pgm.createIndex('notification_outbox', ['claimed_at'], { name: 'notification_outbox_processing_idx', where: "status = 'processing'" });

  pgm.createTable('notification_delivery_leases', {
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
  pgm.dropTable('notification_delivery_leases');
  pgm.dropTable('notification_outbox');
  pgm.dropTable('user_notifications');
};
