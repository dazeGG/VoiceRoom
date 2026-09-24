import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
test('G56-A01 inbox/outbox schema is inert, unique and cursor indexed',()=>{const s=fs.readFileSync(path.resolve(import.meta.dirname,'../src/migrations/20260718133000_create_notification_inbox_and_outbox.cjs'),'utf8');assert.match(s,/recipient_source_unique_idx/);assert.match(s,/notification_revision_channel_unique_idx/);assert.match(s,/unread_cursor_idx/);assert.match(s,/default: 'pending'/);});
test('G56-A02 migration is lock bounded and reversible',()=>{const s=fs.readFileSync(path.resolve(import.meta.dirname,'../src/migrations/20260718133000_create_notification_inbox_and_outbox.cjs'),'utf8');assert.match(s,/SET LOCAL lock_timeout = '5s'/);assert.match(s,/dropTable\('notification_outbox'\)/);});
