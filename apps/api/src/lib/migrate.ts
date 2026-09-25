import { Client } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { PG_MIGRATE_LOCK_ID, runner } from 'node-pg-migrate';
import { readDatabaseConfig } from './config.ts';
import { LOG_EVENTS } from './log-events.ts';
import { createLogger } from './logger.ts';

type LogMethod = (...items: unknown[]) => void;
type MigrationLogSink = { info?: LogMethod; warn?: LogMethod; error?: LogMethod; log?: LogMethod };
type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, any>[] }> };
type MigrationClient = QueryClient & { connect(): Promise<unknown>; end(): Promise<unknown> };
type ClientFactory = (connectionString: string) => MigrationClient;
type RunMigration = Awaited<ReturnType<typeof runner>>[number];
type MigrationRunner = (options: Record<string, unknown>) => Promise<RunMigration[]>;
export type MigrationGuardState = 'clean' | 'running' | 'dirty';

const DEFAULT_MIGRATIONS_DIR = path.resolve(import.meta.dirname, '..', 'migrations');
const DEFAULT_MIGRATIONS_TABLE = 'pgmigrations';
const MIGRATION_GUARD_TABLE = 'voiceroom_migration_guard';
const MIGRATION_GUARD_ID = 1;
const MIGRATION_GUARD_STATES: { readonly [State in MigrationGuardState]: State } = {
  clean: 'clean',
  running: 'running',
  dirty: 'dirty'
};
const LOCK_TIMEOUT_MS = 5000;

function expectedMigrationCatalog(dir: string = DEFAULT_MIGRATIONS_DIR): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:c?js|ts)$/.test(entry.name))
    .map((entry) => entry.name.replace(/\.(?:c?js|ts)$/, ''))
    .sort();
}

function migrationLogger(logger: MigrationLogSink | null | undefined): Required<MigrationLogSink> {
  return {
    info: (...items) => logger?.info?.(...items),
    warn: (...items) => logger?.warn?.(...items),
    error: (...items) => logger?.error?.(...items),
    // node-pg-migrate calls `log` for progress; pino has no such level, so it
    // lands on info rather than disappearing through optional chaining.
    log: (...items) => (logger?.log ? logger.log(...items) : logger?.info?.(...items))
  };
}

async function query(client: QueryClient, text: string, values: unknown[] = []): Promise<Record<string, any>[]> {
  const { rows } = await client.query(text, values);
  return rows;
}

async function ensureMigrationGuardSchema(client: QueryClient): Promise<string> {
  await query(
    client,
    `
    CREATE TABLE IF NOT EXISTS ${MIGRATION_GUARD_TABLE} (
      id integer PRIMARY KEY,
      state text NOT NULL,
      marker text,
      updated_at timestamptz NOT NULL DEFAULT NOW()
    )
  `
  );

  const rows = await query(client, `SELECT state FROM ${MIGRATION_GUARD_TABLE} WHERE id = $1`, [MIGRATION_GUARD_ID]);
  if (rows.length === 0) {
    await query(client, `INSERT INTO ${MIGRATION_GUARD_TABLE} (id, state, marker) VALUES ($1, $2, $3)`, [
      MIGRATION_GUARD_ID,
      MIGRATION_GUARD_STATES.clean,
      null
    ]);
    return MIGRATION_GUARD_STATES.clean;
  }

  return (rows[0] as { state: string }).state;
}

async function setMigrationGuardState(
  client: QueryClient,
  state: MigrationGuardState,
  marker: string | null = null
): Promise<void> {
  await query(
    client,
    `
    INSERT INTO ${MIGRATION_GUARD_TABLE} (id, state, marker)
    VALUES ($1, $2, $3)
    ON CONFLICT (id) DO UPDATE
    SET state = EXCLUDED.state,
        marker = EXCLUDED.marker,
        updated_at = NOW()
  `,
    [MIGRATION_GUARD_ID, state, marker]
  );
}

async function assertNoDirtyMigrationState(client: QueryClient): Promise<void> {
  const state = await ensureMigrationGuardSchema(client);
  if (state === MIGRATION_GUARD_STATES.dirty || state === MIGRATION_GUARD_STATES.running) {
    const rows = await query(client, `SELECT marker FROM ${MIGRATION_GUARD_TABLE} WHERE id = $1`, [MIGRATION_GUARD_ID]);
    const marker = rows[0]?.marker;
    throw new Error(`Aborting migrations because migration guard state is ${state}: ${marker || 'unknown reason'}`);
  }
}

async function acquireMigrationLock(client: QueryClient, lockValue: number | bigint): Promise<void> {
  await query(client, `SET statement_timeout TO '${LOCK_TIMEOUT_MS}ms'`);
  try {
    await query(client, 'SELECT pg_advisory_lock($1)', [lockValue]);
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === '57014') {
      throw new Error(`Timed out waiting ${LOCK_TIMEOUT_MS}ms for the migration lock`);
    }
    throw error;
  } finally {
    await query(client, 'SET statement_timeout TO 0').catch(() => {});
  }
}

async function releaseMigrationLock(client: QueryClient, lockValue: number | bigint): Promise<void> {
  await query(client, 'SELECT pg_advisory_unlock($1)', [lockValue]).catch(() => {});
}

