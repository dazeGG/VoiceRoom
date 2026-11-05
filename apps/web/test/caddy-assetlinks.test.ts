import assert from 'node:assert/strict';
import { test } from 'vitest';
import { dockerAvailable, startCaddyEdge } from './helpers/caddy-edge.ts';

// The React Native debug keystore's fingerprint, the one the dev stand publishes.
const fingerprint = 'FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C';

test(
  'AC16 a well-formed fingerprint publishes the App Links statement for voiceroom.app',
  { skip: !dockerAvailable, timeout: 60_000 },
  async () => {
    const origin = await startCaddyEdge({ env: { ANDROID_RELEASE_CERT_SHA256: fingerprint } });
    const response = await fetch(`${origin}/.well-known/assetlinks.json`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.deepEqual(await response.json(), [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'voiceroom.app',
          sha256_cert_fingerprints: [fingerprint]
        }
      }
    ]);
  }
);

test(
  'AC16 an empty or malformed fingerprint answers 404, never the web page',
  { skip: !dockerAvailable, timeout: 60_000 },
  async () => {
    for (const value of ['', 'ab:cd']) {
      const origin = await startCaddyEdge({ env: { ANDROID_RELEASE_CERT_SHA256: value } });
      const response = await fetch(`${origin}/.well-known/assetlinks.json`);
      const body = await response.text();
      assert.equal(response.status, 404, `value ${JSON.stringify(value)}`);
      assert.doesNotMatch(body, /<html/i);
    }
  }
);
