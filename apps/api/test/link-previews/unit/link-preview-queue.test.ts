import assert from 'node:assert/strict';
import test from 'node:test';
import { createLinkPreviewService } from '../../../src/domains/link-previews/link-preview.service.ts';

test('a queued preview starts only after the previous fetch finishes its disposal', { timeout: 5000 }, async (t) => {
  const releases = Array.from({ length: 3 }, () => Promise.withResolvers<void>());
  const twoStarted = Promise.withResolvers<void>();
  const thirdStarted = Promise.withResolvers<void>();
  const started: number[] = [];
  const disposed: number[] = [];
  let disposedAtThird: number[] = [];
  t.after(() => {
    for (const release of releases) release.resolve();
  });
  const service = createLinkPreviewService({
    repository: {
      getCached: async () => null,
      saveCached: async () => {},
      setRoomMessagePreview: async () => false,
      setDirectMessagePreview: async () => false,
      listReferencedImageKeys: async () => [],
      pruneExpired: async () => 0
    },
    storage: { save: async () => {} },
    processImage: async () => null,
    fetcher: {
      async fetchPage() {
        const index = started.length;
        started.push(index);
        if (index === 1) twoStarted.resolve();
        if (index === 2) {
          disposedAtThird = disposed.slice();
          thirdStarted.resolve();
        }
        try {
          await releases[index]?.promise;
          throw new Error('discarded response');
        } finally {
          disposed.push(index);
        }
      },
      fetchImage: async () => ({ body: Buffer.alloc(0) })
    }
  });
  const jobs = releases.map((_release, index) =>
    service.previewRoomMessage({ roomId: 'room', messageId: String(index), text: `https://site.test/${index}` })
  );
  try {
    await twoStarted.promise;
    assert.deepEqual(started, [0, 1]);
    releases[0]?.resolve();
    await thirdStarted.promise;
    assert.deepEqual(disposedAtThird, [0]);
  } finally {
    for (const release of releases) release.resolve();
    await Promise.all(jobs);
  }
  assert.deepEqual(started, [0, 1, 2]);
  assert.deepEqual(disposed.slice().sort(), [0, 1, 2]);
});
