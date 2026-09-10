'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const test=require('node:test');
const {createContentRepository}=require('../src/domains/messaging/content-repository');
test('G53-A01 canonical write always derives text from content',()=>{const repo=createContentRepository();assert.deepEqual(repo.prepareWrite({text:'ignored',content:{version:1,segments:[{type:'text',text:'canonical'}]}}),{text:'canonical',content:{version:1,segments:[{type:'text',text:'canonical'}]}});});
test('G53-A02 room append owns one injected transaction callback',()=>{const s=fs.readFileSync(path.resolve(__dirname,'../src/server.js'),'utf8');const start=s.indexOf('getMessageService().room.appendMessage(roomId');const end=s.indexOf('\n  });',start);const call=s.slice(start,end);assert.match(call,/unitOfWork:[\s\S]*\? async \(client, inserted\)/);assert.equal((call.match(/async \(client, inserted\)/g)||[]).length,1);});
