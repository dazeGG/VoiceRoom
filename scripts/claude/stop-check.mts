#!/usr/bin/env node
// Claude Code Stop hook: when the working tree has uncommitted changes under
// apps/, packages/ or scripts/, run `npm run check` before the agent may stop.
// A failure is written to stderr with exit code 2, which Claude Code feeds back
// to the agent. The second stop in a row (stop_hook_active) is let through so
// a check the agent cannot fix never traps it in a loop.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

interface StopInput {
  stop_hook_active?: boolean;
}

function readInput(): StopInput {
  try {
    return JSON.parse(readFileSync(0, 'utf8')) as StopInput;
  } catch {
    return {};
  }
}

const input = readInput();
if (input.stop_hook_active) process.exit(0);

const changed = execFileSync('git', ['status', '--porcelain', '--', 'apps', 'packages', 'scripts'], {
  encoding: 'utf8'
}).trim();
if (!changed) process.exit(0);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['run', 'check', '--silent'], { encoding: 'utf8', shell: process.platform === 'win32' });
if (result.status === 0) process.exit(0);

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n').slice(-40).join('\n');
process.stderr.write(`npm run check failed on the uncommitted changes:\n${output}\n`);
process.exit(2);
