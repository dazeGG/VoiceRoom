import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { validateRelease } from '../cd/validate-release.mts';

test('release validation uses the component manifest and first-parent history of main', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'voice-release-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Release Test');
  git('config', 'user.email', 'release-test@example.test');
  mkdirSync(join(directory, 'apps/web'), { recursive: true });
  mkdirSync(join(directory, 'apps/api'), { recursive: true });
  writeFileSync(join(directory, 'apps/web/package.json'), '{"version":"1.0.1"}');
  writeFileSync(join(directory, 'apps/api/package.json'), '{"version":"1.0.0"}');
  git('add', '.');
  git('commit', '-qm', 'chore: initialize versions');
  const initial = git('rev-parse', 'HEAD');
  git('switch', '-qc', 'release/web-1.0.1');
  git('commit', '--allow-empty', '-qm', 'fix(web): stabilize release');
  const branchCommit = git('rev-parse', 'HEAD');
  git('switch', '-q', 'main');
  git('merge', '--no-ff', '-qm', 'Merge release', 'release/web-1.0.1');
  const releaseCommit = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', releaseCommit);

  assert.equal(validateRelease(directory, 'web', 'web/v1.0.1', releaseCommit), '1.0.1');
  assert.equal(validateRelease(directory, 'api', 'api/v1.0.0', releaseCommit), '1.0.0');
  assert.throws(() => validateRelease(directory, 'api', 'api/v1.0.1', releaseCommit), /does not match/);
  assert.throws(() => validateRelease(directory, 'api', 'web/v1.0.1', releaseCommit), /invalid/i);
  assert.throws(() => validateRelease(directory, 'web', 'v2.15.0', releaseCommit), /invalid/i);
  assert.throws(() => validateRelease(directory, 'web', 'web/v1.00.1', releaseCommit), /invalid/i);
  assert.throws(() => validateRelease(directory, 'web', 'web/v1.0.1', initial), /checked out/);

  git('checkout', '-q', '--detach', initial);
  assert.equal(validateRelease(directory, 'web', 'web/v1.0.1', initial), '1.0.1');
  git('checkout', '-q', '--detach', branchCommit);
  assert.throws(() => validateRelease(directory, 'web', 'web/v1.0.1', branchCommit), /first-parent/);
});
