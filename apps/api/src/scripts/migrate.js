#!/usr/bin/env node
'use strict';

const { readDatabaseConfig } = require('../lib/config');
const { runMigrations } = require('../lib/migrate');

async function main() {
  const direction = process.argv[2] === 'down' ? 'down' : 'up';
  const database = readDatabaseConfig(process.env);
  await runMigrations({ databaseUrl: database.url, direction });
}

main().catch((error) => {
  console.error('PostgreSQL migration failed:', error.message);
  process.exitCode = 1;
});
