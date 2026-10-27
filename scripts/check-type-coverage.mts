#!/usr/bin/env node
// Type check run by `npm run check`: every identifier in the repository's
// TypeScript files has a type other than `any` (type-coverage --strict at
// 100%), and no file opts out with a type-coverage:ignore comment. Each area
// is measured from inside its own folder against its own tsconfig:
// type-coverage counts only the files under the folder it runs in, and the
// web's `$lib` alias resolves correctly only that way. `.svelte` and `.vue`
// files are not part of a TypeScript program; ESLint's no-unsafe-* rules,
// svelte-check and vue-tsc cover them. Exits 1 and lists every untyped spot
// as `file:line:column name`.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const typeCoverage = resolve(root, 'node_modules/type-coverage/bin/type-coverage');
// Each run builds a whole TypeScript program; three at a time keep memory in check.
const PARALLEL = 3;
const OPT_OUT = 'type-coverage:ignore';

const AREAS: ReadonlyArray<{ folder: string; project: string; ignore?: readonly string[] }> = [
  // Applied migrations are byte-pinned CommonJS; the ES-module ones are measured.
  { folder: 'apps/api/src', project: '../tsconfig.json', ignore: ['migrations/**/*.cjs'] },
  { folder: 'apps/api/test', project: '../tsconfig.json' },
  { folder: 'apps/web/src', project: '../tsconfig.test.json' },
  { folder: 'apps/web/test', project: '../tsconfig.test.json' },
  { folder: 'apps/web/e2e', project: '../tsconfig.test.json' },
  { folder: 'apps/web/scripts', project: '../tsconfig.test.json' },
  // The web's own config files (vite, playwright); the folders above are measured on their own.
  {
    folder: 'apps/web',
    project: 'tsconfig.test.json',
    ignore: ['src/**', 'test/**', 'e2e/**', 'scripts/**', '*.js']
  },
  // The Vue web (apps/web-vue) until it replaces apps/web: the same areas.
  { folder: 'apps/web-vue/src', project: '../tsconfig.test.json' },
  { folder: 'apps/web-vue/test', project: '../tsconfig.test.json' },
  { folder: 'apps/web-vue/scripts', project: '../tsconfig.test.json' },
  {
    folder: 'apps/web-vue',
    project: 'tsconfig.test.json',
    ignore: ['src/**', 'test/**', 'scripts/**', 'public/**']
  },
  // The admin app (React): its source, its tests and its vite config.
  { folder: 'apps/admin/src', project: '../tsconfig.json' },
  { folder: 'apps/admin/test', project: '../tsconfig.json' },
  { folder: 'apps/admin', project: 'tsconfig.json', ignore: ['src/**', 'test/**'] },
  // The emoji corpus is byte-pinned (G07) and stays as it is.
  { folder: 'packages/shared/src', project: '../tsconfig.test.json', ignore: ['emoji.ts'] },
  { folder: 'packages/shared/test', project: '../tsconfig.test.json' },
  { folder: 'scripts', project: 'tsconfig.json' }
];

type Area = (typeof AREAS)[number];

function run(command: string, args: string[], cwd: string): Promise<{ code: number | null; output: string }> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', fail);
    child.on('close', (code) => done({ code, output }));
  });
}

async function measure({ folder, project, ignore = [] }: Area): Promise<{ ok: boolean; report: string }> {
  const cwd = resolve(root, folder);
  // A renamed folder must not drop out of the gate unnoticed.
  if (!existsSync(cwd)) return { ok: false, report: `${folder}: missing; update AREAS in this script` };
  const args = [typeCoverage, '-p', project, '--strict', '--detail', '--at-least', '100'];
  for (const pattern of ignore) args.push('--ignore-files', pattern);
  const { code, output } = await run(process.execPath, args, cwd);
  const summary = /\((\d+) \/ (\d+)\) ([\d.]+)%/.exec(output)?.[0] ?? 'no result';
  const spots = output
    .split('\n')
    .filter((line) => /:\d+:\d+: /.test(line))
    .map((line) => `  ${line.trim()}`);
  return { ok: code === 0, report: [`${folder}: ${summary}`, ...spots].join('\n') };
}

// An ignore comment would be a cast nobody reviews, like an inline eslint-disable.
async function optOuts(): Promise<{ ok: boolean; report: string }> {
  const { code, output } = await run(
    'git',
    ['grep', '-n', OPT_OUT, '--', '*.ts', '*.mts', '*.tsx', '*.svelte', '*.vue'],
    root
  );
  const lines = output
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('scripts/check-type-coverage.mts:'));
  if (code !== 0 && code !== 1) return { ok: false, report: `git grep failed: ${output.trim()}` };
  if (lines.length === 0) return { ok: true, report: `no ${OPT_OUT} comments` };
  return {
    ok: false,
    report: [`${OPT_OUT} comments are not allowed:`, ...lines.map((line) => `  ${line}`)].join('\n')
  };
}

const queue = [...AREAS];
const results: Array<{ ok: boolean; report: string }> = [await optOuts()];
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    for (let area = queue.shift(); area; area = queue.shift()) results.push(await measure(area));
  })
);
for (const { ok, report } of results) (ok ? console.log : console.error)(report);
process.exit(results.every(({ ok }) => ok) ? 0 : 1);
