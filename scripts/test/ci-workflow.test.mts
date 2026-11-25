import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { parse } from 'yaml';

const JobSchema = Type.Object({
  name: Type.Optional(Type.String()),
  needs: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
  if: Type.Optional(Type.String()),
  env: Type.Optional(Type.Record(Type.String(), Type.String())),
  services: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  steps: Type.Optional(
    Type.Array(
      Type.Object({
        uses: Type.Optional(Type.String()),
        with: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
      })
    )
  )
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

const producers = ['api-unit', 'api-integration'];

test('only integration waits for PostgreSQL; both raw bundles reach the protected API check', () => {
  const aggregate = job('test');
  assert.equal(aggregate.name, 'API tests');
  assert.deepEqual(needs('test').toSorted(), [...producers, 'changes'].sort());
  assert.match(aggregate.if ?? '', /!cancelled\(\)/);
  assert.deepEqual(Object.keys(job('api-unit').services ?? {}), []);
  assert.equal(job('api-unit').env?.TEST_DATABASE_URL, undefined);
  assert.ok(job('api-integration').services?.postgres);
  assert.ok(job('api-integration').env?.TEST_DATABASE_URL);

  const uploads = producers.map((id) => {
    assert.deepEqual(needs(id), ['changes']);
    const fixture = job(id).env?.FIXTURE;
    assert.equal(fixture, id.slice('api-'.length));
    const steps = job(id).steps?.filter((step) => step.uses?.startsWith('actions/upload-artifact@'));
    assert.equal(steps?.length, 1);
    return String(steps[0]?.with?.name).replace('${{ env.FIXTURE }}', fixture);
  });
  assert.equal(new Set(uploads).size, 2);
  const downloads = aggregate.steps?.filter((step) => step.uses?.startsWith('actions/download-artifact@'));
  assert.deepEqual(downloads?.map((step) => step.with?.name).sort(), uploads.sort());
});

test('both publication jobs and the verified-tree marker require the producers and verdict', () => {
  for (const consumer of ['record-app-checks', 'images', 'client-artifacts']) {
    for (const id of [...producers, 'test']) {
      assert.ok(needs(consumer).includes(id), `${consumer} must wait for ${id}`);
      assert.ok(job(consumer).if?.includes(`needs.${id}.result == 'success'`));
    }
  }
});
