import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

test('G25-A01 exact tuple state coexists with legacy read projections', () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/migrations/20260718122000_add_message_read_cursors.cjs'),
    'utf8'
  );
  assert.match(source, /last_read_message_created_at/);
  assert.match(source, /last_read_message_id/);
  assert.match(source, /direct_message_read_cursors/);
  assert.match(source, /exports\.down = \(\) => \{\}/);
  assert.doesNotMatch(source, /DROP COLUMN/);
});

test('G25-A02 cursor pair constraint represents equal-time messages by stable id', () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/migrations/20260718122000_add_message_read_cursors.cjs'),
    'utf8'
  );
  assert.match(source, /last_read_message_created_at IS NOT NULL AND last_read_message_id IS NOT NULL/);
  assert.match(source, /PRIMARY KEY \(user_id, peer_user_id\)/);
});
