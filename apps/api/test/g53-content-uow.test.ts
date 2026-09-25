import assert from 'node:assert/strict';
import test from 'node:test';
import { createContentRepository } from '../src/domains/messaging/content-repository.ts';
test('G53-A01 canonical write always derives text from content',()=>{const repo=createContentRepository();assert.deepEqual(repo.prepareWrite({text:'ignored',content:{version:1,segments:[{type:'text',text:'canonical'}]}}),{text:'canonical',content:{version:1,segments:[{type:'text',text:'canonical'}]}});});
