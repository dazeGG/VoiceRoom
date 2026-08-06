import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { validateWorkflowRef } from '../release/validate-workflow-ref.mjs';

const cases = [
  ['release-candidate-preflight.yml', 'refs/heads/release/2.5.0'],
  ['release-entry.yml', 'refs/heads/develop']
];

test('release gates run an explicit ref validator instead of skipping the only job', () => {
  for (const [file, expected] of cases) {
    const source = fs.readFileSync(path.join(process.cwd(), '.github', 'workflows', file), 'utf8');
    assert.doesNotMatch(source, /^\s+if:\s*github\.ref/m);
    const checkout = source.indexOf('uses: actions/checkout@v4');
    const validation = source.indexOf(`node scripts/release/validate-workflow-ref.mjs --expected ${expected}`);
    const setup = source.indexOf('uses: actions/setup-node@v4');
    assert.ok(checkout >= 0 && validation > checkout && validation < setup);
  }
});

test('ref validator exits nonzero for missing or wrong refs and accepts only the exact branch', () => {
  assert.equal(validateWorkflowRef('refs/heads/develop', 'refs/heads/develop'), true);
  assert.throws(() => validateWorkflowRef('refs/heads/main', 'refs/heads/develop'), /requires/);
  const script = path.join(process.cwd(), 'scripts', 'release', 'validate-workflow-ref.mjs');
  for (const [actual, status] of [['refs/heads/release/2.5.0', 0], ['refs/heads/main', 1], ['', 1]]) {
    const result = spawnSync(process.execPath, [script, '--expected', 'refs/heads/release/2.5.0'], { env: { ...process.env, GITHUB_REF: actual }, encoding: 'utf8' });
    assert.equal(result.status, status);
  }
});
