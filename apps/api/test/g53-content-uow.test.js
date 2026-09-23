import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createContentRepository } from '../src/domains/messaging/content-repository.js';
test('G53-A01 canonical write always derives text from content',()=>{const repo=createContentRepository();assert.deepEqual(repo.prepareWrite({text:'ignored',content:{version:1,segments:[{type:'text',text:'canonical'}]}}),{text:'canonical',content:{version:1,segments:[{type:'text',text:'canonical'}]}});});
test('G53-A02 room append owns one injected transaction callback',()=>{const s=fs.readFileSync(path.resolve(import.meta.dirname,'../src/domains/messaging/room-chat.service.ts'),'utf8');const start=s.indexOf('deps.messages().room.appendMessage(roomId');const end=s.indexOf('\n    });',start);assert.ok(start>0&&end>start);const call=s.slice(start,end);assert.match(call,/unitOfWork:[\s\S]*\? async \(client, inserted\)/);assert.equal((call.match(/async \(client, inserted\)/g)||[]).length,1);});
