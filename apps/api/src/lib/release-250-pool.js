'use strict';

const { createDbPool } = require('./db');

function createRelease250Pool({ databaseUrl }) {
  return createDbPool({ databaseUrl });
}

module.exports = { createRelease250Pool };
