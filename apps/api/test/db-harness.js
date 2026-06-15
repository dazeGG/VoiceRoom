'use strict';

const crypto = require('node:crypto');
const { Pool } = require('pg');
const { readDatabaseConfig } = require('../src/lib/config');

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function databaseName() {
  return `voice_room_test_${crypto.randomBytes(8).toString('hex')}`;
}

function databaseUrlFor(baseUrl, name) {
  const parsed = new URL(baseUrl);
  parsed.pathname = `/${name}`;
  parsed.search = '';
  return parsed.toString();
}

async function createTestDatabase(t) {
  const { url } = readDatabaseConfig({ DATABASE_URL: process.env.TEST_DATABASE_URL });
  const name = databaseName();
  const admin = new Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE DATABASE ${quoteIdent(name)}`);
  const databaseUrl = databaseUrlFor(url, name);

  async function cleanup() {
    await admin.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [name]
    );
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)}`);
    await admin.end();
  }

  return { cleanup, databaseUrl, databaseName: name };
}

module.exports = {
  createTestDatabase
};
