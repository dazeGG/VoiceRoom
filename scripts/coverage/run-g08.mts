#!/usr/bin/env node
// `npm run coverage:g08`: run the shared and API suites under V8 coverage, then
// collect and check the G08 summary. A script instead of an npm one-liner so
// the environment variables work in cmd.exe too (npm runs scripts there on
// Windows, where `VAR=x cmd` is not valid syntax).

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

const V8_DIR = 'coverage/.release-250-v8';
const SUMMARY = 'coverage/release-250-summary.json';

function run(args: string[], env: NodeJS.ProcessEnv = process.env): void {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

rmSync(V8_DIR, { recursive: true, force: true });
mkdirSync(V8_DIR, { recursive: true });

run(
  ['--test', '--test-concurrency=1', 'scripts/test/g08-coverage-gate.test.mts', 'packages/shared/test/*.test.ts', 'apps/api/test/*.test.ts'],
  { ...process.env, G08_V8_DIR: V8_DIR, NODE_V8_COVERAGE: V8_DIR }
);
run(['scripts/coverage/check-release-250-coverage.mts', '--v8-dir', V8_DIR, '--out', SUMMARY, '--collect-only']);
run(['scripts/coverage/check-release-250-coverage.mts', '--coverage', SUMMARY, '--base-thresholds-absent']);
