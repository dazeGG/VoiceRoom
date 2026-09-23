import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { projectStoredRoomMessage } from '../src/domains/messaging/content-projector.ts';
test('G52-A01 known/null/unknown persisted content has exact fallback',()=>{assert.equal(projectStoredRoomMessage({text:'old',content:null}).text,'old');assert.equal(projectStoredRoomMessage({text:'old',content:{version:2}}).text,'old');assert.equal(projectStoredRoomMessage({text:'old',content:{version:1,segments:[{type:'text',text:'new'}]}}).text,'new');});
test('G52-A02 migration is nullable bounded and lock-limited',()=>{const s=fs.readFileSync(path.resolve(import.meta.dirname,'../src/migrations/20260718131000_add_room_message_structured_content.cjs'),'utf8');assert.match(s,/lock_timeout = '5s'/);assert.match(s,/LIMIT 1000/);assert.match(s,/content: \{ type: 'jsonb' \}/);});
