import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { collectV8Coverage } from '../coverage/check-release-250-coverage.mts';

const helper = fileURLToPath(new URL('../coverage/g08-inputs.mts', import.meta.url));
const evaluator = fileURLToPath(new URL('../coverage/check-release-250-coverage.mts', import.meta.url));
const source = 'src/feature.mjs';
const config = 'config/coverage/release-250-thresholds.json';
const summary = 'coverage/release-250-summary.json';
const files = 'coverage/release-250-changed-files.txt';
const patch = 'coverage/release-250-changed.diff';
const protectedPolicy = 'coverage/release-250-base-thresholds.json';
const policy = {
  schemaVersion: 1,
  release: '2.5.0',
  branchMetric: 'node-v8-branch',
  businessPathPatterns: ['src/'],
  ignoredPathPatterns: [],
  strictBranchGroups: [],
  strictBranchMinimum: 95,
  changedBusinessCode: { line: 90, branch: 85 },
  baseline: { artifact: summary, measuredAt: '2026-01-01', total: { lines: 0, branches: 0 } },
  baselinePolicy: { initialAdoption: { baseConfigAbsent: true, reason: 'First adoption in fixture' } }
};
const covered = [1, 2, 3, 4].map((i) => `export const v${i} = ${i};\n`).join('');
const uncovered = 'export function uncalled() { return 42; }\n';

function repository(t: TestContext) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'g08-inputs-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-b', 'base');
  git('config', 'user.email', 'g08@example.invalid');
  git('config', 'user.name', 'G08 Fixture');
  git('config', 'commit.gpgSign', 'false');
  git('config', 'core.autocrlf', 'false');
  const write = (name: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true });
    fs.writeFileSync(path.join(cwd, name), content);
  };
  const read = (name: string) => fs.readFileSync(path.join(cwd, name), 'utf8');
  const commit = (message: string) => {
    git('add', '-A');
    git('commit', '-m', message);
    return git('rev-parse', 'HEAD').trim();
  };
  const capture = (base: string, sha = git('rev-parse', 'HEAD').trim()) =>
    spawnSync(process.execPath, [helper, '--base', base, '--tested', 'HEAD', '--out', 'coverage'], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_SHA: sha,
        GITHUB_EVENT_NAME: 'pull_request'
      }
    });
  const measure = (module = source) => {
    const v8Dir = path.join(cwd, 'coverage/raw');
    execFileSync(process.execPath, [module], { cwd, env: { ...process.env, NODE_V8_COVERAGE: v8Dir } });
    const measured = collectV8Coverage({ v8Dir, thresholds: policy, root: cwd });
    write(summary, JSON.stringify(measured));
    return measured;
  };
  const verdict = (baselineArgs: string) =>
    spawnSync(
      process.execPath,
      [
        evaluator,
        '--coverage',
        summary,
        '--changed-files',
        files,
        '--changed-diff',
        patch,
        ...baselineArgs.trim().split(' ')
      ],
      { cwd, encoding: 'utf8' }
    );
  write(config, JSON.stringify(policy));
  return { cwd, git, read, write, commit, capture, measure, verdict };
}

test('divergent base: G08 rejects the uncovered addition at the tested merge line', (t) => {
  const r = repository(t);
  r.write(source, covered);
  r.write('notes.md', 'old notes\n');
  r.commit('Common ancestor');
  r.git('switch', '-c', 'pr');
  r.write(source, covered + uncovered);
  const head = r.commit('Append uncovered function');
  r.git('switch', 'base');
  r.write(source, 'const a = 10;\nconst b = 20;\n' + covered);
  r.write('notes.md', 'protected notes\n');
  const base = r.commit('Insert two lines above PR and update notes');
  r.git('merge', '--no-ff', 'pr', '-m', 'Tested merge');
  const measured = r.measure().files[source];
  assert.deepEqual(
    measured?.details.lines.filter((line) => !line.covered),
    [{ line: 7, covered: false }]
  );

  // Replay the previous workflow against the *same* merge-tree measurement.
  r.write(protectedPolicy, r.git('show', `${base}:${config}`));
  r.write(files, r.git('diff', '--name-only', '--diff-filter=d', base, head));
  r.write(patch, r.git('diff', '--unified=0', base, head));
  assert.match(r.read(patch), /\+5 @@[^\n]*\n\+export function uncalled/);
  const old = r.verdict(`--base-thresholds ${protectedPolicy}`);
  assert.equal(old.status, 0, old.stderr);
  t.diagnostic('Old base-to-head patch: line 5 (covered in the merge), evaluator exits 0.');

  const inputs = r.capture(base);
  assert.equal(inputs.status, 0, inputs.stderr);
  const current = r.verdict(inputs.stdout);
  assert.equal(current.status, 1, 'The merge-line verdict must reject the uncovered addition');
  assert.match(current.stderr, /src\/feature\.mjs changed line coverage 0\.00% is below 90%/);
  assert.deepEqual(r.read(files).trim().split(/\r?\n/), [source]);
  assert.match(r.read(patch), /\+7 @@[^\n]*\n\+export function uncalled/);
  t.diagnostic(`Base-to-merge patch: line 7; evaluator exits 1: ${current.stderr.trim()}`);
});

