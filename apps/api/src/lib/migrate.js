'use strict';

const { Client } = require('pg');
const path = require('node:path');
const { PG_MIGRATE_LOCK_ID, runner } = require('node-pg-migrate');
const { readDatabaseConfig } = require('./config');

const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');
const DEFAULT_MIGRATIONS_TABLE = 'pgmigrations';
const MIGRATION_GUARD_TABLE = 'voiceroom_migration_guard';
const MIGRATION_GUARD_ID = 1;
const MIGRATION_GUARD_STATES = {
  clean: 'clean',
  running: 'running',
  dirty: 'dirty'
};
const LOCK_TIMEOUT_MS = 5000;

function migrationLogger(logger) {
  return {
    info: (...items) => logger?.info?.(...items),
    warn: (...items) => logger?.warn?.(...items),
    error: (...items) => logger?.error?.(...items),
    log: (...items) => logger?.log?.(...items)
  };
}

async function query(client, text, values = []) {
  const { rows } = await client.query(text, values);
  return rows;
}

async function ensureMigrationGuardSchema(client) {
  await query(client, `
    CREATE TABLE IF NOT EXISTS ${MIGRATION_GUARD_TABLE} (
      id integer PRIMARY KEY,
      state text NOT NULL,
      marker text,
      updated_at timestamptz NOT NULL DEFAULT NOW()
    )
  `);

  const rows = await query(client, `SELECT state FROM ${MIGRATION_GUARD_TABLE} WHERE id = $1`, [MIGRATION_GUARD_ID]);
  if (rows.length === 0) {
    await query(
      client,
      `INSERT INTO ${MIGRATION_GUARD_TABLE} (id, state, marker) VALUES ($1, $2, $3)`,
      [MIGRATION_GUARD_ID, MIGRATION_GUARD_STATES.clean, null]
    );
    return MIGRATION_GUARD_STATES.clean;
  }

  return rows[0].state;
}

async function setMigrationGuardState(client, state, marker = null) {
  await query(client, `
    INSERT INTO ${MIGRATION_GUARD_TABLE} (id, state, marker)
    VALUES ($1, $2, $3)
    ON CONFLICT (id) DO UPDATE
    SET state = EXCLUDED.state,
        marker = EXCLUDED.marker,
        updated_at = NOW()
  `, [MIGRATION_GUARD_ID, state, marker]);
}

async function assertNoDirtyMigrationState(client) {
  const state = await ensureMigrationGuardSchema(client);
  if (state === MIGRATION_GUARD_STATES.dirty || state === MIGRATION_GUARD_STATES.running) {
    const rows = await query(
      client,
      `SELECT marker FROM ${MIGRATION_GUARD_TABLE} WHERE id = $1`,
      [MIGRATION_GUARD_ID]
    );
    const marker = rows[0]?.marker;
    throw new Error(`Aborting migrations because migration guard state is ${state}: ${marker || 'unknown reason'}`);
  }
}

async function acquireMigrationLock(client, lockValue) {
  await query(client, `SET statement_timeout TO '${LOCK_TIMEOUT_MS}ms'`);
  try {
    await query(client, 'SELECT pg_advisory_lock($1)', [lockValue]);
  } catch (error) {
    if (error?.code === '57014') {
      throw new Error(`Timed out waiting ${LOCK_TIMEOUT_MS}ms for the migration lock`);
    }
    throw error;
  } finally {
    await query(client, 'SET statement_timeout TO 0').catch(() => {});
  }
}

async function releaseMigrationLock(client, lockValue) {
  await query(client, 'SELECT pg_advisory_unlock($1)', [lockValue]).catch(() => {});
}

function advisoryLockParts(lockValue) {
  const value = BigInt(lockValue);
  return {
    classId: Number(BigInt.asUintN(32, value >> 32n)),
    objectId: Number(BigInt.asUintN(32, value))
  };
}

async function assertMigrationLockHeld(client, lockValue) {
  const { classId, objectId } = advisoryLockParts(lockValue);
  const rows = await query(client, `
    SELECT EXISTS (
      SELECT 1
      FROM pg_locks
      WHERE locktype = 'advisory'
        AND pid = pg_backend_pid()
        AND granted
        AND classid = $1
        AND objid = $2
        AND objsubid = 1
    ) AS held
  `, [classId, objectId]);
  if (rows[0]?.held !== true) {
    throw new Error('Migration advisory lock was lost before completion');
  }
}

