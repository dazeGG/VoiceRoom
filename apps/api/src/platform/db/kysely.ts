// Typed query builder over the process's pg pool.
//
// `DB` is generated from a migrated database with `npm run db:types`, and
// test/db-schema-types.test.ts fails when it no longer matches the migrations.
//
// Repositories build their queries on one `Database` made from the pool.
// Code that still drives a transaction on a raw pg client hands that client
// down; `kyselyOn(client)` runs the typed queries on the same connection, so
// they join the caller's transaction.

import { Kysely, PostgresDialect, type Transaction } from 'kysely';
import type pg from 'pg';
import type { DB } from './schema.ts';

export type Database = Kysely<DB>;
export type DatabaseTransaction = Transaction<DB>;

/** A pool or a client already inside a caller's transaction. */
export type Queryable = Pick<pg.Pool, 'query'> | pg.PoolClient;

export function createKysely(pool: pg.Pool): Database {
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

// Kysely asks its "pool" for a connection per query; this one always hands out
// the caller's connection and never releases it, since the caller owns it.
function singleConnectionPool(client: Queryable): pg.Pool {
  const connection = { query: client.query.bind(client), release() {} };
  return { connect: async () => connection, end: async () => {} } as unknown as pg.Pool;
}

function isPool(client: Queryable): client is pg.Pool {
  return 'idleCount' in client && 'connect' in client;
}

const bound = new WeakMap<Queryable, Database>();

/**
 * A Database that runs on `client`: over a pool, one per pool; over a single
 * connection, the typed queries share it (never start a transaction on that
 * one, the caller already holds it).
 */
export function kyselyOn(client: Queryable): Database {
  let db = bound.get(client);
  if (!db) {
    db = isPool(client)
      ? createKysely(client)
      : new Kysely<DB>({ dialect: new PostgresDialect({ pool: singleConnectionPool(client) }) });
    bound.set(client, db);
  }
  return db;
}

/** Runs `work` in one transaction: committed when it resolves, rolled back when it throws. */
export function withTransaction<T>(db: Database, work: (trx: DatabaseTransaction) => Promise<T>): Promise<T> {
  return db.transaction().execute(work);
}
