#!/usr/bin/env node
'use strict';

const { readDatabaseConfig } = require('../lib/config');
const { runMigrations } = require('../lib/migrate');

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  const direction = args.has('down') ? 'down' : 'up';
  const noLock = args.has('--no-lock');
  const clearDirty = args.has('--clear-dirty');
  return { direction, noLock, clearDirty };
}

async function main() {
  const { direction, noLock, clearDirty } = parseArgs(process.argv);
  if (noLock && process.env.NODE_ENV === 'production') {
    throw new Error('Production migrations require the fenced advisory lock');
  }
  if (direction === 'down' && process.env.NODE_ENV === 'production') {
    throw new Error('Production down migrations are disabled; roll back the application against additive schema');
  }
  const database = readDatabaseConfig(process.env);
  await runMigrations({
    databaseUrl: database.url,
    direction,
    noLock,
    clearDirty
  });
}

main().catch((error) => {
  console.error('PostgreSQL migration failed:', error.message);
  process.exitCode = 1;
});
