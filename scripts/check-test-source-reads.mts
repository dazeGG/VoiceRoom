#!/usr/bin/env node
// Ratchet for tests that read source code instead of exercising it
// (CLAUDE.md "Tests"). Counts, per test tree, string literals that point at a
// code file under src/ on a line that reads a file. Migrations, JSON
// data and deployment config are allowed. The count may only go down: a tree
// above its baseline fails; `--update` lowers the baseline after a cleanup.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const BASELINE_PATH = resolve(repoRoot, 'config/test-source-reads.json');
const TREES = ['apps/api/test', 'apps/web/test', 'packages/shared/test', 'scripts/test'];

const CODE_PATH = /(['"`])([^'"`\n]*\bsrc\/[^'"`\n]*\.(?:ts|mts|svelte|js|mjs))\1/g;
// Only literals on a line that reads a file count; loading a module is fine.
const READ_CALL = /\b(?:readFileSync|readFile|read[A-Z]\w*|read)\s*\(/;

function testFiles(path: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(path)) {
    const absolute = resolve(path, entry);
    if (statSync(absolute).isDirectory()) files.push(...testFiles(absolute));
    else if (/\.(?:ts|mts|js|mjs)$/.test(entry)) files.push(absolute);
  }
  return files;
}

function sourceReads(tree: string): string[] {
  const found: string[] = [];
  for (const file of testFiles(resolve(repoRoot, tree))) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const match of line.matchAll(CODE_PATH)) {
        const target = match[2] ?? '';
        if (target.includes('/migrations/')) continue;
        if (!READ_CALL.test(line) || line.includes('import(')) continue;
        found.push(`${relative(repoRoot, file).split('\\').join('/')}:${index + 1} ${target}`);
      }
    });
  }
  return found;
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Record<string, number>;
const update = process.argv.includes('--update');
const verbose = process.argv.includes('--list');
let failed = false;

for (const tree of TREES) {
  const reads = sourceReads(tree);
  const allowed = baseline[tree] ?? 0;
  if (verbose) for (const entry of reads) process.stdout.write(`${entry}\n`);
  if (reads.length > allowed) {
    failed = true;
    process.stderr.write(`${tree}: ${reads.length} source reads, baseline ${allowed}. Test behaviour instead of source text:\n${reads.join('\n')}\n`);
  } else if (update) {
    baseline[tree] = reads.length;
  }
}

if (update) writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
if (failed) process.exit(1);
