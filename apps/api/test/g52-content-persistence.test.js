'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const test=require('node:test');
const {projectStoredRoomMessage}=require('../src/domains/messaging/content-projector');
test('G52-A01 known/null/unknown persisted content has exact fallback',()=>{assert.equal(projectStoredRoomMessage({text:'old',content:null}).text,'old');assert.equal(projectStoredRoomMessage({text:'old',content:{version:2}}).text,'old');assert.equal(projectStoredRoomMessage({text:'old',content:{version:1,segments:[{type:'text',text:'new'}]}}).text,'new');});
test('G52-A02 migration is nullable bounded and lock-limited',()=>{const s=fs.readFileSync(path.resolve(__dirname,'../src/migrations/20260718131000_add_room_message_structured_content.js'),'utf8');assert.match(s,/lock_timeout = '5s'/);assert.match(s,/LIMIT 1000/);assert.match(s,/content: \{ type: 'jsonb' \}/);});
