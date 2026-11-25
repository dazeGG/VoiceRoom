import { readFileSync } from 'node:fs';
import { isArray, isRecord } from '../../packages/shared/src/guards.ts';
import { AUDIT_PROJECTS, FULL_SELECTION, fixtureSpecs, type BrowserFixture } from './verification-policy.mts';

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

export function checkDiscovery(fixture: 'web' | 'meet' | 'audit-discovery', report: unknown) {
  if (!isRecord(report) || !isArray(report.suites)) throw new Error('Missing Playwright discovery report');
  const fixtures: BrowserFixture[] =
    fixture === 'web' ? ['voice', 'widget'] : [fixture === 'meet' ? 'personal' : 'ui-audit'];
  const expected = fixtures.flatMap((name) => fixtureSpecs(name, FULL_SELECTION.groups));
  const dir = fixture === 'audit-discovery' ? 'ui-audit-e2e/' : 'e2e/';
  const found = report.suites.map((suite) => {
    if (!isRecord(suite) || typeof suite.file !== 'string') throw new Error('Missing discovered spec path');
    return dir + suite.file;
  });
  for (const path of expected) if (!found.includes(path)) throw new Error('Fixture did not discover ' + path);
  for (const path of found) {
    if (!expected.includes(path)) throw new Error('Assign the newly discovered spec to a fixture: ' + path);
  }
}

// A selected file must execute on its own project, not just another browser.
// Mock-only success must never mask a skipped real multi-account or storage
// scenario. Check each reaction case rather than maintaining case identifiers.
function collectPasses(suite: unknown, files: Set<string>) {
  if (!isRecord(suite)) return;
  if (isArray(suite.suites)) for (const child of suite.suites) collectPasses(child, files);
  if (!isArray(suite.specs)) return;
  for (const spec of suite.specs) {
    if (!isRecord(spec) || typeof spec.file !== 'string' || !isArray(spec.tests) || !spec.tests.length)
      throw new Error('Invalid spec evidence');
    for (const test of spec.tests) {
      if (!isRecord(test) || typeof test.projectName !== 'string' || !isArray(test.results))
        throw new Error('Invalid project evidence for ' + spec.file);
      if (test.results.some((result) => isRecord(result) && result.status === 'passed')) {
        files.add(test.projectName + ':' + spec.file);
      } else if (spec.file === 'reactions.spec.ts') {
        throw new Error('Every real and mocked reaction case must pass: ' + String(spec.title));
      }
    }
  }
}

export function completedGroups(fixture: string, groups: unknown, report: unknown): string[] {
  if (!isArray(groups) || !groups.every((item): item is string => typeof item === 'string'))
    throw new Error('Missing groups');
  if (fixture !== 'voice' && fixture !== 'widget' && fixture !== 'personal' && fixture !== 'ui-audit')
    throw new Error('Unknown fixture');
  const selected = groups.filter((group) => (fixture === 'voice' ? group.startsWith('voice-') : group === fixture));
  if (!selected.length || !isRecord(report) || !isArray(report.suites)) throw new Error('Missing fixture evidence');
  const files = new Set<string>();
  for (const suite of report.suites) collectPasses(suite, files);
  for (const group of selected) {
    for (const file of fixtureSpecs(fixture, [group])) {
      for (const project of fixture === 'ui-audit' ? AUDIT_PROJECTS : ['chromium']) {
        if (!files.has(project + ':' + file.slice(file.indexOf('/') + 1))) {
          throw new Error(group + ': no passing test in ' + file + ' on ' + project);
        }
      }
    }
  }
  return selected.sort();
}

if (import.meta.main) {
  const [, , fixture, path] = process.argv;
  if (!fixture || !path) throw new Error('Expected fixture and runner JSON report');
  const report: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (fixture === 'web' || fixture === 'meet' || fixture === 'audit-discovery') checkDiscovery(fixture, report);
  else if (fixture === 'workspace') checkWorkspace(report);
  else
    console.log(
      'completed=' + JSON.stringify(completedGroups(fixture, JSON.parse(process.env.GROUPS_JSON ?? 'null'), report))
    );
}
