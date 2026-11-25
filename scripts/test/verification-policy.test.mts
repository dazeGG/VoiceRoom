import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FULL_SELECTION,
  fixtureSpecs,
  schedule,
  selectionDigest,
  verify,
  type Selection
} from '../ci/verification-policy.mts';

const admin: Selection = { lanes: ['check-lane', 'check', 'test-web'], workspaces: ['admin'], groups: [] };
const empty: Selection = { lanes: [], workspaces: [], groups: [] };
const pr = { event: 'pull_request', branch: 'develop', verified: false };
const push = { event: 'push', branch: 'develop', verified: false };

function evidence(selected: Selection, executed: Selection, verified = false) {
  const jobs: Record<string, { result: string; outputs?: Record<string, string> }> = {};
  jobs.changes = {
    result: 'success',
    outputs: { selection: JSON.stringify(selected), verified: String(verified), digest: selectionDigest(selected) }
  };
  for (const lane of FULL_SELECTION.lanes) {
    jobs[lane] = { result: executed.lanes.includes(lane) ? 'success' : 'skipped' };
  }
  for (const [lane, items] of Object.entries({
    'test-web': executed.workspaces,
    'voice-join': executed.groups.filter((s) => s.startsWith('voice-')),
    'widget-smoke': executed.groups.filter((s) => s === 'widget'),
    'personal-smoke': executed.groups.filter((s) => s === 'personal')
  })) {
    jobs[lane] = { ...jobs[lane], result: jobs[lane]?.result ?? '', outputs: { completed: JSON.stringify(items) } };
  }
  return jobs;
}

test('main and an unverified push require the fixed full inventory, not even a successful empty plan', () => {
  for (const ctx of [{ ...pr, branch: 'main' }, push]) {
    assert.deepEqual(schedule(ctx, empty), FULL_SELECTION);
    assert.throws(() => verify(ctx.event, ctx.branch, evidence(empty, empty)), /expected success/);
    assert.equal(verify(ctx.event, ctx.branch, evidence(empty, FULL_SELECTION)).length, FULL_SELECTION.lanes.length);
    const missingWorkspace = evidence(empty, FULL_SELECTION);
    missingWorkspace['test-web'] = { result: 'success', outputs: { completed: '["admin"]' } };
    assert.throws(() => verify(ctx.event, ctx.branch, missingWorkspace), /missing completed/);
  }
});

test('develop accepts success with workspace proof and explicitly unselected skips', () => {
  const lines = verify(pr.event, pr.branch, evidence(admin, admin));
  assert.ok(lines.includes('test-web: success'));
  assert.ok(lines.includes('api-integration: intentional skip'));
});

test('no skip, failed/cancelled job, or missing result can stand in for expected success', () => {
  for (const result of ['skipped', 'failure', 'cancelled', '']) {
    const jobs = evidence(admin, admin);
    jobs['test-web'] = { result };
    assert.throws(() => verify(pr.event, pr.branch, jobs), /test-web: expected success/);
  }
  for (const lane of ['changes', 'test-web', 'voice-join']) {
    const jobs = evidence(admin, admin);
    const partial = Object.fromEntries(Object.entries(jobs).filter(([name]) => name !== lane));
    assert.throws(() => verify(pr.event, pr.branch, partial), /missing/i);
  }
  const jobs = evidence(admin, admin);
  jobs['voice-join'] = { result: 'failure' };
  assert.throws(() => verify(pr.event, pr.branch, jobs), /voice-join: expected skipped/);
});

test('group and workspace evidence must match exactly even when the parent job says success', () => {
  for (const [lane, completed] of [
    ['test-web', ''],
    ['voice-join', '["voice-core"]'],
    ['widget-smoke', '["widget","widget"]'],
    ['personal-smoke', '["voice-core"]']
  ] as const) {
    const jobs = evidence(FULL_SELECTION, FULL_SELECTION);
    jobs[lane] = { result: 'success', outputs: { completed } };
    assert.throws(() => verify(pr.event, pr.branch, jobs), /completed evidence/);
  }
});

test('push hit reuses only proved app checks, and always demands fresh selected independent checks', () => {
  const selected = { ...admin, lanes: [...admin.lanes, 'static-publication', 'site', 'installer'] };
  const hit = schedule({ ...push, verified: true }, selected);
  assert.deepEqual(hit, { lanes: ['installer', 'site', 'static-publication'], groups: [], workspaces: [] });
  const jobs = evidence(selected, hit, true);
  assert.ok(verify(push.event, push.branch, jobs).includes('test-web: reused'));
  assert.throws(() => verify(push.event, push.branch, evidence(selected, hit)), /expected success/);
  for (const lane of hit.lanes) {
    assert.throws(
      () => verify(push.event, push.branch, { ...jobs, [lane]: { result: 'failure' } }),
      /expected success/
    );
  }
});

test('digest canonicalizes order, binds the exact verified scope, and rejects malformed membership', () => {
  const reversed = Object.fromEntries(
    Object.entries(FULL_SELECTION).map(([key, items]: [string, string[]]) => [key, [...items].reverse()])
  );
  assert.match(selectionDigest(admin), /^[a-f0-9]{64}$/);
  assert.equal(selectionDigest(FULL_SELECTION), selectionDigest(schedule(pr, reversed)));
  assert.notEqual(selectionDigest(admin), selectionDigest({ ...admin, workspaces: ['meet'] }));
  assert.notEqual(selectionDigest(admin), selectionDigest({ ...admin, lanes: [...admin.lanes, 'installer'] }));
  assert.notEqual(
    selectionDigest(FULL_SELECTION),
    selectionDigest({ ...FULL_SELECTION, groups: FULL_SELECTION.groups.filter((g) => g !== 'voice-chat') })
  );
  assert.throws(() => schedule(pr, { ...admin, groups: ['unknown'] }), /Invalid/);
  assert.throws(() => schedule(pr, { ...admin, workspaces: ['admin', 'admin'] }), /duplicate/);
  assert.throws(() => schedule(pr, { ...admin, lanes: ['check'] }), /Inconsistent/);
  const jobs = evidence(admin, admin);
  assert.ok(jobs.changes?.outputs);
  jobs.changes.outputs.digest = selectionDigest(FULL_SELECTION);
  assert.throws(() => verify(pr.event, pr.branch, jobs), /digest/);
});

test('current browser command expands only the selected spec groups on their own fixtures', () => {
  assert.deepEqual(fixtureSpecs('voice', ['voice-core', 'widget']), ['e2e/room-voice.spec.ts']);
  assert.deepEqual(fixtureSpecs('voice', ['voice-guest']), [
    'e2e/guest-account-cta.spec.ts',
    'e2e/mobile-room.spec.ts'
  ]);
  const full = fixtureSpecs('voice', FULL_SELECTION.groups);
  assert.equal(full.length, 10);
  assert.equal(new Set(full).size, full.length);
  assert.deepEqual(fixtureSpecs('widget', FULL_SELECTION.groups), [
    'e2e/widget-embed.spec.ts',
    'e2e/widget-media-boundary.spec.ts',
    'e2e/widget-reconnect.spec.ts'
  ]);
  assert.throws(() => fixtureSpecs('voice', ['widget']), /No selected specs/);
});
