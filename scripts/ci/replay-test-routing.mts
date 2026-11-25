import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { routeTrees } from './changed-components.mts';
import { lastMerged, runJobs, testedTrees, workflowRuns } from './replay-history.mts';
import { FULL_SELECTION, VOICE_SPECS, voiceFixture, type Selection } from './verification-policy.mts';

type Job = Awaited<ReturnType<typeof runJobs>>[number];

type Pull = Awaited<ReturnType<typeof lastMerged>>[number];
const names: Record<string, string> = {
  'Detect changed components': 'changes',
  'Git Flow policy': 'policy',
  'Record verified application tree': 'marker',
  'Lint, typecheck & build': 'check',
  'API tests': 'test',
  'API without PostgreSQL': 'api-unit',
  'API with PostgreSQL': 'api-integration',
  'Web tests': 'test-web',
  'Voice room join smoke': 'voice-join',
  'Voice feature journeys': 'voice-features',
  'Cross-browser UI audit': 'ui-audit',
  'G05 strict LiveKit gate proof': 'goal-g05',
  'Embedded guest call and media boundary': 'widget-smoke',
  'Personal Compose smoke': 'personal-smoke',
  'Meet installer and CLI tests': 'installer',
  'Static publication checks': 'static-publication'
};

function laneFor(name: string) {
  if (/^(Site|Docs) checks(?:$| \/ )/.test(name)) return name.split(' ')[0]?.toLowerCase();
  if (/^Check (build|types|lint|conventions)$/.test(name)) return 'check-lane';
  return names[name];
}

function isSelected(id: string, selected: Selection) {
  return ['changes', 'policy', 'marker'].includes(id) || selected.lanes.includes(id);
}

function coversFailure(job: Job, selected: Selection): boolean | undefined {
  const lane = laneFor(job.name);
  if (!lane) return undefined;
  // The old combined API job (then PR2's unit producer) housed the repository
  // regression tests. Attribute each failed step to its present evidence.
  const moved = job.steps.filter((s) => s === 'Script tests and real Caddy log-redaction regression');
  if ((lane === 'test' || lane === 'api-unit') && moved.length) {
    if (!selected.lanes.includes('check-lane')) return false;
    if (moved.length === job.steps.length) return true;
  }
  if (!isSelected(lane, selected)) return false;
  if (lane === 'test-web') {
    const workspaces = job.steps.flatMap((s) => [...s.matchAll(/@voiceroom\/([\w-]+)/g)].map((m) => m[1]));
    const required = workspaces.length ? workspaces : FULL_SELECTION.workspaces;
    return required.every((w) => w !== undefined && selected.workspaces.includes(w));
  }
  if (lane === 'voice-join' || lane === 'voice-features') {
    const fixture = lane === 'voice-join' ? 'voice' : 'voice-features';
    const owners = Object.entries(VOICE_SPECS).filter(([group]) => voiceFixture(group) === fixture);
    const specs = job.steps.flatMap((s) => [...s.matchAll(/(?:^|[/ ])([\w-]+)\.spec\.ts/g)].map((m) => m[1]));
    if (specs.some((s) => !s || !owners.some(([, members]) => members.includes(s)))) return undefined;
    // An unattributed failure could come from any group that actually ran on
    // this fixture, not from a journey on the other parallel Voice stack.
    return owners
      .filter(([, members]) => !specs.length || members.some((s) => specs.includes(s)))
      .every(([group]) => selected.groups.includes(group));
  }
  return true;
}

export function auditAttempt(jobs: Job[], selected: Selection) {
  const failed = jobs.filter((j) =>
    ['failure', 'timed_out', 'action_required', 'startup_failure'].includes(j.conclusion)
  );
  const misses: string[] = [];
  const unknown: string[] = [];
  for (const j of failed) {
    const covers = coversFailure(j, selected);
    if (covers === undefined) unknown.push(j.name);
    else if (!covers) misses.push(j.name + ': ' + j.steps.join('; '));
  }
  return {
    failed: failed.length,
    misses,
    unknown,
    skipped: jobs.filter((j) => j.conclusion === 'skipped').length,
    cancelled: jobs.filter((j) => j.conclusion === 'cancelled').length
  };
}

