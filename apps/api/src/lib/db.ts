import pg from 'pg';
import { readDatabaseConfig } from './config.ts';
import { recordPgPoolError } from './metrics.ts';
import { LOG_EVENTS } from './log-events.ts';
import { createLogger } from './logger.ts';

type PoolLogger = { error(...args: unknown[]): void };

function createDbPool({
  databaseUrl = readDatabaseConfig().url,
  logger = createLogger({ name: 'api' }),
  max = 10
}: {
  databaseUrl?: string;
  logger?: PoolLogger | unknown;
  max?: number;
} = {}): pg.Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max
  });

  pool.on('error', (error) => {
    recordPgPoolError();
    (logger as PoolLogger).error({ evt: LOG_EVENTS.DB_POOL_ERROR, err: error }, 'unexpected PostgreSQL pool error');
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
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export { createDbPool, transaction };
