import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { checkApiSources } from '../check-api-sources.mts';
import { globToRegExp, REPO_ROOT, repoFiles } from '../lib/glob.mts';

const Paths = Type.Array(Type.String());
const BoundaryConfig = Type.Object({
  importRules: Type.Array(Type.Object({ id: Type.String(), sources: Paths, forbidden: Paths, message: Type.String() })),
  writeRules: Type.Object({
    ownerPathPrefixes: Paths,
    allowedOwners: Type.Record(Type.String(), Paths),
    crossDomainWriters: Type.Record(Type.String(), Paths)
  }),
  timerRules: Type.Object({ forbiddenSources: Paths, allowedCurrentSources: Paths })
});

function config() {
  const value: unknown = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config/import-boundaries.v1.json'), 'utf8'));
  if (!Value.Check(BoundaryConfig, value)) throw new Error('config/import-boundaries.v1.json is not a boundary config');
  return value;
}

const allFiles = repoFiles('.', () => true);

function fixtureFile(t: TestContext, name: string, source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-boundary-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, source);
  return filePath.split(path.sep).join('/');
}

// A rule over paths that no longer exist passes forever and checks nothing.
test('every glob in the boundary config matches at least one file', () => {
  const rules = config();
  const globs = [
    ...rules.importRules.flatMap((rule) => rule.sources),
    ...rules.timerRules.forbiddenSources,
    ...rules.timerRules.allowedCurrentSources
  ];
  const unmatched = globs.filter((glob) => {
    const pattern = globToRegExp(glob);
    return !allFiles.some((file) => pattern.test(file));
  });
  assert.deepEqual(unmatched, []);
});

test('every owner and cross-domain writer in the boundary config exists', () => {
  const { writeRules } = config();
  const paths = [...Object.values(writeRules.allowedOwners).flat(), ...Object.keys(writeRules.crossDomainWriters)];
  assert.deepEqual(
    [...new Set(paths)].filter((file) => !fs.existsSync(path.join(REPO_ROOT, file))),
    []
  );
  assert.deepEqual(
    writeRules.ownerPathPrefixes.filter((prefix) => !fs.existsSync(path.join(REPO_ROOT, prefix))),
    []
  );
});

// A forbidden import is matched by substring, so one that names nothing never fires.
test('every forbidden import in the boundary config names something that exists', () => {
  const unresolved: string[] = [];
  for (const rule of config().importRules) {
    const patterns = rule.sources.map(globToRegExp);
    const sources = allFiles.filter((file) => patterns.some((pattern) => pattern.test(file)));
    for (const forbidden of rule.forbidden) {
      const candidates = forbidden.startsWith('.')
        ? sources.map((source) => path.join(REPO_ROOT, path.dirname(source), forbidden))
        : [path.join(REPO_ROOT, forbidden.startsWith('@') ? 'node_modules' : '', forbidden)];
      const exists = candidates.some((candidate) =>
        ['', '.ts', '.js', '.mts'].some((extension) => fs.existsSync(`${candidate}${extension}`))
      );
      if (!exists) unresolved.push(`${rule.id}: ${forbidden}`);
    }
  }
  assert.deepEqual(unresolved, []);
});

test('a timer in the API listener entry or a route module breaks the timer rule', (t) => {
  const rules = config();
  for (const name of ['apps/api/src/server.ts', 'apps/api/src/domains/rooms/rooms.routes.ts']) {
    const file = fixtureFile(t, name, 'setInterval(() => {}, 1000);\n');
    const violations = checkApiSources({ config: rules, files: [file] });
    assert.equal(violations[0]?.ruleId, 'api-listener-worker-timer', name);
  }
});

test('a timer in an allowed current source passes', (t) => {
  const file = fixtureFile(t, 'apps/api/src/lib/listen.ts', 'setTimeout(() => {}, 250);\n');
  const timerRules = {
    forbiddenSources: ['apps/api/src/**/*.ts'],
    allowedCurrentSources: ['apps/api/src/lib/listen.ts']
  };
  assert.deepEqual(checkApiSources({ config: { timerRules }, files: [file] }), []);
});

test('the timer rule reads {a,b} in its globs', (t) => {
  const file = fixtureFile(t, 'apps/api/src/server.ts', 'setTimeout(() => {}, 250);\n');
  const timerRules = { forbiddenSources: ['apps/api/src/*.{js,ts}'] };
  assert.equal(checkApiSources({ config: { timerRules }, files: [file] })[0]?.ruleId, 'api-listener-worker-timer');
});
