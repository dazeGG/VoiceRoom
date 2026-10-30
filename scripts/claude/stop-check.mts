#!/usr/bin/env node
// Claude Code Stop hook: when the working tree has uncommitted changes to files
// that `npm run check` reads (code and JSON configs) under apps/, packages/ or
// scripts/, run it before the agent may stop. Shell, YAML and Markdown edits
// skip the ~1 minute check, since nothing in it looks at them.
// A failure is written to stderr with exit code 2, which Claude Code feeds back
// to the agent. The second stop in a row (stop_hook_active) is let through so
// a check the agent cannot fix never traps it in a loop.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
const SCOPE = ['--', 'apps', 'packages', 'scripts'];

function git(args: string[]): string[] {
  return execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean);
}

const changed = [
  ...git(['diff', '--name-only', '--no-renames', '-z', 'HEAD', ...SCOPE]),
  ...git(['ls-files', '--others', '--exclude-standard', '-z', ...SCOPE])
];
if (!changed.some((file) => CHECKED.test(file))) process.exit(0);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['run', 'check', '--silent'], { encoding: 'utf8', shell: process.platform === 'win32' });
if (result.status === 0) process.exit(0);

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n').slice(-40).join('\n');
process.stderr.write(`npm run check failed on the uncommitted changes:\n${output}\n`);
process.exit(2);
