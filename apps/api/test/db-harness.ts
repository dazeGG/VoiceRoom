// @ts-nocheck -- not type-checked yet; remove once the file passes tsconfig.json.
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { readDatabaseConfig } from '../src/lib/config.ts';

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function databaseName() {
  return `voice_room_test_${crypto.randomBytes(8).toString('hex')}`;
}

function databaseUrlFor(baseUrl, name) {
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

async function waitForSessionsToLeave(admin, name) {
  const deadline = Date.now() + SESSION_DRAIN_TIMEOUT_MS;
  for (;;) {
    const { rows } = await admin.query(
      `SELECT count(*)::int AS count
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [name]
    );
    if (rows[0].count === 0 || Date.now() >= deadline) return;
    await new Promise((resolve) => setTimeout(resolve, SESSION_DRAIN_POLL_MS));
  }
}

async function createTestDatabase(t) {
  const { url } = readDatabaseConfig({ DATABASE_URL: process.env.TEST_DATABASE_URL });
  const name = databaseName();
  const admin = new Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE DATABASE ${quoteIdent(name)}`);
  const databaseUrl = databaseUrlFor(url, name);

  async function cleanup() {
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

  return { cleanup, databaseUrl, databaseName: name };
}

export { createTestDatabase };
