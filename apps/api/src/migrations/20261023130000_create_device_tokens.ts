// Push tokens of the VoiceRoom Android app. A token belongs to the session it
// was registered under: ending that session (sign-out, revoke, password
// change, block, account deletion, expiry prune) deletes it in the same
// statement. A token is unique per provider; registering it again moves it to
// the caller's account and session. 1024 characters leaves room for the rest
// of a 4096-byte push.

import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.createTable('device_tokens', {
    id: { type: 'varchar(36)', primaryKey: true },
    user_id: { type: 'varchar(36)', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    session_id: { type: 'varchar(64)', notNull: true, references: 'sessions(id)', onDelete: 'CASCADE' },
    provider: { type: 'varchar(16)', notNull: true },
    token: { type: 'varchar(1024)', notNull: true },
    /** The app's `x.y.z` from its user agent when it registered; null when it sent none. */
    app_version: { type: 'varchar(16)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    last_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.addConstraint('device_tokens', 'device_tokens_provider_check', { check: "provider IN ('rustore')" });
  pgm.addConstraint('device_tokens', 'device_tokens_token_check', { check: 'char_length(token) >= 1' });
  pgm.addConstraint('device_tokens', 'device_tokens_provider_token_key', { unique: ['provider', 'token'] });
  pgm.createIndex('device_tokens', ['user_id', 'last_seen_at'], { name: 'device_tokens_user_idx' });
  pgm.createIndex('device_tokens', ['session_id'], { name: 'device_tokens_session_idx' });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropTable('device_tokens');
}
