import assert from 'node:assert/strict';
import test from 'node:test';
import { checkDiscovery, checkWorkspace, completedGroups } from '../ci/completed-tests.mts';
import { FULL_SELECTION } from '../ci/verification-policy.mts';

test('a selected workspace must execute a test in at least one file', () => {
  const file = (status: string) => ({ name: 'test/leaf.test.ts', assertionResults: [{ status }] });
  checkWorkspace({ testResults: [file('passed')] });
  for (const testResults of [[], [file('pending')]]) {
    assert.throws(() => checkWorkspace({ testResults }), /No executed test file/);
  }
});

const suite = (file: string, status = 'passed', projectName = 'chromium') => ({
  specs: [{ file, tests: [{ projectName, results: [{ status }] }] }]
});

test('group proof requires runner results from each selected spec, not just successful discovery', () => {
  const core = suite('room-voice.spec.ts');
  const cta = suite('guest-account-cta.spec.ts');
  const groups = ['widget', 'voice-core', 'voice-guest'];
  assert.throws(() => completedGroups('voice', groups, { suites: [core, cta] }), /mobile-room/);
  assert.throws(
    () => completedGroups('voice', groups, { suites: [core, cta, suite('mobile-room.spec.ts', 'skipped')] }),
    /mobile-room/
  );
  assert.deepEqual(
    completedGroups('voice', groups, { suites: [core, { suites: [cta, suite('mobile-room.spec.ts')] }] }),
    ['voice-core', 'voice-guest']
  );
  assert.deepEqual(completedGroups('personal', ['personal'], { suites: [suite('meet.spec.ts')] }), ['personal']);
});

test('Playwright discovery cannot gain an unassigned spec or lose a required one', () => {
  checkDiscovery('meet', { suites: [{ file: 'meet.spec.ts' }] });
  assert.throws(() => checkDiscovery('meet', { suites: [] }), /did not discover/);
  assert.throws(
    () => checkDiscovery('meet', { suites: [{ file: 'meet.spec.ts' }, { file: 'extra.spec.ts' }] }),
    /Assign/
  );
});

test('UI audit needs execution in both specs on each of the three browsers', () => {
  const suites = ['chromium', 'firefox', 'webkit'].flatMap((project) =>
    ['focus.spec.ts', 'security-hardening-cache.spec.ts'].map((file) => suite(file, 'passed', project))
  );
  assert.deepEqual(completedGroups('ui-audit', ['ui-audit'], { suites }), ['ui-audit']);
  assert.throws(
    () => completedGroups('ui-audit', ['ui-audit'], { suites: suites.slice(0, -1) }),
    /security-hardening-cache.*webkit/
  );
});

test('passing mocked reactions do not cover a skipped real case', () => {
  const run = (status: string) =>
    completedGroups('voice-features', ['voice-reactions'], {
      suites: [suite('reactions.spec.ts'), suite('reactions.spec.ts', status)]
    });
  assert.deepEqual(run('passed'), ['voice-reactions']);
  assert.throws(() => run('skipped'), /Every real and mocked reaction case/);
});

test('a passing or skipped foreign spec cannot hide beside the correct Voice evidence', () => {
  const groups = ['voice-core', 'voice-reactions'];
  for (const [fixture, own, foreign] of [
    ['voice', 'room-voice.spec.ts', 'reactions.spec.ts'],
    ['voice-features', 'reactions.spec.ts', 'room-voice.spec.ts']
  ] as const) {
    for (const status of ['passed', 'skipped']) {
      assert.throws(
        () => completedGroups(fixture, groups, { suites: [suite(own), suite(foreign, status)] }),
        /Unexpected spec in fixture report/
      );
    }
  }
});

test('unfiltered Web and audit discovery must match their complete independent inventories', () => {
  const voice = [
    'room-voice',
    'chat-typing',
    'manual-chat-polish',
    'chat-drafts',
    'chat-image-paste',
    'guest-account-cta',
    'mobile-room',
    'friend-call',
    'microphone-recovery',
    'rnnoise-assets'
  ];
  const features = [
    'context-menu',
    'reactions',
    'room-delete',
    'room-edit',
    'room-realtime',
    'localization',
    'desktop-root-boundary',
    'mic-stall'
  ];
  // Derive proof from independent per-job spec lists: changing an assignment
  // without changing the fixture must fail even if Web discovery is unchanged.
  for (const [fixture, files] of [
    ['voice', voice],
    ['voice-features', features]
  ] as const) {
    completedGroups(fixture, FULL_SELECTION.groups, { suites: files.map((name) => suite(name + '.spec.ts')) });
  }
  for (const [fixture, files] of [
    ['web', [...voice, ...features, 'widget-embed', 'widget-media-boundary', 'widget-reconnect']],
    ['audit-discovery', ['focus', 'security-hardening-cache']]
  ] as const) {
    const suites = files.map((name) => ({ file: name + '.spec.ts' }));
    checkDiscovery(fixture, { suites });
    assert.throws(() => checkDiscovery(fixture, { suites: suites.slice(1) }), /did not discover/);
    assert.throws(() => checkDiscovery(fixture, { suites: [...suites, { file: 'unassigned.spec.ts' }] }), /Assign/);
  }
});
