// Down migrations run one at a time from the head, so reaching one migration
// also undoes every migration added after it. The steps are counted over the
// runner's own catalogue (.cjs history and new .ts migrations alike).

import assert from 'node:assert/strict';
import { expectedMigrationCatalog, runMigrations } from '../src/lib/migrate.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };

/** How many down steps undo `name` (a file name, with or without extension). */
export function rollbackCountThrough(name: string): number {
  const names = expectedMigrationCatalog();
  const index = names.indexOf(name.replace(/\.(?:c?js|ts)$/, ''));
  assert.notEqual(index, -1, `${name} is missing from the migrations directory`);
  return names.length - index;
}

/** Rolls the database back until `name` is undone; answers the number of steps. */
export async function rollBackThrough(databaseUrl: string, name: string): Promise<number> {
  const steps = rollbackCountThrough(name);
  for (let step = 0; step < steps; step += 1) {
    assert.equal((await runMigrations({ databaseUrl, direction: 'down', logger: SILENT })).length, 1);
  }
  return steps;
}
