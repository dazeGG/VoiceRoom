import pg from 'pg';
import { readDatabaseConfig } from '../src/lib/config.ts';

// Open a real authenticated session before starting any integration worker.
// Never substitute DATABASE_URL: the harness creates and drops test databases.
export async function requireTestDatabase(): Promise<void> {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required for API integration tests');
  const { url } = readDatabaseConfig({ DATABASE_URL: process.env.TEST_DATABASE_URL });
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
  } catch {
    throw new Error('Cannot connect to PostgreSQL for API integration tests; check TEST_DATABASE_URL and the service');
  } finally {
    await client.end();
  }
}
