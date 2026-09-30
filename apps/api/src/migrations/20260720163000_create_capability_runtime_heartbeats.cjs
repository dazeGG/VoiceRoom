'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
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
};

exports.down = (pgm) => {
  pgm.sql("SET LOCAL lock_timeout = '5s'");
  pgm.dropTable('capability_runtime_heartbeats');
};
