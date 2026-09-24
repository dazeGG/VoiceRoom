import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import { test } from 'vitest';
const renderer=readFileSync(`${import.meta.dirname}/../src/lib/shared/chat/StructuredMessageContent.svelte`,'utf8');const composer=readFileSync(`${import.meta.dirname}/../src/lib/shared/chat/StructuredMessageComposer.svelte`,'utf8');
test('G54-A01 structured DOM uses Svelte text bindings and safe links',()=>{assert.match(renderer,/rel="noopener noreferrer"/);assert.doesNotMatch(renderer,/{@html|innerHTML/);assert.match(renderer,/<EmojiText text=\{segment\.text\} \/>/);});
test('G54-A02 composer preserves multiline and IME submit',()=>{assert.match(composer,/textarea/);assert.match(composer,/!event\.shiftKey && !event\.isComposing/);assert.match(composer,/sr-only/);});
