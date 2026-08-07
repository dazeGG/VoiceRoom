'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

test('G24-A01 history indexes are additive tuple indexes under the runner lock budget', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/migrations/20260718121000_add_message_history_cursor_indexes.js'), 'utf8');
  const runner = fs.readFileSync(path.resolve(__dirname, '../src/lib/migrate.js'), 'utf8');
  assert.match(runner, /SET lock_timeout TO '\$\{LOCK_TIMEOUT_MS\}ms'/);
  assert.match(source, /sender_id, recipient_id, created_at DESC, id DESC/);
  assert.match(source, /recipient_id, sender_id, created_at DESC, id DESC/);
  assert.match(source, /WHERE deleted_at IS NULL/g);
  assert.match(source, /exports\.down = \(\) => \{\}/);
  assert.doesNotMatch(source, /OFFSET/i);
});

test('G24-A02 room and DM history repositories use tuple comparisons without offset scans', () => {
  for (const name of ['room-history-repository.js', 'dm-history-repository.js']) {
    const source = fs.readFileSync(path.resolve(__dirname, `../src/domains/messaging/${name}`), 'utf8');
    assert.match(source, /created_at/);
    assert.match(source, /id/);
    assert.doesNotMatch(source, /OFFSET/i);
  }
});
