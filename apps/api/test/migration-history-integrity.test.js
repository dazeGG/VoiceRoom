'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const EXPECTED = require('./fixtures/historical-migration-sha256.json');
for (const [relative, expected] of Object.entries(EXPECTED)) {
  test(`${relative} retains its committed historical byte digest`, () => {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative))).digest('hex');
    assert.equal(actual, expected);
  });
}
