import { test } from 'vitest';
import assert from 'node:assert/strict';


async function loadPublicationState() {
  return import('../src/lib/features/room/client/media/screen-publication-state.ts');
}

test('screen activity survives video republish while screen audio remains published', async () => {
  const { getScreenPublicationPresence } = await loadPublicationState();
  const video = { kind: 'video', sid: 'video-1' };
  const audio = { kind: 'audio', sid: 'audio-1' };
  const isVideo = (publication: { kind: string }) => publication.kind === 'video';
  const isAudio = (publication: { kind: string }) => publication.kind === 'audio';

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