function advisoryLockParts(lockValue: number | bigint | string): { classId: number; objectId: number } {
  const value = BigInt(lockValue);
  return {
    classId: Number(BigInt.asUintN(32, value >> 32n)),
    objectId: Number(BigInt.asUintN(32, value))
  };
}

async function assertMigrationLockHeld(client: QueryClient, lockValue: number | bigint): Promise<void> {
  const { classId, objectId } = advisoryLockParts(lockValue);
  const rows = await query(
    client,
    `
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
  `,
    [classId, objectId]
  );
  if (rows[0]?.held !== true) {
    throw new Error('Migration advisory lock was lost before completion');
  }
}

async function assertMigrationReady({
  databaseUrl = readDatabaseConfig().url,
  dir = DEFAULT_MIGRATIONS_DIR,
  clientFactory = (connectionString: string) => new Client({ connectionString })
}: {
  databaseUrl?: string;
  dir?: string;
  clientFactory?: ClientFactory;
} = {}): Promise<true> {
  const client = clientFactory(databaseUrl);
  await client.connect();
  try {
    const relation = await query(
      client,
      `SELECT
      to_regclass('public.${MIGRATION_GUARD_TABLE}') AS guard_table,
      to_regclass('public.${DEFAULT_MIGRATIONS_TABLE}') AS migrations_table`
    );
    if (!relation[0]?.guard_table || !relation[0]?.migrations_table) {
      throw new Error('API rollout blocked because the migration guard or catalog is absent');
    }
    const rows = await query(client, `SELECT state, marker FROM ${MIGRATION_GUARD_TABLE} WHERE id = $1`, [
      MIGRATION_GUARD_ID
    ]);
    const state = rows[0]?.state;
    if (state === MIGRATION_GUARD_STATES.running || state === MIGRATION_GUARD_STATES.dirty) {
      throw new Error(`API rollout blocked by migration guard state ${state}: ${rows[0]?.marker || 'unknown reason'}`);
    }
    if (state !== MIGRATION_GUARD_STATES.clean)
      throw new Error(`API rollout blocked by unknown migration guard state ${state || 'missing'}`);
    const applied = (await query(client, `SELECT name FROM ${DEFAULT_MIGRATIONS_TABLE} ORDER BY name ASC`)).map(
      (row) => row.name
    );
    const expected = expectedMigrationCatalog(dir);
    if (applied.length !== expected.length || applied.some((name, index) => name !== expected[index])) {
      throw new Error(
        `API rollout blocked because migration catalog/head does not match this build (expected ${expected.at(-1) || 'none'}, got ${applied.at(-1) || 'none'})`
      );
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
  logger = createLogger({ name: 'api' }),
  noLock = process.env.NODE_ENV === 'test',
  lockValue = PG_MIGRATE_LOCK_ID,
  clearDirty = false,
  clientFactory = (connectionString: string) => new Client({ connectionString }),
  migrationRunner = runner as unknown as MigrationRunner
}: {
  databaseUrl?: string;
  direction?: 'up' | 'down';
  dir?: string;
  logger?: MigrationLogSink & { info: LogMethod; warn: LogMethod };
  noLock?: boolean;
  lockValue?: number | bigint;
  clearDirty?: boolean;
  clientFactory?: ClientFactory;
  migrationRunner?: MigrationRunner;
} = {}): Promise<RunMigration[]> {
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
      logger.warn(
        { evt: LOG_EVENTS.MIGRATION_DIRTY_CLEARED },
        'cleared dirty migration state by explicit operator request'
      );
      return [];
    }
    await assertNoDirtyMigrationState(client);

    await setMigrationGuardState(
      client,
      MIGRATION_GUARD_STATES.running,
      `direction=${direction},dir=${path.basename(dir)}`
    );
    migrationStarted = true;
    await query(client, `SET lock_timeout TO '${LOCK_TIMEOUT_MS}ms'`);

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
      logger.info(
        { evt: LOG_EVENTS.MIGRATION_COMPLETED, direction, applied: migrations.length },
        'PostgreSQL migrations complete'
      );
    } else {
      logger.info({ evt: LOG_EVENTS.MIGRATION_COMPLETED, direction, applied: 0 }, 'PostgreSQL migrations were a no-op');
    }

    return migrations;
  } catch (error) {
    if (migrationStarted) {
      await setMigrationGuardState(
        client,
        MIGRATION_GUARD_STATES.dirty,
        `direction=${direction}, error=${(error as Error).message}`
      ).catch(() => {});
    }
    throw error;
  } finally {
    if (locked) {
      await query(client, 'SET lock_timeout TO 0').catch(() => {});
    }
    if (locked) {
      await releaseMigrationLock(client, lockValue);
    }
    await client.end();
  }
}

export {
  DEFAULT_MIGRATIONS_DIR,
  expectedMigrationCatalog,
  assertMigrationLockHeld,
  assertMigrationReady,
  advisoryLockParts,
  runMigrations,
  MIGRATION_GUARD_TABLE,
  MIGRATION_GUARD_STATES,
  LOCK_TIMEOUT_MS
};
