import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

test('widget deployment compatibility and ERR ordering regressions', { skip: process.platform !== 'linux' }, () => {
  // Linux deploy/CI requires Python and Bash, as remote-deploy itself does.
  const result = spawnSync('python3', [path.join(import.meta.dirname, 'widget-boundary-preflight.py')], {
    encoding: 'utf8'
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 20 tests/);
});
