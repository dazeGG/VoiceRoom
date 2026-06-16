'use strict';

const { readDatabaseConfig } = require('../src/lib/config');

try {
  readDatabaseConfig({ DATABASE_URL: process.env.TEST_DATABASE_URL });
} catch (error) {
  console.error(`TEST_DATABASE_URL is required for API tests: ${error.message}`);
  process.exit(1);
}
