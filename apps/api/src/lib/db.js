'use strict';

const { Pool } = require('pg');
const { readDatabaseConfig } = require('./config');
const { recordPgPoolError } = require('./metrics');
const { LOG_EVENTS } = require('./log-events');
const { createLogger } = require('./logger');

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

module.exports = {
  createDbPool,
  transaction
};
