// How long the edge lets a browser keep each kind of file. A file with "no-cache"
// costs a round trip on every use even when it has not changed, and joining a
// call used to pay that for each audio file, one after another.

import assert from 'node:assert/strict';
import { test } from 'vitest';
import { dockerAvailable, startCaddyEdge } from './helpers/caddy-edge.ts';

const YEAR = 'public, max-age=31536000, immutable';

test(
  'an address that changes with its content is kept for a year, and the page itself is always asked about',
  { skip: !dockerAvailable, timeout: 60_000 },
  async () => {
    const origin = await startCaddyEdge({
      files: {
        '_app/version.json': '{}',
        'audio-gate.worklet.js': '// gate',
        'desktop-audio-source.worklet.js': '// source',
        'rnnoise/rnnoise.wasm': 'wasm',
        'emoji/1F600.svg': '<svg/>',
        'voiceroom-icon.svg': '<svg/>'
      }
    });
    const cacheOf = async (path: string) => {
      const response = await fetch(`${origin}${path}`);
      assert.equal(response.status, 200, path);
      return response.headers.get('cache-control');
    };

    // Named or versioned by content: the next release asks for another address.
    assert.equal(await cacheOf('/rnnoise/rnnoise.wasm?v=abc'), YEAR);
    assert.equal(await cacheOf('/audio-gate.worklet.js?v=abc'), YEAR);
    assert.equal(await cacheOf('/desktop-audio-source.worklet.js?v=abc'), YEAR);

    // Without the version the same file may change under the same address.
    assert.equal(await cacheOf('/rnnoise/rnnoise.wasm'), 'no-cache');
    assert.equal(await cacheOf('/audio-gate.worklet.js'), 'no-cache');
    // A version does not make just anything permanent.
    assert.equal(await cacheOf('/voiceroom-icon.svg?v=abc'), 'no-cache');

    assert.equal(await cacheOf('/emoji/1F600.svg'), 'public, max-age=2592000');
    assert.equal(await cacheOf('/'), 'no-cache');
    assert.equal(await cacheOf('/r/room'), 'no-cache');
  }
);
