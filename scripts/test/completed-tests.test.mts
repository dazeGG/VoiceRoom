import assert from 'node:assert/strict';
import test from 'node:test';
import { checkDiscovery, checkWorkspace, completedGroups } from '../ci/completed-tests.mts';

test('a selected workspace must execute a test in at least one file', () => {
  const file = (status: string) => ({ name: 'test/leaf.test.ts', assertionResults: [{ status }] });
  checkWorkspace({ testResults: [file('passed')] });
  for (const testResults of [[], [file('pending')]]) {
    assert.throws(() => checkWorkspace({ testResults }), /No executed test file/);
  }
});

test('group proof requires runner results from each selected spec, not just successful discovery', () => {
  const suite = (file: string, status = 'passed') => ({ specs: [{ file, tests: [{ results: [{ status }] }] }] });
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
