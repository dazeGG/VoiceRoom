// Typed query builder over the API's existing pg pool. Repositories move to it
// one route group at a time (docs/ARCHITECTURE.md, section 4); until then raw
// SQL and Kysely share the same pool and therefore the same connection limits.
//
// `DB` is generated from a migrated database with `npm run db:types`, and
// test/db-schema-types.test.js fails when it no longer matches the migrations.

import { Kysely, PostgresDialect, type Transaction } from 'kysely';
import type { Pool } from 'pg';
import type { DB } from './schema.ts';

export type Database = Kysely<DB>;
export type DatabaseTransaction = Transaction<DB>;

export function createKysely(pool: Pool): Database {
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
