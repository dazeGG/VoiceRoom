'use strict';
const assert=require('node:assert/strict');const test=require('node:test');
const c=require('../src/room-message-content');
test('G51-A01 structured content projects deterministic safe text',()=>{const value={version:1,segments:[{type:'text',text:'Привет '},{type:'mention',userId:'u',label:'@Ёж'},{type:'link',href:'https://example.com/a?q=1',label:' ссылка'}]};assert.deepEqual(c.normalizeRoomMessageContent(value),value);assert.equal(c.projectRoomMessageContent(value),'Привет @Ёж ссылка');});
test('G51-A02 invalid or unknown content falls back and raw HTML rejects',()=>{assert.equal(c.normalizeRoomMessageContent({version:2,segments:[]}),null);assert.equal(c.normalizeRoomMessageContent({version:1,segments:[{type:'text',text:'<img onerror=x>'}]}),null);assert.equal(c.projectRoomMessageContent({version:2},'legacy'),'legacy');});
