import { readFileSync } from 'node:fs';
import { isArray, isRecord } from '../../packages/shared/src/guards.ts';
import { FULL_SELECTION, fixtureSpecs } from './verification-policy.mts';

// The runner exit code covers failures. In addition, require positive file evidence:
// an all-skipped/empty workspace or a Playwright filter matching only some specs is not proof.
export function checkWorkspace(report: unknown) {
  if (
    !isRecord(report) ||
    !isArray(report.testResults) ||
    !report.testResults.some(
      (file) =>
        isRecord(file) &&
        typeof file.name === 'string' &&
        isArray(file.assertionResults) &&
        file.assertionResults.some((entry) => isRecord(entry) && entry.status === 'passed')
    )
  )
    throw new Error('No executed test file in the selected workspace');
}

const personalSpec = 'e2e/meet.spec.ts';
// Explicit PR3b boundary: none of these are run by the PR3a fixture commands.
const deferredVoice = new Set(
  [
    'context-menu',
    'reactions',
    'room-delete',
    'room-edit',
    'room-realtime',
    'localization',
    'desktop-root-boundary',
    'mic-stall'
  ].map((name) => 'e2e/' + name + '.spec.ts')
);

export function checkDiscovery(fixture: 'web' | 'meet', report: unknown) {
  if (!isRecord(report) || !isArray(report.suites)) throw new Error('Missing Playwright discovery report');
  const expected =
    fixture === 'meet'
      ? [personalSpec]
      : [...fixtureSpecs('voice', FULL_SELECTION.groups), ...fixtureSpecs('widget', FULL_SELECTION.groups)];
  const found = report.suites.map((suite) => {
    if (!isRecord(suite) || typeof suite.file !== 'string') throw new Error('Missing discovered spec path');
    return 'e2e/' + suite.file;
  });
  for (const path of expected) if (!found.includes(path)) throw new Error('Fixture did not discover ' + path);
  for (const path of found) {
    if (!expected.includes(path) && !(fixture === 'web' && deferredVoice.has(path)))
      throw new Error('Assign the newly discovered spec to a fixture: ' + path);
  }
}

function passedFiles(suite: unknown, files: Set<string>) {
  if (!isRecord(suite)) return;
  if (isArray(suite.suites)) for (const child of suite.suites) passedFiles(child, files);
  if (!isArray(suite.specs)) return;
  for (const spec of suite.specs) {
    if (
      isRecord(spec) &&
      typeof spec.file === 'string' &&
      isArray(spec.tests) &&
      spec.tests.some(
        (test) =>
          isRecord(test) &&
          isArray(test.results) &&
          test.results.some((result) => isRecord(result) && result.status === 'passed')
      )
    )
      files.add('e2e/' + spec.file);
  }
}

export function completedGroups(fixture: string, groups: unknown, report: unknown): string[] {
  if (!isArray(groups) || !groups.every((item): item is string => typeof item === 'string'))
    throw new Error('Missing groups');
  if (fixture !== 'voice' && fixture !== 'widget' && fixture !== 'personal') throw new Error('Unknown fixture');
  const selected = groups.filter((group) => (fixture === 'voice' ? group.startsWith('voice-') : group === fixture));
  if (!selected.length || !isRecord(report) || !isArray(report.suites)) throw new Error('Missing fixture evidence');
  const files = new Set<string>();
  for (const suite of report.suites) passedFiles(suite, files);
  for (const group of selected) {
    for (const file of fixture === 'personal' ? [personalSpec] : fixtureSpecs(fixture, [group])) {
      if (!files.has(file)) throw new Error(group + ': no passing test in ' + file);
    }
  }
  return selected.sort();
}

if (import.meta.main) {
  const [, , fixture, path] = process.argv;
  if (!fixture || !path) throw new Error('Expected fixture and runner JSON report');
  const report: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (fixture === 'web' || fixture === 'meet') checkDiscovery(fixture, report);
  else if (fixture === 'workspace') checkWorkspace(report);
  else
    console.log(
      'completed=' + JSON.stringify(completedGroups(fixture, JSON.parse(process.env.GROUPS_JSON ?? 'null'), report))
    );
}
