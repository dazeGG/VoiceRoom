import pg from 'pg';
import { recordPgPoolError } from '../../lib/metrics.ts';
import { LOG_EVENTS } from '../../lib/log-events.ts';
import { createLogger } from '../../lib/logger.ts';
import type { Logger } from '../types.ts';

// Without these one stuck query holds a connection for good, and once all of
// them are held every request waits forever instead of failing.
const CONNECTION_WAIT_MS = 10_000;
const STATEMENT_TIMEOUT_MS = 60_000;
const IDLE_IN_TRANSACTION_TIMEOUT_MS = 60_000;

/**
 * A PostgreSQL pool. Each process opens one, at its entrypoint, and hands it to
 * every store and repository; modules never open their own.
 */
function createDbPool({
  databaseUrl,
  logger = createLogger({ name: 'api' }),
  max = 10,
  statementTimeoutMs = STATEMENT_TIMEOUT_MS,
  connectionWaitMs = CONNECTION_WAIT_MS
}: {
  databaseUrl: string;
  logger?: Pick<Logger, 'error'> | undefined;
  max?: number;
  statementTimeoutMs?: number;
  connectionWaitMs?: number;
}): pg.Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max,
    connectionTimeoutMillis: connectionWaitMs,
    statement_timeout: statementTimeoutMs,
    idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS
  });

  pool.on('error', (error) => {
    recordPgPoolError();
    logger.error({ evt: LOG_EVENTS.DB_POOL_ERROR, err: error }, 'unexpected PostgreSQL pool error');
  });

  return pool;
}

async function transaction<T>(
  pool: Pick<pg.Pool, 'connect'> | null | undefined,
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  if (!pool) throw new Error('No PostgreSQL pool is installed');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    // A broken connection fails the rollback too; the caller needs the first error.
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export { createDbPool, transaction };
