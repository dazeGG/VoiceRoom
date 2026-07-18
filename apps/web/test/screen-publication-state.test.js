import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');

async function loadPublicationState() {
  const path = 'src/lib/features/room/client/media/screen-publication-state.ts';
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

test('screen activity survives video republish while screen audio remains published', async () => {
  const { getScreenPublicationPresence } = await loadPublicationState();
  const video = { kind: 'video', sid: 'video-1' };
  const audio = { kind: 'audio', sid: 'audio-1' };
  const isVideo = (publication) => publication.kind === 'video';
  const isAudio = (publication) => publication.kind === 'audio';

  assert.deepEqual(
    getScreenPublicationPresence([video, audio], isVideo, isAudio),
    { active: true, hasAudio: true, hasVideo: true }
  );
  assert.deepEqual(
    getScreenPublicationPresence([audio], isVideo, isAudio),
    { active: true, hasAudio: true, hasVideo: false }
  );
  assert.deepEqual(
    getScreenPublicationPresence([audio, { kind: 'video', sid: 'video-2' }], isVideo, isAudio),
    { active: true, hasAudio: true, hasVideo: true }
  );
  assert.deepEqual(
    getScreenPublicationPresence([], isVideo, isAudio),
    { active: false, hasAudio: false, hasVideo: false }
  );
});
