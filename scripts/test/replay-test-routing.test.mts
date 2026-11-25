import assert from 'node:assert/strict';
import test from 'node:test';
import { checkoutCommit } from '../ci/replay-history.mts';
import { auditAttempt, exitStatus, replayPR, timing } from '../ci/replay-test-routing.mts';
import { FULL_SELECTION } from '../ci/verification-policy.mts';

const pr = { number: 1, updated: '', created: '', merged: '', branch: 'feature/example' };
const job = (name: string, conclusion: string, attempt: number, steps: string[] = []) => ({
  id: 4,
  name,
  conclusion,
  steps,
  attempt,
  start: 1000,
  end: 12000
});

test('a red Web workspace on an older attempt is a miss despite green latest and a selected Web job', async () => {
  const history = {
    workflowRuns: async () => [
      { id: 10, attempt: 2, head: 'head', created: '2026-01-01T00:00:00Z', end: '2026-01-01T00:01:00Z' }
    ],
    runJobs: async () => [
      job('Detect changed components', 'success', 1),
      job('Web tests', 'failure', 1, ['Run npm --workspace @voiceroom/widget run test']),
      job('Web tests', 'success', 2)
    ],
    testedTrees: async () => ({ base: 'b', tree: 't' }),
    changedPaths: () => ['packages/ui/example.ts'],
    routeTrees: () => ({
      selection: { lanes: ['test-web'], workspaces: ['web'], groups: [] },
      reason: 'leaf',
      app: true,
      site: false,
      docs: false,
      installer: false,
      digest: ''
    })
  };
  const red = await replayPR('test/repo', pr, history);
  assert.equal(red.failed, 1);
  assert.equal(red.missed, 1);
  assert.equal(red.resolved, 2);
  assert.match(red.details.join('\n'), /#1\/10\/1 MISS.*packages\/ui\/example.ts/);
  assert.equal(exitStatus([red]), 1);
  const green = await replayPR('test/repo', pr, {
    ...history,
    routeTrees: () => ({ ...history.routeTrees(), selection: FULL_SELECTION })
  });
  assert.equal(green.failed, 1);
  assert.equal(green.missed, 0);
  assert.equal(exitStatus([green]), 0);
  const unavailable = await replayPR('test/repo', pr, {
    ...history,
    testedTrees: async () => {
      throw new Error('no merge tree');
    }
  });
  assert.equal(unavailable.resolved, 0);
  assert.equal(unavailable.errors.length, 2);
  assert.equal(exitStatus([unavailable]), 1);
});

test('unmapped red jobs are unresolved, and a skipped job is not an observation', () => {
  const r = auditAttempt([job('new gate', 'failure', 1), job('Web tests', 'skipped', 1)], FULL_SELECTION);
  assert.deepEqual(r.unknown, ['new gate']);
  assert.equal(r.failed, 1);
  assert.equal(r.skipped, 1);
});

test('unattributed Voice failures require all groups on the failed job, not on both parallel stacks', () => {
  const smoke = job('Voice room join smoke', 'failure', 1, ['Join voice']);
  const features = job('Voice feature journeys', 'failure', 1);
  const smokeOnly = {
    lanes: ['voice-join'],
    groups: ['voice-core', 'voice-chat', 'voice-guest', 'voice-call'],
    workspaces: []
  };
  assert.deepEqual(auditAttempt([smoke], smokeOnly).misses, []);
  assert.equal(auditAttempt([smoke], { ...smokeOnly, groups: ['voice-core'] }).misses.length, 1);
  assert.equal(auditAttempt([features], smokeOnly).misses.length, 1);
  assert.equal(auditAttempt([features], { ...FULL_SELECTION, groups: ['voice-reactions'] }).misses.length, 1);
  assert.deepEqual(auditAttempt([features], FULL_SELECTION).misses, []);
});

test('known spec failures must come from their own job and require their owning group', () => {
  const steps = ['Run e2e/reactions.spec.ts'];
  const red = job('Voice feature journeys', 'failure', 1, steps);
  const selected = { lanes: ['voice-features'], groups: ['voice-reactions'], workspaces: [] };
  assert.deepEqual(auditAttempt([red], selected).misses, []);
  assert.equal(auditAttempt([red], { ...selected, groups: ['voice-mic-stall'] }).misses.length, 1);
  for (const misplaced of [
    job('Voice room join smoke', 'failure', 1, steps),
    job('Voice feature journeys', 'failure', 1, ['Run e2e/room-voice.spec.ts'])
  ])
    assert.deepEqual(auditAttempt([misplaced], FULL_SELECTION).unknown, [misplaced.name]);
});

test('an omitted cross-browser audit is a missed failure even if Voice was selected', () => {
  const red = job('Cross-browser UI audit', 'failure', 1);
  assert.equal(auditAttempt([red], { lanes: ['voice-join'], workspaces: [], groups: ['voice-core'] }).misses.length, 1);
  assert.equal(auditAttempt([red], FULL_SELECTION).misses.length, 0);
});

test('checkout evidence must identify the requested PR merge, not the head or another checkout', () => {
  const hash = 'a'.repeat(40);
  const log = 'fetch +' + hash + ':refs/remotes/pull/5/merge\ntime [command]/usr/bin/git log -1 --format=%H\ntime ';
  assert.equal(checkoutCommit(log + hash, 5), hash);
  assert.throws(() => checkoutCommit(log + 'b'.repeat(40), 5));
  assert.throws(() => checkoutCommit('fetch +' + hash + ':refs/remotes/pull/5/merge', 2));
  assert.throws(() => checkoutCommit('fetch +' + hash + ':refs/remotes/pull/5/head', 5));
});

test('model uses parallel max plus routing; peak treats end as exclusive and skips unexecuted jobs', () => {
  const j = job('Detect changed components', 'success', 1);
  const r = timing(
    [
      { ...j, start: 0, end: 2000 },
      { ...j, name: 'Check lint', start: 2000, end: 5000 },
      { ...j, name: 'Web tests', start: 2000, end: 7000 },
      { ...j, name: 'API tests', conclusion: 'skipped', end: 99999 }
    ],
    0,
    9000,
    FULL_SELECTION
  );
  assert.equal(r.model, 7);
  assert.equal(r.peak, 2);
  assert.equal(r.actual, 9);
  assert.ok(r.unpriced.includes('test'));
});

test('historical repository regressions require the check lane even if API is selected', () => {
  const moved = 'Script tests and real Caddy log-redaction regression';
  const selected = (lanes: string[]) => ({ lanes, workspaces: [], groups: [] });
  for (const [name, lane] of [
    ['API tests', 'test'],
    ['API without PostgreSQL', 'api-unit']
  ] as const) {
    const only = [job(name, 'failure', 1, [moved])];
    const mixed = [job(name, 'failure', 1, [moved, 'Run assigned tests'])];
    assert.equal(auditAttempt(only, selected([lane])).misses.length, 1);
    assert.equal(auditAttempt(only, selected(['check-lane'])).misses.length, 0);
    assert.equal(auditAttempt(mixed, selected(['check-lane'])).misses.length, 1);
    assert.equal(auditAttempt(mixed, selected([lane])).misses.length, 1);
    assert.equal(auditAttempt(mixed, selected([lane, 'check-lane'])).misses.length, 0);
  }
});
