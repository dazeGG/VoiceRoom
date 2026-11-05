// How long the edge lets a browser keep each kind of file. A file with "no-cache"
// costs a round trip on every use even when it has not changed, and joining a
// call used to pay that for each audio file, one after another.

import assert from 'node:assert/strict';
import { brotliCompressSync } from 'node:zlib';
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

test(
  'a file the build compressed ahead is sent that way; one it did not is compressed on the fly',
  { skip: !dockerAvailable, timeout: 60_000 },
  async () => {
    const script = 'console.log("the app");'.repeat(200);
    const edge = await startCaddyEdge({
      files: {
        'app.js': script,
        'other.js': script
      },
      // Not what the app holds: only the file written ahead can have answered with this.
      binaryFiles: { 'app.js.br': brotliCompressSync('written ahead') }
    });

    const ahead = await fetch(`${edge}/app.js`, { headers: { 'accept-encoding': 'br' } });
    assert.equal(ahead.headers.get('content-encoding'), 'br');
    assert.match(String(ahead.headers.get('content-type')), /javascript/);
    assert.equal(await ahead.text(), 'written ahead');

    const fly = await fetch(`${edge}/other.js`, { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(fly.headers.get('content-encoding'), 'gzip');
    assert.equal(await fly.text(), script);
  }
);
