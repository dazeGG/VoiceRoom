import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import test from 'node:test';
const renderer=readFileSync(new URL('../src/lib/shared/chat/StructuredMessageContent.svelte',import.meta.url),'utf8');const composer=readFileSync(new URL('../src/lib/shared/chat/StructuredMessageComposer.svelte',import.meta.url),'utf8');
test('G54-A01 structured DOM uses Svelte text bindings and safe links',()=>{assert.match(renderer,/rel="noopener noreferrer"/);assert.doesNotMatch(renderer,/{@html|innerHTML/);assert.match(renderer,/\{segment\.text\}/);});
test('G54-A02 composer preserves multiline and IME submit',()=>{assert.match(composer,/textarea/);assert.match(composer,/!event\.shiftKey && !event\.isComposing/);assert.match(composer,/sr-only/);});
