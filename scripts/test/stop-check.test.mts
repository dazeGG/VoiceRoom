import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../claude/stop-check.mts', import.meta.url));

// A throwaway repository with no package.json: whenever the hook decides to run
// `npm run check`, the check fails and the hook exits 2.
function repo(t: TestContext): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-stop-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '-q');
  fs.mkdirSync(path.join(root, 'scripts', 'load'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'load', 'run.sh'), 'echo one\n');
  fs.writeFileSync(path.join(root, 'scripts', 'tool.mts'), 'export {};\n');
  git('add', '.');
  git('-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'init');
  return root;
}

function stop(root: string, input: object = {}): number | null {
  return spawnSync(process.execPath, [HOOK], { cwd: root, input: JSON.stringify(input), encoding: 'utf8' }).status;
}

test('a clean tree lets the agent stop', (t) => {
  assert.equal(stop(repo(t)), 0);
});

test('shell, YAML and Markdown edits skip the check', (t) => {
  const root = repo(t);
  fs.writeFileSync(path.join(root, 'scripts', 'load', 'run.sh'), 'echo two\n');
  fs.writeFileSync(path.join(root, 'scripts', 'load', 'compose.yml'), 'services: {}\n');
  fs.writeFileSync(path.join(root, 'scripts', 'load', 'NOTES.md'), '# notes\n');
  assert.equal(stop(root), 0);
});

test('a modified code file runs the check', (t) => {
  const root = repo(t);
  fs.writeFileSync(path.join(root, 'scripts', 'tool.mts'), 'export const x = 1;\n');
  assert.equal(stop(root), 2);
});

test('an untracked code file in a new directory runs the check', (t) => {
  const root = repo(t);
  fs.mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'web', 'App.svelte'), '<p>hi</p>\n');
  assert.equal(stop(root), 2);
});

test('a second stop in a row is let through', (t) => {
  const root = repo(t);
  fs.writeFileSync(path.join(root, 'scripts', 'tool.mts'), 'export const x = 1;\n');
  assert.equal(stop(root, { stop_hook_active: true }), 0);
});
