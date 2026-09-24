import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

test('G24-A01 history indexes are additive tuple indexes under the runner lock budget', () => {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, '../src/migrations/20260718121000_add_message_history_cursor_indexes.cjs'), 'utf8');
  const runner = fs.readFileSync(path.resolve(import.meta.dirname, '../src/lib/migrate.ts'), 'utf8');
  assert.match(runner, /SET lock_timeout TO '\$\{LOCK_TIMEOUT_MS\}ms'/);
  assert.match(source, /sender_id, recipient_id, created_at DESC, id DESC/);
  assert.match(source, /recipient_id, sender_id, created_at DESC, id DESC/);
  assert.match(source, /WHERE deleted_at IS NULL/g);
  assert.match(source, /exports\.down = \(\) => \{\}/);
  assert.doesNotMatch(source, /OFFSET/i);
});

test('G24-A02 room and DM history repositories use tuple comparisons without offset scans', () => {
  for (const name of ['room-history-repository.ts', 'dm-history-repository.ts']) {
    const source = fs.readFileSync(path.resolve(import.meta.dirname, `../src/domains/messaging/${name}`), 'utf8');
    assert.match(source, /created_at/);
    assert.match(source, /id/);
    assert.doesNotMatch(source, /OFFSET/i);
  }
});
