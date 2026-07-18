import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');

async function loadDemandPolicy() {
  const path = 'src/lib/features/room/client/media/screen-receiver-demand.ts';
  const output = ts.transpileModule(readFileSync(resolve(root, path), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true
    },
    fileName: path
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

test('screen receiver demand is deterministic and stage wins over preview', async () => {
  const { getScreenReceiverDemand } = await loadDemandPolicy();
  const subscribed = new Set(['peer-a', 'peer-b']);

  assert.equal(getScreenReceiverDemand('', '', subscribed), 'hidden');
  assert.equal(getScreenReceiverDemand('peer-c', '', subscribed), 'hidden');
  assert.equal(getScreenReceiverDemand('peer-a', '', subscribed), 'preview');
  assert.equal(getScreenReceiverDemand('peer-a', 'peer-a', subscribed), 'stage');
  assert.equal(getScreenReceiverDemand('peer-b', 'peer-a', subscribed), 'preview');
});
