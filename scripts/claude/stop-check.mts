#!/usr/bin/env node
// Claude Code Stop hook: when the working tree has uncommitted changes to files
// that `npm run check` reads (code and JSON configs) under apps/, packages/ or
// scripts/, run it before the agent may stop. Shell, YAML and Markdown edits
// skip the ~2.5 minute check, since nothing in it looks at them. A tree that
// already passed is not checked again: uncommitted work would otherwise cost the
// full check on every reply, even one that changed nothing.
// A failure is written to stderr with exit code 2, which Claude Code feeds back
// to the agent. The second stop in a row (stop_hook_active) is let through so
// a check the agent cannot fix never traps it in a loop.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isRecord } from '../../packages/shared/src/guards.ts';

interface StopInput {
  stop_hook_active?: boolean;
}

function readInput(): StopInput {
  try {
    const input: unknown = JSON.parse(readFileSync(0, 'utf8'));
    return isRecord(input) ? { stop_hook_active: Boolean(input.stop_hook_active) } : {};
  } catch {
    return {};
  }
}

const input = readInput();
if (input.stop_hook_active) process.exit(0);

const CHECKED = /\.(?:[cm]?[jt]s|vue|s?css|json)$/;
const SCOPE = /^(?:apps|packages|scripts)\//;

function git(args: string[]): string[] {
  return execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean);
}

const changed = [
  ...git(['diff', '--name-only', '--no-renames', '-z', 'HEAD']),
  ...git(['ls-files', '--others', '--exclude-standard', '-z'])
]
  .filter((file) => CHECKED.test(file))
  .sort();
if (!changed.some((file) => SCOPE.test(file))) process.exit(0);

// Root configs count too: they are outside the trigger scope, but they change the verdict.
function fingerprint(): string {
  const hash = createHash('sha256').update(git(['rev-parse', 'HEAD']).join());
  for (const file of changed) {
    hash.update(`\0${file}\0`);
    try {
      hash.update(readFileSync(file));
    } catch {
      hash.update('deleted');
    }
  }
  return hash.digest('hex');
}

function readPassed(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

// Inside .git: per worktree, and never shows up as a change of its own.
const passedPath = join(git(['rev-parse', '--absolute-git-dir']).join().trim(), 'claude-stop-check-passed');
// Taken before the check, so an edit made while it runs is checked on the next stop.
const current = fingerprint();
if (readPassed(passedPath) === current) process.exit(0);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['run', 'check', '--silent'], { encoding: 'utf8', shell: process.platform === 'win32' });
if (result.status === 0) {
  writeFileSync(passedPath, current);
  process.exit(0);
}

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n').slice(-40).join('\n');
process.stderr.write(`npm run check failed on the uncommitted changes:\n${output}\n`);
process.exit(2);
