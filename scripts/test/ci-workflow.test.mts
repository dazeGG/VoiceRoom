import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { parse } from 'yaml';
import { FULL_SELECTION } from '../ci/verification-policy.mts';

const JobSchema = Type.Object({
  name: Type.Optional(Type.String()),
  needs: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
  if: Type.Optional(Type.String()),
  env: Type.Optional(Type.Record(Type.String(), Type.String())),
  strategy: Type.Optional(Type.Object({ matrix: Type.Optional(Type.Unknown()) })),
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

// These are deployment-configuration contracts. Outcome semantics are exercised
// in verification-policy.test.mts; keep this suite about edges and reachability.
function survivesSkippedAncestors(id: string) {
  assert.match(job(id).if ?? '', /always\(\)|!cancelled\(\)/, id);
}

test('the final policy can inspect every lane even after skips, failures and cancellation', () => {
  assert.equal(job('policy').name, 'Git Flow policy');
  assert.deepEqual(needs('policy').toSorted(), ['changes', ...FULL_SELECTION.lanes].sort());
  assert.equal(job('policy').if, 'always()');
  for (const [id, name] of Object.entries({
    check: 'Lint, typecheck & build',
    test: 'API tests',
    'test-web': 'Web tests',
    'voice-join': 'Voice room join smoke',
    'goal-g05': 'G05 strict LiveKit gate proof'
  }))
    assert.equal(job(id).name, name);
});

test('the verified marker follows policy on same-repository develop PRs, not every producer', () => {
  assert.deepEqual(needs('record-app-checks').toSorted(), ['changes', 'policy']);
  survivesSkippedAncestors('record-app-checks');
  const condition = job('record-app-checks').if ?? '';
  for (const input of ['github.base_ref', 'github.event.pull_request.head.repo.full_name', 'needs.policy.result'])
    assert.ok(condition.includes(input), input);
});

test('the UI audit uses a single runner independently of the Voice Compose stack', () => {
  assert.deepEqual(needs('ui-audit'), ['changes']);
  assert.equal(job('ui-audit').strategy?.matrix, undefined);
});

test('both Voice fixtures can start directly after routing, each on its own runner', () => {
  for (const [id, fixture] of [
    ['voice-join', 'voice'],
    ['voice-features', 'voice-features']
  ] as const) {
    assert.deepEqual(needs(id), ['changes']);
    assert.equal(job(id).env?.FIXTURE, fixture);
    assert.equal(job(id).strategy?.matrix, undefined);
  }
  assert.equal(job('voice-features').name, 'Voice feature journeys');
  assert.equal(job('voice-join').env?.E2E_REAL_REACTIONS, undefined);
});

test('client artifacts build beside the images behind the same gate', () => {
  assert.ok(!needs('client-artifacts').includes('images'));
  assert.deepEqual(needs('client-artifacts'), needs('images'));
  assert.equal(job('client-artifacts').if, job('images').if);
  assert.deepEqual(needs('deploy-dev').toSorted(), ['client-artifacts', 'images']);
});

test('the required check name waits for every check lane', () => {
  assert.ok(needs('check').includes('check-lane'));
  survivesSkippedAncestors('check');
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

test('publication requires a successful push policy and independent component intent', () => {
  for (const [id, intent] of Object.entries({
    images: 'app',
    'client-artifacts': 'app',
    'deploy-site-dev': 'site',
    'deploy-docs-dev': 'docs'
  })) {
    assert.ok(needs(id).includes('policy') && needs(id).includes('changes'));
    survivesSkippedAncestors(id);
    const guard = job(id).if ?? '';
    for (const input of [
      "github.event_name == 'push'",
      "needs.policy.result == 'success'",
      `needs.changes.outputs.${intent} == 'true'`
    ])
      assert.ok(guard.includes(input), id + ' must require ' + input);
  }
});