test('rename-only and edited renames use destination paths; deletion has no destination', (t) => {
  const r = repository(t);
  const edited = 'src/feature name.mjs';
  const renamed = 'src/renamed.mjs';
  r.write('src/keep.mjs', 'export default true;\n');
  r.write('src/edit.mjs', covered);
  r.write('src/delete.mjs', 'export default false;\n');
  const base = r.commit('Original paths');
  r.git('mv', 'src/keep.mjs', renamed);
  r.git('mv', 'src/edit.mjs', edited);
  r.write(edited, covered + uncovered);
  r.git('rm', 'src/delete.mjs');
  r.commit('Rename two modules and delete another');
  const inputs = r.capture(base);
  assert.equal(inputs.status, 0, inputs.stderr);
  assert.deepEqual(r.read(files).trim().split(/\r?\n/).sort(), [edited, renamed]);
  assert.match(r.read(patch), /\+\+\+ b\/src\/feature name\.mjs\r?\n@@ [^\n]*\+5 @@/);
  r.measure(edited);
  const verdict = r.verdict(inputs.stdout);
  assert.equal(verdict.status, 1);
  assert.match(verdict.stderr, /src\/feature name\.mjs changed line coverage 0\.00%/);
});

test('a pure extension change cannot hide a newly eligible uncovered file', (t) => {
  const r = repository(t);
  r.write('src/feature.txt', uncovered);
  const base = r.commit('Non-code extension');
  r.git('mv', 'src/feature.txt', source);
  r.commit('Promote to a business module');
  const inputs = r.capture(base);
  assert.equal(inputs.status, 0, inputs.stderr);
  assert.equal(r.read(files).trim(), source);
  r.measure();
  const verdict = r.verdict(inputs.stdout);
  assert.equal(verdict.status, 1);
  assert.match(verdict.stderr, /src\/feature\.mjs changed line coverage 0\.00%/);
});

test('a comment-only hunk with no measurable statements passes despite uncovered existing code', (t) => {
  const r = repository(t);
  r.write(source, uncovered);
  const base = r.commit('Existing uncovered function');
  r.write(source, uncovered + '// An explanation, not a new statement.\n');
  r.commit('Document the function');
  const inputs = r.capture(base);
  assert.equal(inputs.status, 0, inputs.stderr);
  assert.equal(r.read(files).trim(), source);
  assert.deepEqual(r.measure().files[source]?.details.lines, [{ line: 1, covered: false }]);
  const verdict = r.verdict(inputs.stdout);
  assert.equal(verdict.status, 0, verdict.stderr);
});

test('lowering the checked-out policy cannot lower the protected threshold', (t) => {
  const r = repository(t);
  r.write(source, covered);
  const base = r.commit('Protected policy');
  r.write(config, JSON.stringify({ ...policy, changedBusinessCode: { line: 0, branch: 85 } }));
  r.commit('Attempt to reduce the patch requirement');
  const inputs = r.capture(base);
  assert.equal(inputs.status, 0, inputs.stderr);
  r.measure();
  const verdict = r.verdict(inputs.stdout);
  assert.equal(verdict.status, 1);
  assert.match(verdict.stderr, /changedBusinessCode.line may not decrease from protected base/);
});

test('only a verified base without the policy permits initial adoption', (t) => {
  const r = repository(t);
  fs.unlinkSync(path.join(r.cwd, config));
  r.write(source, covered);
  const base = r.commit('Base without policy');
  r.write(config, JSON.stringify(policy));
  r.commit('Adopt policy');
  r.write(protectedPolicy, 'stale result from a previous run');
  const inputs = r.capture(base);
  assert.equal(inputs.status, 0, inputs.stderr);
  assert.equal(fs.existsSync(path.join(r.cwd, protectedPolicy)), false);
  r.measure();
  const verdict = r.verdict(inputs.stdout);
  assert.equal(verdict.status, 0, verdict.stderr);
  assert.match(verdict.stdout, /explicit-initial-adoption/);
  assert.notEqual(r.capture('1'.repeat(40)).status, 0, 'An unresolvable base is not initial adoption');
  assert.notEqual(r.capture(base, base).status, 0, 'The PR SHA must match the tested checkout');
});

test('an initially missing base is fetched and supplies its policy and diff', (t) => {
  const remote = repository(t);
  remote.write('base.md', 'base only\n');
  const base = remote.commit('Remote protected base');
  const r = repository(t);
  r.write('new.md', 'tested only\n');
  r.commit('Local tested tree');
  r.git('remote', 'add', 'origin', remote.cwd);
  assert.throws(() => r.git('cat-file', '-e', base));
  const inputs = r.capture(base);
  assert.equal(inputs.status, 0, inputs.stderr);
  assert.equal(r.read(files).trim(), 'new.md');
  assert.deepEqual(JSON.parse(r.read(protectedPolicy)), policy);
});
