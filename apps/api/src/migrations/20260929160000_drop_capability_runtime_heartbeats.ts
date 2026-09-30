// The release-2.5 capability readiness is gone (c192a01): nothing writes or
// reads runtime heartbeats any more. Down recreates the table exactly as
// 20260720163000 made it, so an API from before that can run again.

import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropTable('capability_runtime_heartbeats', { ifExists: true });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.createTable('capability_runtime_heartbeats', {
    runtime_kind: { type: 'varchar(16)', notNull: true },
    runtime_id: { type: 'varchar(160)', notNull: true },
    capability_tokens: { type: 'text[]', notNull: true, default: '{}' },
    manifest_digest: { type: 'varchar(64)' },
    manifest_schema_version: { type: 'integer' },
    contract_version: { type: 'varchar(96)' },
    public_capabilities: { type: 'text[]', notNull: true, default: '{}' },
    ready: { type: 'boolean', notNull: true, default: false },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.addConstraint('capability_runtime_heartbeats', 'capability_runtime_heartbeats_pkey', {
    primaryKey: ['runtime_kind', 'runtime_id']
  });
  pgm.addConstraint('capability_runtime_heartbeats', 'capability_runtime_heartbeats_kind_check', {
    check: "runtime_kind IN ('api','worker')"
  });
  pgm.createIndex('capability_runtime_heartbeats', ['runtime_kind', 'updated_at'], {
    name: 'capability_runtime_heartbeats_fresh_idx'
  });
}
