import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { finished } from 'node:stream/promises';
import { run } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { requireTestDatabase } from '../../apps/api/test/require-test-database-url.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const API = 'apps/api/test';
type Fixture = 'unit' | 'integration';

export function apiFiles(root = ROOT): string[] {
  return readdirSync(join(root, API), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.ts'))
    .map(({ parentPath, name }) => relative(root, join(parentPath, name)).split(sep).join('/'))
    .sort();
}

function checkedFiles(list: unknown, full: string[]): string[] {
  if (!Value.Check(Type.Array(Type.String(), { minItems: 1, uniqueItems: true }), list))
    throw new Error('Expected a non-empty list of unique API test files');
  const known = new Set(full);
  for (const file of list) if (!known.has(file)) throw new Error(`Unknown API test file: ${file}`);
  return list.toSorted();
}

export function apiLanes(root = ROOT): Record<Fixture, string[]> {
  const full = apiFiles(root);
  const unit = checkedFiles(JSON.parse(readFileSync(join(root, API, 'no-db-files.json'), 'utf8')), full);
  const accepted = new Set(unit);
  return { unit, integration: full.filter((file) => !accepted.has(file)) };
}

const FileResult = Type.Object({
  success: Type.Boolean(),
  passed: Type.Integer({ minimum: 0 }),
  failed: Type.Integer({ minimum: 0 }),
  skipped: Type.Integer({ minimum: 0 }),
  dbAttempt: Type.Boolean(),
  observed: Type.Boolean(),
  cases: Type.Array(Type.String())
});
const Report = Type.Record(Type.String(), FileResult);
type Report = Static<typeof Report>;

export async function fixtureReport(files: string[], root = ROOT): Promise<Report> {
  if (process.env.TEST_DATABASE_URL) await requireTestDatabase();
  else if (process.env.DATABASE_URL) throw new Error('Unset DATABASE_URL for the no-DB proof');

  const dir = mkdtempSync(join(tmpdir(), 'vr-api-proof-'));
  const results: Report = {};
  for (const file of files)
    results[file] = { success: false, passed: 0, failed: 0, skipped: 0, dbAttempt: false, observed: false, cases: [] };
  const failed = new Set<string>();
  process.env.API_PROOF_DIR = dir;
  try {
    const stream = run({
      files,
      cwd: root,
      concurrency: 4,
      execArgv: ['--import', new URL('./observe-test-postgres.mts', import.meta.url).href]
    });
    const key = (path: string | undefined) => (path ? relative(root, resolve(root, path)).split(sep).join('/') : '');
    stream.on('test:summary', ({ file, counts, success }) => {
      const item = results[key(file)];
      if (!item) return;
      item.success = success;
      item.passed = counts.passed;
      item.skipped = counts.skipped + counts.todo;
      item.failed = counts.tests - counts.passed - item.skipped;
    });
    stream.on('test:pass', ({ file, name, nesting, details }) => {
      if (details.type !== 'suite') results[key(file)]?.cases.push(`${nesting}:${name}`);
    });
    stream.on('test:fail', ({ file }) => failed.add(key(file)));
    // A crashed or empty worker has no affirmative per-file summary.
    await finished(stream.resume());
    for (const [file, item] of Object.entries(results)) {
      if (failed.has(file)) item.success = false;
      item.cases.sort();
      const marker = join(dir, file);
      item.observed = existsSync(marker);
      item.dbAttempt = item.observed && readFileSync(marker, 'utf8') !== '';
    }
    return results;
  } finally {
    delete process.env.API_PROOF_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
}

export function compareFixtures(db: Report, isolated: Report) {
  const files = Object.keys(db).sort();
  if (!files.length || !isDeepStrictEqual(files, Object.keys(isolated).sort()))
    throw new Error('Fixture reports must contain the same non-empty candidate set');
  const accepted: string[] = [];
  const rejected: Record<string, string[]> = {};
  for (const file of files) {
    const real = db[file];
    const noDb = isolated[file];
    if (!real || !noDb) throw new Error(`Incomplete fixture reports for ${file}`);
    const reasons: string[] = [];
    for (const [fixture, result] of [
      ['db', real],
      ['no-db', noDb]
    ] as const) {
      if (!result.observed) reasons.push(`${fixture}: no worker observation`);
      if (result.dbAttempt) reasons.push(`${fixture}: attempted PostgreSQL connection`);
      if (!result.success || result.failed) reasons.push(`${fixture}: failure or incomplete run`);
      if (result.skipped) reasons.push(`${fixture}: skipped/todo cases`);
      if (!result.passed || result.cases.length !== result.passed) reasons.push(`${fixture}: incomplete case evidence`);
    }
    if (real.passed !== noDb.passed || !isDeepStrictEqual(real.cases, noDb.cases))
      reasons.push('different case inventory');
    if (reasons.length) rejected[file] = reasons;
    else accepted.push(file);
  }
  return { accepted, rejected };
}

function readReport(path: string): Report {
  const input: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Value.Check(Report, input)) throw new Error(`Invalid fixture report: ${path}`);
  return input;
}

export function runTestFiles(
  files: string[],
  fixture: Fixture,
  environment: NodeJS.ProcessEnv = process.env,
  root = ROOT
): void {
  if (!files.length) throw new Error(`Empty API fixture: ${fixture}`);
  const env = { ...environment };
  if (fixture === 'unit') {
    delete env.TEST_DATABASE_URL;
    delete env.DATABASE_URL;
  }
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=4', ...files], {
    cwd: root,
    env,
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`API ${fixture} tests failed (${result.signal ?? result.status})`);
}

async function main(args: string[]) {
  const [command, first, second, third, fourth] = args;
  if (command === 'report' && args.length === 5 && first === '--files' && second && third === '--out' && fourth) {
    const list = readFileSync(second, 'utf8').split(/\r?\n/).filter(Boolean);
    writeFileSync(fourth, JSON.stringify(await fixtureReport(checkedFiles(list, apiFiles())), null, 2) + '\n');
    return;
  }
  if (command === 'compare-fixtures' && args.length === 3 && first && second) {
    console.log(JSON.stringify(compareFixtures(readReport(first), readReport(second)), null, 2));
    return;
  }
  if (
    args.length &&
    !(args.length === 2 && args[0] === '--fixture' && (args[1] === 'unit' || args[1] === 'integration'))
  )
    throw new Error('Expected --fixture unit or --fixture integration (omit to run both)');
  const fixtures: Fixture[] =
    args[1] === 'unit' ? ['unit'] : args[1] === 'integration' ? ['integration'] : ['unit', 'integration'];
  if (fixtures.includes('integration')) await requireTestDatabase();
  const lanes = apiLanes();
  for (const fixture of fixtures) runTestFiles(lanes[fixture], fixture);
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
