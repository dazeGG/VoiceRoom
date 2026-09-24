// Typed query builder over a pg pool. No repository uses it yet; the move is
// tracked in docs/ARCHITECTURE.md, section 4.
//
// `DB` is generated from a migrated database with `npm run db:types`, and
// test/db-schema-types.test.ts fails when it no longer matches the migrations.

import { Kysely, PostgresDialect, type Transaction } from 'kysely';
import type { Pool } from 'pg';
import type { DB } from './schema.ts';

export type Database = Kysely<DB>;
export type DatabaseTransaction = Transaction<DB>;

export function createKysely(pool: Pool): Database {
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
