// node-pg-migrate reads a 13- or 17-digit prefix as a time and reports ours
// (14 digits, yyyymmddhhmmss) as an error on every run, though it orders them
// correctly. That one line is dropped; every other record gets through.

import test from 'node:test';
import assert from 'node:assert/strict';
import { migrationLogger } from '../src/lib/migrate.ts';

test('the migration log drops the false timestamp error and keeps real ones', () => {
  const seen: Array<[string, unknown[]]> = [];
  const sink = migrationLogger({
    info: (...items) => seen.push(['info', items]),
    warn: (...items) => seen.push(['warn', items]),
    error: (...items) => seen.push(['error', items])
  });

  sink.error("Can't determine timestamp for 20260929160000");
  sink.error("Can't determine timestamp for notadate");
  sink.error('relation "rooms" does not exist');
  sink.warn('slow migration');
  sink.log('Migrating files:');

  assert.deepEqual(seen, [
    ['error', ["Can't determine timestamp for notadate"]],
    ['error', ['relation "rooms" does not exist']],
    ['warn', ['slow migration']],
    ['info', ['Migrating files:']]
  ]);
});
