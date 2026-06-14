'use strict';

const path = require('node:path');
const { runner } = require('node-pg-migrate');
const { readDatabaseConfig } = require('./config');

const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');
const DEFAULT_MIGRATIONS_TABLE = 'pgmigrations';

async function runMigrations({
  databaseUrl = readDatabaseConfig().url,
  direction = 'up',
  dir = DEFAULT_MIGRATIONS_DIR,
  logger = console,
  noLock = process.env.NODE_ENV === 'test'
} = {}) {
  const migrations = await runner({
    databaseUrl,
    dir,
    direction,
    migrationsTable: DEFAULT_MIGRATIONS_TABLE,
    count: direction === 'down' ? 1 : undefined,
    singleTransaction: true,
    checkOrder: true,
    logger,
    noLock
  });

  logger.log(`PostgreSQL migrations ${direction} complete (${migrations.length} applied).`);
  return migrations;
}

module.exports = {
  DEFAULT_MIGRATIONS_DIR,
  runMigrations
};
