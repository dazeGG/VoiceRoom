'use strict';

const { Pool } = require('pg');
const { readDatabaseConfig } = require('./config');

function createDbPool({ databaseUrl = readDatabaseConfig().url, logger = console, max = 10 } = {}) {
  const pool = new Pool({
    connectionString: databaseUrl,
    max
  });

  pool.on('error', (error) => {
    logger.error('Unexpected PostgreSQL pool error:', error);
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
