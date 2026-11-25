import assert from 'node:assert/strict';
import type { CoverageDetails, FileCoverage } from './check-release-250-coverage.mts';

type Counts = { covered: number; total: number };
type Metric = { covered: number | null; total: number | null; pct: number | null };
type Floors = { line: number; branch: number };
type Row = { path: string; scope: 'per-file' | 'pooled'; loaded: boolean | undefined; lines: Metric; branches: Metric };

function metric({ covered, total }: Counts) {
  return { covered, total, pct: total ? Number(((covered / total) * 100).toFixed(2)) : null };
}

function measure(entries: { covered: boolean }[], loaded: boolean | undefined) {
  return metric({
    covered: loaded === false ? 0 : entries.filter((entry) => entry.covered).length,
    total: entries.length
  });
}

function patchDetails(details: CoverageDetails, changed?: Set<number>) {
  // A pure rename has no destination hunk: keep the existing whole-file check.
  if (!changed) return details;
  const lines = details.lines.filter(({ line }) => changed.has(line));
  return {
    lines,
    branches: details.branches.filter(({ startLine, endLine }) =>
      lines.some(({ line }) => startLine <= line && line <= endLine)
    )
  };
}

export function measurePatch(
  path: string,
  scope: Row['scope'],
  file: FileCoverage | undefined,
  changed: Set<number> | undefined,
  version: number
): Row {
  if (!file) throw new Error(`Changed business file is missing from coverage summary: ${path}`);
  if (version === 2 && file.loaded === undefined)
    throw new Error(`Missing V8 load evidence for business file: ${path}`);
  if (!file.details) {
    if (version === 2 || changed)
      throw new Error(`Changed-line coverage details are missing for business file: ${path}`);
    // A v1 percentage-only summary can support a per-file verdict, never a pool.
    const legacy = (pct: number | null) => ({ covered: null, total: null, pct });
    return { path, scope, loaded: file.loaded, lines: legacy(file.lines), branches: legacy(file.branches) };
  }
  const details = patchDetails(file.details, changed);
  return {
    path,
    scope,
    loaded: file.loaded,
    lines: measure(details.lines, file.loaded),
    branches: measure(details.branches, file.loaded)
  };
}

function worst(row: Row) {
  const value = ({ covered, total, pct }: Metric) =>
    total && covered !== null ? (100 * covered) / total : (pct ?? Infinity);
  return Math.min(value(row.lines), value(row.branches));
}

function compareRows(a: Row, b: Row) {
  return worst(a) - worst(b) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function below(metric: Metric, minimum: number, exact: boolean) {
  return exact && metric.covered !== null && metric.total !== null
    ? metric.covered * 100 < minimum * metric.total
    : metric.pct !== null && metric.pct < minimum;
}

function misses(label: string, row: { lines: Metric; branches: Metric }, floors: Floors, exact: boolean) {
  const failures: string[] = [];
  for (const [name, value, minimum] of [
    ['line', row.lines, floors.line],
    ['node-v8-branch', row.branches, floors.branch]
  ] as const) {
    if (!below(value, minimum, exact)) continue;
    // At the rounding boundary, show the counts rather than "90% is below 90%".
    const observed = value.pct === minimum ? `${value.covered}/${value.total}` : `${value.pct?.toFixed(2)}%`;
    failures.push(`${label} changed ${name} coverage ${observed} is below ${minimum}%`);
  }
  return failures;
}

export function judgePatch(rows: Row[], perFile: Floors, pool: Floors | undefined) {
  const patch = rows.toSorted(compareRows);
  const failures: string[] = [];
  const lines = { covered: 0, total: 0 };
  const branches = { covered: 0, total: 0 };
  let files = 0;
  for (const row of patch) {
    if (row.scope === 'per-file') {
      failures.push(...misses(row.path, row, perFile, false));
      continue;
    }
    assert.ok(pool, 'No pooled policy for changed source');
    for (const [sum, count] of [
      [lines, row.lines],
      [branches, row.branches]
    ] as const) {
      assert.ok(count.covered !== null && count.total !== null, 'Pooled coverage requires counts');
      sum.covered += count.covered;
      sum.total += count.total;
    }
    if (row.lines.total || row.branches.total) files++;
  }
  const counts = { lines: metric(lines), branches: metric(branches) };
  const pooledFailures = pool ? misses('Pooled patch', counts, pool, true) : [];
  const verdict = !files ? 'N/A' : pooledFailures.length ? 'fail' : 'pass';
  return { patch, pooled: { ...counts, files, verdict }, failures: [...failures, ...pooledFailures] };
}
