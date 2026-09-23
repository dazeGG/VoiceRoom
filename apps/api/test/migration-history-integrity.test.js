import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../../..');
import EXPECTED from './fixtures/historical-migration-sha256.json' with { type: 'json' };
for (const [relative, expected] of Object.entries(EXPECTED)) {
  test(`${relative} retains its committed historical byte digest`, () => {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative))).digest('hex');
    assert.equal(actual, expected);
  });
}
