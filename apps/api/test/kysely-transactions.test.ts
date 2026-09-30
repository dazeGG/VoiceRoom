// Typed queries and transactions over the shared pool: a Kysely transaction
// commits or rolls back as a whole, and typed queries handed a raw pg client
// join the transaction that client is in.

import test from 'node:test';
import assert from 'node:assert/strict';
import { transaction } from '../src/platform/db/pool.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { kyselyOn, withTransaction } from '../src/platform/db/kysely.ts';
import { createTestDatabase } from './db-harness.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;

function user(id: string) {
  return { id, login: id, display_name: id, password_hash: 'x' };
}

async function logins(pool: Parameters<typeof kyselyOn>[0]) {
  const rows = await kyselyOn(pool).selectFrom('users').select('login').orderBy('login').execute();
  return rows.map((row) => row.login);
}

test('withTransaction commits on success and rolls everything back on a throw', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  const db = kyselyOn(pool);

  await withTransaction(db, async (trx) => {
    await trx.insertInto('users').values(user('kept')).execute();
  });
  await assert.rejects(
    withTransaction(db, async (trx) => {
      await trx.insertInto('users').values(user('dropped')).execute();
      throw new Error('abort');
    }),
    /abort/
  );

  assert.deepEqual(await logins(pool), ['kept']);
  assert.equal(kyselyOn(pool), db, 'one Database per pool');
});

test('typed queries on a raw client share its transaction and its rollback', { skip }, async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });

  await assert.rejects(
    transaction(pool, async (client) => {
      await kyselyOn(client).insertInto('users').values(user('inside')).execute();
      const seen = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM users');
      assert.equal(seen.rows[0]?.count, 1, 'the raw client sees the typed insert: same connection');
      throw new Error('abort');
    }),
    /abort/
  );
  assert.deepEqual(await logins(pool), []);

  await transaction(pool, async (client) => {
    await kyselyOn(client).insertInto('users').values(user('committed')).execute();
  });
  assert.deepEqual(await logins(pool), ['committed']);
});

test('a failed rollback still reports the error that aborted the transaction', async () => {
  const statements: string[] = [];
  let released = false;
  const client = {
    async query(text: string) {
      statements.push(text);
      if (text === 'ROLLBACK') throw new Error('connection terminated');
      return { rows: [] };
    },
    release() {
      released = true;
    }
  };
  const pool = { connect: async () => client } as unknown as Parameters<typeof transaction>[0];
  await assert.rejects(
    transaction(pool, async () => {
      throw new Error('quota exceeded');
    }),
    /quota exceeded/
  );
  assert.deepEqual(statements, ['BEGIN', 'ROLLBACK']);
  assert.equal(released, true);
});
