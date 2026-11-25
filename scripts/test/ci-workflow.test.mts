import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { parse } from 'yaml';

const JobSchema = Type.Object({
  needs: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
  if: Type.Optional(Type.String())
});
type Job = Static<typeof JobSchema>;

const root = path.resolve(import.meta.dirname, '../..');
const workflow = Value.Parse(
  Type.Object({ jobs: Type.Record(Type.String(), JobSchema) }),
  parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'))
);

function job(id: string): Job {
  const found = workflow.jobs[id];
  assert.ok(found, `ci.yml has no job ${id}`);
  return found;
}

function needs(id: string): string[] {
  const value = job(id).needs ?? [];
  return Array.isArray(value) ? value : [value];
}

// GitHub's implicit success() skips a job when any job up its needs chain skipped,
// even a job its direct needs tolerate with always(). The installer, site and
// docs jobs skip on most pull requests.
test('recording the verified tree survives skipped jobs further up the chain', () => {
  const condition = job('record-app-checks').if ?? '';
  assert.match(condition, /^!cancelled\(\) && /);
  for (const need of needs('record-app-checks')) {
    assert.ok(
      condition.includes(`needs.${need}.result == 'success'`),
      `record-app-checks must require ${need} by its result`
    );
  }
});

test('client artifacts build beside the images behind the same gate', () => {
  assert.ok(!needs('client-artifacts').includes('images'));
  assert.deepEqual(needs('client-artifacts'), needs('images'));
  assert.equal(job('client-artifacts').if, job('images').if);
  assert.deepEqual(needs('deploy-dev').toSorted(), ['client-artifacts', 'images']);
});

test('the required check name waits for every check lane', () => {
  assert.ok(needs('check').includes('check-lane'));
  assert.match(job('check').if ?? '', /^\$\{\{ !cancelled\(\) && /);
});
