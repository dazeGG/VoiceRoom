'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
for (const relative of [
  'apps/api/src/migrations/20260718120000_add_push_subscription_platform_class.js',
  'apps/api/src/migrations/20260718140000_create_message_attachments_and_media_jobs.js'
]) {
  test(`${relative} remains byte-for-byte identical to da2ffb3`, () => {
    const historical = spawnSync('git', ['-C', ROOT, 'show', `da2ffb3:${relative}`], { encoding: null, maxBuffer: 1024 * 1024 });
    assert.equal(historical.status, 0, historical.stderr?.toString());
    assert.deepEqual(fs.readFileSync(path.join(ROOT, relative)), historical.stdout);
  });
}
