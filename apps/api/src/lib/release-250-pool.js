import { createDbPool } from './db.js';

function createRelease250Pool({ databaseUrl }) {
  return createDbPool({ databaseUrl });
}

export { createRelease250Pool };
