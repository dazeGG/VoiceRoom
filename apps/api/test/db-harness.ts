import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { Pool } from 'pg';
import { readDatabaseConfig } from '../src/lib/config.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createDbPool } from '../src/platform/db/pool.ts';
import { codeOf } from '../src/platform/error-code.ts';

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../src/migrations');
const TEMPLATE_PREFIX = 'voice_room_test_template_';
const SILENT = { log() {}, info() {}, warn() {}, error() {} };

function quoteIdent(value: string) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function databaseName() {
  return `voice_room_test_${crypto.randomBytes(8).toString('hex')}`;
}

function databaseUrlFor(baseUrl: string, name: string) {
  const parsed = new URL(baseUrl);
  parsed.pathname = `/${name}`;
  parsed.search = '';
  return parsed.toString();
}

// A pool resolves end() once its clients are out of the pool, before their
// sockets have closed. Terminating straight away reached backends that were
// still saying goodbye: the client got "terminating connection due to
// administrator command", the pool re-emitted it as its own 'error', and with
// no listener in the test node:test pinned that uncaught exception on whichever
// test happened to be running — a different one on every CI run. So cleanup
// first lets sessions leave by themselves and terminates only what is still
// there after the wait, such as a spawned server nobody waited for.
const SESSION_DRAIN_TIMEOUT_MS = 2000;
const SESSION_DRAIN_POLL_MS = 20;

async function waitForSessionsToLeave(admin: Pool, name: string) {
  const deadline = Date.now() + SESSION_DRAIN_TIMEOUT_MS;
  for (;;) {
    const { rows } = await admin.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [name]
    );
    if (rows[0]?.count === 0 || Date.now() >= deadline) return;
    await new Promise((resolve) => setTimeout(resolve, SESSION_DRAIN_POLL_MS));
  }
}

// Every test file runs in its own process, and running all migrations into a
// fresh database costs ~0.75 s against ~0.04 s for copying a migrated one. So
// the migrated schema is built once into a template database named after the
// migration files, and each test database is a copy of it. A new or changed
// migration gives a new name, so a stale template is never reused.
function templateName() {
  const hash = crypto.createHash('sha256');
  // The same files the runner picks up.
  const files = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:c?js|ts)$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const file of files) {
    hash.update(file);
    hash.update(fs.readFileSync(path.join(MIGRATIONS_DIR, file)));
  }
  return `${TEMPLATE_PREFIX}${hash.digest('hex').slice(0, 16)}`;
}

async function databaseExists(admin: Pool, name: string) {
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  return (rowCount ?? 0) > 0;
}

let template: Promise<string> | undefined;

/**
 * A rename that lost to another process renaming to the same name. PostgreSQL
 * reports it as duplicate_database, or, when both renames run at once, as a
 * unique violation on its catalog index.
 */
function lostTemplateRace(error: unknown): boolean {
  const code = codeOf(error);
  return code === '42P04' || code === '23505';
}

// Built under a scratch name and renamed only once fully migrated, so another
// process never copies a half-built template. If two processes race, the
// loser's rename fails (see lostTemplateRace) and it keeps the winner's.
async function buildTemplate(admin: Pool, baseUrl: string) {
  const name = templateName();
  if (await databaseExists(admin, name)) return name;
  const scratch = databaseName();
  await admin.query(`CREATE DATABASE ${quoteIdent(scratch)}`);
  try {
    await runMigrations({ databaseUrl: databaseUrlFor(baseUrl, scratch), logger: SILENT });
    await waitForSessionsToLeave(admin, scratch);
    await admin.query(`ALTER DATABASE ${quoteIdent(scratch)} RENAME TO ${quoteIdent(name)}`);
  } catch (error) {
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(scratch)}`);
    if (!lostTemplateRace(error)) throw error;
    return name;
  }
  // Templates of older migration sets are of no further use.
  const { rows } = await admin.query<{ datname: string }>(
    `SELECT datname FROM pg_database WHERE datname LIKE $1 AND datname <> $2`,
    [`${TEMPLATE_PREFIX}%`, name]
  );
  for (const row of rows) {
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(row.datname)}`).catch(() => {});
  }
  return name;
}

// The test context is accepted for call-site symmetry with t.after cleanups.
// The database comes fully migrated; `empty: true` gives a database without
// any schema, for tests of the migration runner itself.
async function createTestDatabase(_t?: TestContext, { empty = false }: { empty?: boolean } = {}) {
  const { url } = readDatabaseConfig({ DATABASE_URL: process.env.TEST_DATABASE_URL });
  const name = databaseName();
  const admin = new Pool({ connectionString: url, max: 1 });
  if (empty) {
    await admin.query(`CREATE DATABASE ${quoteIdent(name)}`);
  } else {
    template ??= buildTemplate(admin, url).catch((error: unknown) => {
      template = undefined;
      throw error;
    });
    await admin.query(`CREATE DATABASE ${quoteIdent(name)} TEMPLATE ${quoteIdent(await template)}`);
  }
  const databaseUrl = databaseUrlFor(url, name);
  // The test's one pool, as a process would have; stores and repositories
  // borrow it, cleanup ends it.
  const pool = createDbPool({ databaseUrl, logger: { error() {} } });

  async function cleanup() {
    if (!pool.ended) await pool.end();
    await waitForSessionsToLeave(admin, name);
    await admin.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [name]
    );
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)}`);
    await admin.end();
  }

  return { cleanup, databaseUrl, databaseName: name, pool };
}

export { createTestDatabase, lostTemplateRace };
