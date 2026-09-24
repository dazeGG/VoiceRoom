import type pg from 'pg';
import { createDbPool } from './db.ts';

function createRelease250Pool({ databaseUrl }: { databaseUrl?: string }): pg.Pool {
  return createDbPool({ databaseUrl });
}

export { createRelease250Pool };
