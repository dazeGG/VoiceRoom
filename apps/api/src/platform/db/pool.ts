import pg from 'pg';
import { recordPgPoolError } from '../../lib/metrics.ts';
import { LOG_EVENTS } from '../../lib/log-events.ts';
import { createLogger } from '../../lib/logger.ts';

type PoolLogger = { error(...args: unknown[]): void };

/**
 * A PostgreSQL pool. Each process opens one, at its entrypoint, and hands it to
 * every store and repository; modules never open their own.
 */
function createDbPool({
  databaseUrl,
  logger = createLogger({ name: 'api' }),
  max = 10
}: {
  databaseUrl: string;
  logger?: PoolLogger;
  max?: number;
}): pg.Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max
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
  const client = await pool!.connect();
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
