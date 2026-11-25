import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compareTestFiles } from '../ci/compare-test-files.mts';

test('reconciles runner outcomes through real Git renames, never grand totals', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'vr-test-moves-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const tree = () => {
    git('add', '-A');
    return git('write-tree');
  };
  const dir = 'apps/web/test';
  const a = dir + '/original.test.ts',
    b = dir + '/other.test.ts',
    c = dir + '/owned.test.ts';
  const row = (file: string) => ({
    file,
    tests: 2,
    passed: 1,
    skipped: 1,
    project: 'node',
    environment: 'node',
    fixture: 'unit'
  });
  git('init', '--quiet');
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, a), 'original behaviour\n');
  writeFileSync(join(root, b), 'another behaviour\n');
  const base = tree();
  const before = { tree: base, files: [row(a), row(b)] };
  renameSync(join(root, a), join(root, c));
  const tested = tree();
  const after = { tree: tested, files: [row(c), row(b)] };
  const check = (files: typeof after.files) => compareTestFiles(before, { ...after, files }, base, tested, root);
  assert.deepEqual(check(after.files), { files: 2, moved: 1, unchanged: 1, tests: 4, passed: 2, skipped: 2 });
  assert.throws(() => check([row(c), row(c)]), /Duplicate runner file/);
  assert.throws(() => check([row(c)]), /tracked test files/);
  assert.throws(
    () =>
      check([
        { ...row(c), passed: 2, skipped: 0 },
        { ...row(b), passed: 0, skipped: 2 }
      ]),
    /Runner drift/
  );
  for (const property of ['fixture', 'project', 'environment'])
    assert.throws(() => check([{ ...row(c), [property]: 'other' }, row(b)]), /Runner drift/);
  // The result still reports the same number of files and green cases, but
  // the original file was deleted and the other test copied in its place.
  writeFileSync(join(root, c), 'another behaviour\n');
  const replaced = tree();
  assert.throws(() => compareTestFiles(before, { ...after, tree: replaced }, base, replaced, root), /Unresolved move/);
});