export function timing(jobs: Job[], created: number, end: number, selected: Selection) {
  const active = jobs.filter((j) => j.conclusion !== 'skipped' && j.end > j.start);
  let n = 0,
    peak = 0;
  const events = active
    .flatMap(
      (j) =>
        [
          [j.start, 1],
          [j.end, -1]
        ] as const
    )
    .sort(([t, a], [u, b]) => t - u || a - b);
  for (const [, delta] of events) {
    n += delta;
    peak = Math.max(peak, n);
  }
  const observed = active.map((j) => ({ lane: laneFor(j.name), wall: (j.end - j.start) / 1000 }));
  const routing = observed.find((j) => j.lane === 'changes')?.wall;
  const lanes = observed.filter((j) => j.lane && j.lane !== 'changes' && isSelected(j.lane, selected));
  const unpriced = selected.lanes.filter(
    (l) =>
      !observed.some((j) => j.lane === l) &&
      // Historical combined jobs are duration proxies for today's splits.
      !(['api-unit', 'api-integration'].includes(l) && observed.some((j) => j.lane === 'test')) &&
      !(l === 'check-lane' && observed.some((j) => j.lane === 'check'))
  );
  return {
    peak,
    model: routing === undefined ? undefined : routing + Math.max(0, ...lanes.map((j) => j.wall)),
    actual: (end - created) / 1000,
    unpriced
  };
}

interface Row {
  attempts: number;
  resolved: number;
  failed: number;
  missed: number;
  unmapped: number;
  skipped: number;
  cancelled: number;
  details: string[];
  errors: string[];
  table: string;
}
function errorText(e: unknown) {
  // Never echo raw Actions logs (or debug escape sequences).
  return (e instanceof Error ? e.message : 'unknown error').split('\n')[0] ?? 'unknown error';
}

