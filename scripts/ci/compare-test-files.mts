import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

const Count = Type.Integer({ minimum: 0 });
const Label = Type.String({ minLength: 1 });
const File = Type.Object({
  file: Label,
  project: Label,
  environment: Label,
  fixture: Label,
  tests: Count,
  passed: Count,
  skipped: Count
});
const Report = Type.Object({ tree: Label, files: Type.Array(File, { minItems: 1 }) });
type Report = Static<typeof Report>;

function git(root: string, ...args: string[]) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

function treeId(root: string, rev: string) {
  return git(root, 'rev-parse', '--verify', '--end-of-options', rev + '^{tree}').trim();
}

// Independent of the runners' selectors. The Personal Compose smoke and Playwright
// specs run on their own fixtures, outside the workspace and repository unit suites.
function trackedTests(root: string, tree: string) {
  return git(root, 'ls-tree', '-r', '-z', '--name-only', tree)
    .split('\0')
    .filter((file) => /^(?:(?:apps|packages)\/[^/]+\/test|scripts\/test)\/.*\.test\.[cm]?[jt]sx?$/.test(file))
    .sort();
}

function inventory(input: unknown, tree: string, root: string) {
  assert.ok(Value.Check(Report, input), 'Invalid runner inventory');
  assert.equal(input.tree, tree, 'Runner inventory has the wrong Git tree');
  const files = new Map<string, Omit<Report['files'][number], 'file'>>();
  for (const { file, ...record } of input.files) {
    assert.ok(!files.has(file), 'Duplicate runner file: ' + file);
    assert.ok(record.tests > 0 && record.tests === record.passed + record.skipped, 'Incomplete outcomes: ' + file);
    files.set(file, record);
  }
  assert.deepEqual([...files.keys()].sort(), trackedTests(root, tree), 'Runner files differ from tracked test files');
  return files;
}

export function compareTestFiles(before: unknown, after: unknown, base: string, tested: string, root = process.cwd()) {
  const from = treeId(root, base);
  const to = treeId(root, tested);
  const old = inventory(before, from, root);
  const current = inventory(after, to, root);
  const names = git(root, 'diff', '--name-status', '-z', '--find-renames', '-l0', '--diff-filter=R', from, to).split(
    '\0'
  );
  const renames = new Map<string, string>();
  for (let i = 0; i < names.length - 1; i += 3) {
    const [status, source, destination] = names.slice(i, i + 3);
    assert.ok(status && /^R\d+$/.test(status) && source && destination, 'Invalid Git rename pair');
    renames.set(source, destination);
  }
  const seen = new Set<string>();
  let moved = 0,
    passed = 0,
    skipped = 0;
  for (const [source, expected] of old) {
    const destination = renames.get(source) ?? source;
    const actual = current.get(destination);
    assert.ok(actual, 'Unresolved move or missing test: ' + source);
    assert.ok(!seen.has(destination), 'Duplicate destination: ' + destination);
    assert.deepEqual(actual, expected, 'Runner drift: ' + source + ' -> ' + destination);
    seen.add(destination);
    if (source !== destination) moved++;
    passed += actual.passed;
    skipped += actual.skipped;
  }
  assert.deepEqual([...seen].sort(), [...current.keys()].sort(), 'Unmapped destination test files');
  return { files: seen.size, moved, unchanged: seen.size - moved, tests: passed + skipped, passed, skipped };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      before: { type: 'string' },
      after: { type: 'string' },
      base: { type: 'string' },
      tested: { type: 'string' }
    }
  });
  const { before, after, base, tested } = values;
  assert.ok(before && after && base && tested, 'Expected --before FILE --after FILE --base REV --tested REV');
  const read = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));
  console.log('Clean bijection:', compareTestFiles(read(before), read(after), base, tested));
}
