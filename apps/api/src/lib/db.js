import { Pool } from 'pg';
import { readDatabaseConfig } from './config.js';
import { recordPgPoolError } from './metrics.js';
import { LOG_EVENTS } from './log-events.js';
import { createLogger } from './logger.js';

function createDbPool({ databaseUrl = readDatabaseConfig().url, logger = createLogger({ name: 'api' }), max = 10 } = {}) {
  const pool = new Pool({
    connectionString: databaseUrl,
    max
  });

  pool.on('error', (error) => {
    recordPgPoolError();
    logger.error({ evt: LOG_EVENTS.DB_POOL_ERROR, err: error }, 'unexpected PostgreSQL pool error');
  });

  return pool;
}

async function transaction(pool, callback) {
  const client = await pool.connect();
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