function changedPaths(base: string, tree: string) {
  return execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', base, tree], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}
export async function replayPR(
  repo: string,
  pr: Pull,
  source = { workflowRuns, runJobs, testedTrees, routeTrees, changedPaths }
) {
  const row: Row = {
    attempts: 0,
    resolved: 0,
    failed: 0,
    missed: 0,
    unmapped: 0,
    skipped: 0,
    cancelled: 0,
    details: [],
    errors: [],
    table: 'unavailable'
  };
  const prefix = '#' + String(pr.number);
  try {
    const runs = await source.workflowRuns(repo, pr);
    if (!runs.length) throw new Error('no pull_request CI runs within this PR lifetime');
    for (const run of runs) {
      row.attempts += run.attempt;
      let jobs: Job[];
      try {
        jobs = await source.runJobs(repo, run.id);
      } catch (e) {
        row.errors.push(prefix + '/' + String(run.id) + ' jobs: ' + errorText(e));
        continue;
      }
      for (let a = 1; a <= run.attempt; a++) {
        const id = prefix + '/' + String(run.id) + '/' + String(a);
        try {
          const attempt = jobs.filter((j) => j.attempt === a);
          if (!attempt.length) throw new Error('no jobs for attempt');
          // A rerun of failed jobs reuses the exact same pull_request event and SHA.
          const checkout =
            attempt.find((j) => j.name === 'Detect changed components' && j.conclusion === 'success') ??
            jobs.find((j) => j.name === 'Detect changed components' && j.conclusion === 'success');
          if (!checkout) throw new Error('no successful routing checkout');
          const { base, tree } = await source.testedTrees(repo, pr.number, checkout.id, run.head);
          const { selection, reason } = source.routeTrees(base, tree);
          const result = auditAttempt(attempt, selection);
          row.resolved++;
          row.failed += result.failed;
          row.missed += result.misses.length;
          row.unmapped += result.unknown.length;
          row.skipped += result.skipped;
          row.cancelled += result.cancelled;
          if (result.failed)
            row.details.push(
              id +
                ' failed=' +
                String(result.failed) +
                ' missed=' +
                String(result.misses.length) +
                ' jobs=' +
                attempt
                  .filter((j) => j.conclusion === 'failure')
                  .map((j) => j.name + ' [' + j.steps.join(', ') + ']')
                  .join('; ')
            );
          if (result.misses.length) {
            const paths = source.changedPaths(base, tree);
            row.details.push(id + ' MISS ' + JSON.stringify({ misses: result.misses, selection, reason, paths }));
          }
          if (result.unknown.length) row.errors.push(id + ' unmapped failed jobs: ' + result.unknown.join(', '));
          if (run === runs.at(-1) && a === run.attempt) {
            // On a partial rerun, retain earlier successful job durations for the same tree.
            const latest = new Map(jobs.toSorted((x, y) => x.attempt - y.attempt).map((j) => [j.name, j]));
            const t = timing([...latest.values()], Date.parse(run.created), Date.parse(run.end), selection);
            const peak = Math.max(
              ...Array.from(
                { length: a },
                (_, i) =>
                  timing(
                    jobs.filter((j) => j.attempt === i + 1),
                    0,
                    0,
                    selection
                  ).peak
              )
            );
            row.table = [
              id,
              ...(['lanes', 'workspaces', 'groups'] as const).map((k) =>
                selection[k].join(',') === FULL_SELECTION[k].join(',') ? 'ALL' : selection[k].join(',') || '-'
              ),
              t.model ?? 'n/a',
              t.actual,
              peak,
              t.unpriced.join(',') || '-'
            ].join(' | ');
          }
        } catch (e) {
          row.errors.push(id + ' unresolved: ' + errorText(e));
        }
      }
    }
  } catch (e) {
    row.errors.push(prefix + ' inaccessible: ' + errorText(e));
  }
  return row;
}

export function exitStatus(rows: Row[]) {
  return rows.some((r) => r.missed || r.errors.length || !r.resolved) ? 1 : 0;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      repo: { type: 'string' },
      base: { type: 'string', default: 'develop' },
      'last-merged': { type: 'string', default: '20' }
    }
  });
  const repo = values.repo;
  const count = Number(values['last-merged']);
  if (!repo || !Number.isInteger(count) || count < 1 || count > 20)
    throw new Error('Expected --repo owner/name [--base develop] [--last-merged 1..20]');
  const prs = await lastMerged(repo, values.base, count);
  const rows: Row[] = [];
  // Bound API and local Git fan-out independently of the history size.
  for (let i = 0; i < prs.length; i += 3)
    rows.push(...(await Promise.all(prs.slice(i, i + 3).map((pr) => replayPR(repo, pr)))));
  console.log(
    'Model (seconds), final CI run per PR: routing + longest observed selected job; legacy combined API/Web/check durations are proxies. Unpriced selected lanes have no duration in that run. Actual = workflow creation to completion (includes reruns).'
  );
  console.log('ALL by column: ' + JSON.stringify(FULL_SELECTION));
  console.log('PR/run/attempt | lanes | workspaces | groups | modeled | actual | observed peak | unpriced');
  for (const [i, r] of rows.entries())
    console.log(r.table === 'unavailable' ? '#' + String(prs[i]?.number) + ' | unavailable' : r.table);
  for (const r of rows) for (const line of [...r.details, ...r.errors]) console.log(line);
  const sum = (field: 'attempts' | 'resolved' | 'failed' | 'missed' | 'unmapped' | 'skipped' | 'cancelled') =>
    rows.reduce((n, r) => n + r[field], 0);
  console.log(
    `PRs=${prs.length}/${count}, fully resolved=${rows.filter((r) => !r.errors.length && r.resolved === r.attempts).length}; resolved attempts=${sum('resolved')}/${sum('attempts')}; failed jobs=${sum('failed')}, misses=${sum('missed')}, unmapped failures=${sum('unmapped')}; skipped/not run=${sum('skipped')}, cancelled=${sum('cancelled')}; inaccessible/unresolved cases=${rows.reduce((n, r) => n + r.errors.length, 0)}`
  );
  if (!sum('failed')) console.log('No observed failures: inconclusive for omission detection.');
  process.exitCode = prs.length === count ? exitStatus(rows) : 1;
}