async function assertMigrationReady({
  databaseUrl = readDatabaseConfig().url,
  clientFactory = (connectionString) => new Client({ connectionString })
} = {}) {
  const client = clientFactory(databaseUrl);
  await client.connect();
  try {
    const relation = await query(client, `SELECT to_regclass('public.${MIGRATION_GUARD_TABLE}') AS table_name`);
    if (!relation[0]?.table_name) return true;
    const rows = await query(
      client,
      `SELECT state, marker FROM ${MIGRATION_GUARD_TABLE} WHERE id = $1`,
      [MIGRATION_GUARD_ID]
    );
    const state = rows[0]?.state;
    if (state === MIGRATION_GUARD_STATES.running || state === MIGRATION_GUARD_STATES.dirty) {
      throw new Error(`API rollout blocked by migration guard state ${state}: ${rows[0]?.marker || 'unknown reason'}`);
    }
    return true;
  } finally {
    await client.end();
  }
}

async function runMigrations({
  databaseUrl = readDatabaseConfig().url,
  direction = 'up',
  dir = DEFAULT_MIGRATIONS_DIR,
  logger = console,
  noLock = process.env.NODE_ENV === 'test',
  lockValue = PG_MIGRATE_LOCK_ID,
  clearDirty = false,
  clientFactory = (connectionString) => new Client({ connectionString }),
  migrationRunner = runner
} = {}) {
  if (noLock) {
    return migrationRunner({
      databaseUrl,
      dir,
      direction,
      migrationsTable: DEFAULT_MIGRATIONS_TABLE,
      count: direction === 'down' ? 1 : undefined,
      singleTransaction: true,
      checkOrder: true,
      logger: migrationLogger(logger),
      noLock: true
    });
  }

  const client = clientFactory(databaseUrl);
  await client.connect();
  let locked = false;
  let migrationStarted = false;

  try {
    await acquireMigrationLock(client, lockValue);
    locked = true;
    await assertMigrationLockHeld(client, lockValue);
    if (clearDirty) {
      await ensureMigrationGuardSchema(client);
      await setMigrationGuardState(client, MIGRATION_GUARD_STATES.clean, 'cleared by explicit operator request');
      logger.warn?.('Cleared dirty migration state by explicit operator request.');
      return [];
    }
    await assertNoDirtyMigrationState(client);

    await setMigrationGuardState(client, MIGRATION_GUARD_STATES.running, `direction=${direction},dir=${path.basename(dir)}`);
    migrationStarted = true;

    const migrations = await migrationRunner({
      dbClient: client,
      dir,
      direction,
      migrationsTable: DEFAULT_MIGRATIONS_TABLE,
      count: direction === 'down' ? 1 : undefined,
      singleTransaction: true,
      checkOrder: true,
      logger: migrationLogger(logger),
      noLock: true
    });

    await assertMigrationLockHeld(client, lockValue);
    await setMigrationGuardState(client, MIGRATION_GUARD_STATES.clean, `last=${path.basename(dir)}:${direction}`);
    if (migrations.length) {
      logger.log(`PostgreSQL migrations ${direction} complete (${migrations.length} applied).`);
    } else {
      logger.log(`PostgreSQL migrations ${direction} no-op.`);
    }

    return migrations;
  } catch (error) {
    if (migrationStarted) {
      await setMigrationGuardState(client, MIGRATION_GUARD_STATES.dirty, `direction=${direction}, error=${error.message}`).catch(() => {});
    }
    throw error;
  } finally {
    if (locked) {
      await releaseMigrationLock(client, lockValue);
    }
    await client.end();
  }
}

module.exports = {
  DEFAULT_MIGRATIONS_DIR,
  assertMigrationLockHeld,
  assertMigrationReady,
  advisoryLockParts,
  runMigrations,
  MIGRATION_GUARD_TABLE,
  MIGRATION_GUARD_STATES,
  LOCK_TIMEOUT_MS
};
