#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { Type, type Static, type TProperties, type TSchema } from 'typebox';
import { Compile, type Validator } from 'typebox/compile';
import { firstMismatch } from '../../packages/shared/src/contracts/http.ts';
import { isArray } from '../../packages/shared/src/guards.ts';

import { judgePatch, measurePatch } from './g08-patch.mts';

const DEFAULT_THRESHOLDS = 'config/coverage/release-250-thresholds.json';
const BUSINESS_EXTENSIONS = /\.(?:[cm]?[jt]s|vue)$/;
// v1 did not collect .mts or .cts, even inside its admission prefix.
const V1_EXTENSIONS = /\.(?:js|mjs|cjs|ts|vue)$/;
const BRANCH_METRIC = 'node-v8-branch';

// The shapes of the JSON files this gate reads, checked once when they are read.
const Percentage = Type.Union([Type.Number(), Type.Object({ pct: Type.Optional(Type.Number()) })]);
type Percentage = Static<typeof Percentage> | undefined;

const Paths = Type.Array(Type.String());

const StrictBranchGroup = Type.Object({
  name: Type.String(),
  enforcement: Type.String(),
  paths: Type.Optional(Paths),
  pathPatterns: Type.Optional(Paths)
});
type StrictBranchGroup = Static<typeof StrictBranchGroup>;

const CoverageThresholds = Type.Object({
  schemaVersion: Type.Number(),
  release: Type.String(),
  branchMetric: Type.String(),
  businessPathPatterns: Paths,
  ignoredPathPatterns: Paths,
  strictBranchPaths: Type.Optional(Paths),
  strictBranchGroups: Type.Array(StrictBranchGroup),
  strictBranchMinimum: Type.Number(),
  changedBusinessCode: Type.Object({ line: Type.Number(), branch: Type.Number() }),
  pooledBusinessCode: Type.Optional(Type.Object({ pathPatterns: Paths, line: Type.Number(), branch: Type.Number() })),
  baseline: Type.Object({
    artifact: Type.String(),
    measuredAt: Type.String(),
    total: Type.Optional(Type.Object({ lines: Type.Optional(Percentage), branches: Type.Optional(Percentage) }))
  }),
  baselinePolicy: Type.Optional(
    Type.Object({
      mode: Type.Optional(Type.String()),
      initialAdoption: Type.Optional(
        Type.Object({ baseConfigAbsent: Type.Optional(Type.Boolean()), reason: Type.Optional(Type.Unknown()) })
      )
    })
  )
});
export type CoverageThresholds = Static<typeof CoverageThresholds>;

// null means no observed denominator, not perfect coverage. Policy floors are
// still numbers; a missing percentage or an unexplained null is not evidence.
const MeasuredPercentage = Type.Union([
  Percentage,
  Type.Object({ total: Type.Literal(0), covered: Type.Literal(0), pct: Type.Null() })
]);
type MeasuredPercentage = Static<typeof MeasuredPercentage> | undefined;

const CoverageDetails = Type.Object({
  lines: Type.Array(Type.Object({ line: Type.Number(), covered: Type.Boolean() })),
  branches: Type.Array(Type.Object({ startLine: Type.Number(), endLine: Type.Number(), covered: Type.Boolean() }))
});
export type CoverageDetails = Static<typeof CoverageDetails>;

const CoverageSummary = Type.Object({
  schemaVersion: Type.Optional(Type.Number()),
  release: Type.Optional(Type.String()),
  meta: Type.Optional(
    Type.Object({
      measured: Type.Optional(Type.Boolean()),
      engine: Type.Optional(Type.String()),
      branchMetric: Type.Optional(Type.String())
    })
  ),
  total: Type.Optional(
    Type.Object({ lines: Type.Optional(MeasuredPercentage), branches: Type.Optional(MeasuredPercentage) })
  ),
  files: Type.Record(
    Type.String(),
    Type.Object({
      lines: Type.Optional(MeasuredPercentage),
      branches: Type.Optional(MeasuredPercentage),
      loaded: Type.Optional(Type.Boolean()),
      details: Type.Optional(CoverageDetails)
    })
  )
});
export type CoverageSummary = Static<typeof CoverageSummary>;

export type FileCoverage = {
  loaded: boolean | undefined;
  lines: number | null;
  branches: number | null;
  details: CoverageDetails | undefined;
};

const V8Range = Type.Object({ startOffset: Type.Number(), endOffset: Type.Number(), count: Type.Number() });
const V8Script = Type.Object({
  url: Type.Optional(Type.Unknown()),
  functions: Type.Optional(
    Type.Array(Type.Object({ functionName: Type.Optional(Type.String()), ranges: Type.Optional(Type.Array(V8Range)) }))
  )
});
type V8Script = Static<typeof V8Script>;
// Compiled: a coverage run reads a few hundred megabytes of V8 JSON.
const V8Coverage = Compile(Type.Object({ result: Type.Optional(Type.Array(V8Script)) }));
const ThresholdsFile = Compile(CoverageThresholds);
const SummaryFile = Compile(CoverageSummary);

type AccumulatedRange = { startOffset: number; endOffset: number; isFunctionRoot: boolean; covered: boolean };
type Accumulator = {
  repoPath: string;
  source: string;
  ranges: Map<string, AccumulatedRange>;
  functions: Map<string, { executedSamples: number; rangeKeys: Set<string> }>;
  seenInCoverage: boolean;
};

type SourceLine = { start: number; end: number; text: string };
type FileExists = (filePath: string) => boolean;

type RatchetOptions = {
  baseThresholds?: CoverageThresholds | undefined;
  baseThresholdsAbsent?: boolean;
  fileExists?: FileExists;
};

function readJson<T>(filePath: string, label: string, validator: Validator<TProperties, TSchema, T>): T {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Unable to read ${label} JSON at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  if (validator.Check(value)) return value;
  throw new Error(`Unexpected ${label} JSON at ${filePath}: ${firstMismatch(validator.Type(), value)}`);
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(argv: string[]) {
  const args = {
    thresholds: DEFAULT_THRESHOLDS,
    coverage: '',
    report: '',
    v8Dir: '',
    out: '',
    changedFiles: '',
    changedDiff: '',
    baseThresholds: '',
    baseThresholdsAbsent: false,
    collectOnly: false,
    root: process.cwd()
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--thresholds') args.thresholds = argv[++index] ?? '';
    else if (arg === '--coverage') args.coverage = argv[++index] ?? '';
    else if (arg === '--report') args.report = argv[++index] ?? '';
    else if (arg === '--v8-dir') args.v8Dir = argv[++index] ?? '';
    else if (arg === '--out') args.out = argv[++index] ?? '';
    else if (arg === '--changed-files') args.changedFiles = argv[++index] ?? '';
    else if (arg === '--changed-diff') args.changedDiff = argv[++index] ?? '';
    else if (arg === '--base-thresholds') args.baseThresholds = argv[++index] ?? '';
    else if (arg === '--base-thresholds-absent') args.baseThresholdsAbsent = true;
    else if (arg === '--collect-only') args.collectOnly = true;
    else if (arg === '--root') args.root = argv[++index] ?? '';
    else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage:',
          '  node scripts/coverage/check-release-250-coverage.mts --coverage <summary.json> [--report <patch-report.json>] [--changed-files <paths.txt>] [--changed-diff <patch.diff>] (--base-thresholds <base.json>|--base-thresholds-absent)',
          '  node scripts/coverage/check-release-250-coverage.mts --v8-dir <NODE_V8_COVERAGE dir> --out <summary.json> --collect-only'
        ].join('\n')
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.coverage && !args.v8Dir) throw new Error('--coverage or --v8-dir is required');
  if (args.coverage && args.v8Dir) throw new Error('--coverage and --v8-dir are mutually exclusive');
  if (args.v8Dir && !args.out) throw new Error('--out is required with --v8-dir');
  if (args.collectOnly && !args.v8Dir) throw new Error('--collect-only requires --v8-dir');
  if (args.baseThresholds && args.baseThresholdsAbsent) {
    throw new Error('--base-thresholds and --base-thresholds-absent are mutually exclusive');
  }
  return args;
}

function normalizePath(value: string | undefined) {
  return (value || '').split(path.sep).join('/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function toRepoPath(filePath: string, root: string) {
  const relative = path.relative(root, path.resolve(filePath));
  if (relative.startsWith('..') || path.isAbsolute(relative)) return '';
  return normalizePath(relative);
}

function pct(value: Percentage, label: string): number {
  const percentage = typeof value === 'number' ? value : value?.pct;
  if (typeof percentage !== 'number' || !Number.isFinite(percentage))
    throw new Error(`Coverage metric ${label} must provide a numeric percentage`);
  return percentage;
}

function metric(covered: number, total: number) {
  if (total === 0) return { total: 0, covered: 0, skipped: 0, pct: null } as const;
  return { total, covered, skipped: 0, pct: Number(((covered / total) * 100).toFixed(2)) };
}

function assertStringArray(value: unknown, label: string) {
  assert.ok(isArray(value), `${label} must be an array`);
  for (const item of value) assert.equal(typeof item, 'string', `${label} entries must be strings`);
}

function validateThresholds(thresholds: CoverageThresholds) {
  assert.ok([1, 2].includes(thresholds.schemaVersion), 'threshold schemaVersion must be 1 or 2');
  assert.equal(thresholds.release, '2.5.0', 'threshold release must be 2.5.0');
  assert.equal(thresholds.branchMetric, BRANCH_METRIC, `branchMetric must be ${BRANCH_METRIC}`);
  assertStringArray(thresholds.businessPathPatterns, 'businessPathPatterns');
  assertStringArray(thresholds.ignoredPathPatterns, 'ignoredPathPatterns');
  assertStringArray(thresholds.strictBranchPaths ?? [], 'strictBranchPaths');
  assert.ok(Array.isArray(thresholds.strictBranchGroups), 'strictBranchGroups must be an array');
  for (const group of thresholds.strictBranchGroups) {
    assert.equal(typeof group.name, 'string', 'strictBranchGroups[].name is required');
    assert.equal(group.enforcement, 'on-changed', 'strict branch groups must use on-changed enforcement');
    assertStringArray(group.paths ?? [], `${group.name}.paths`);
    assertStringArray(group.pathPatterns ?? [], `${group.name}.pathPatterns`);
  }
  assert.equal(typeof thresholds.baseline?.artifact, 'string', 'baseline.artifact is required');
  assert.ok(
    Number.isFinite(Date.parse(thresholds.baseline?.measuredAt)),
    'baseline.measuredAt must be an ISO timestamp'
  );
  if (thresholds.schemaVersion === 1) {
    assert.equal(thresholds.pooledBusinessCode, undefined, 'v1 cannot pool formerly per-file coverage');
    pct(thresholds.baseline.total?.lines, 'baseline.total.lines');
    pct(thresholds.baseline.total?.branches, 'baseline.total.branches');
  } else {
    assert.equal(thresholds.baseline.total, undefined, 'v2 has no global floors');
    const pool = thresholds.pooledBusinessCode;
    assert.ok(pool, 'v2 must define pooledBusinessCode');
    assertStringArray(pool.pathPatterns, 'pooledBusinessCode.pathPatterns');
    pct(pool.line, 'pooledBusinessCode.line');
    pct(pool.branch, 'pooledBusinessCode.branch');
    for (const root of ['apps/api/src/', 'packages/shared/src/'])
      assert.ok(pool.pathPatterns.includes(root), `v2 must measure ${root} in pooledBusinessCode`);
  }
  pct(thresholds.changedBusinessCode?.line, 'changedBusinessCode.line');
  pct(thresholds.changedBusinessCode?.branch, 'changedBusinessCode.branch');
  pct(thresholds.strictBranchMinimum, 'strictBranchMinimum');
}

function exclusionReason(file: string, thresholds: CoverageThresholds) {
  for (const entry of thresholds.ignoredPathPatterns.map(normalizePath)) {
    if (entry === '.d.ts') {
      if (/\.d\.[cm]?ts$/.test(file)) return 'TypeScript declaration';
    } else if (entry.startsWith('/') && entry.endsWith('/') && file.includes(entry)) {
      return entry === '/migrations/'
        ? 'migration (verified by migration/rollback tests)'
        : `policy directory: ${entry}`;
    } else if (BUSINESS_EXTENSIONS.test(entry)) {
      if (file === entry)
        return entry === 'packages/shared/src/emoji.ts' ? 'generated Unicode data' : `policy file: ${entry}`;
    } else if (file.includes(entry)) return `policy exclusion: ${entry}`;
  }
  return BUSINESS_EXTENSIONS.test(file) ? undefined : 'non-code asset';
}

function matchesPrefix(file: string, prefixes: string[]) {
  return prefixes.some((prefix) => file.startsWith(normalizePath(prefix)));
}

function measuredPrefixes(thresholds: CoverageThresholds) {
  return [...thresholds.businessPathPatterns, ...(thresholds.pooledBusinessCode?.pathPatterns ?? [])];
}

function isPooledBusinessFile(file: string, thresholds: CoverageThresholds) {
  return (
    matchesPrefix(file, thresholds.pooledBusinessCode?.pathPatterns ?? []) &&
    !(V1_EXTENSIONS.test(file) && matchesPrefix(file, thresholds.businessPathPatterns))
  );
}

function isBusinessFile(filePath: string, thresholds: CoverageThresholds) {
  const normalized = normalizePath(filePath);
  return matchesPrefix(normalized, measuredPrefixes(thresholds)) && !exclusionReason(normalized, thresholds);
}

function businessInventory(root: string, thresholds: CoverageThresholds) {
  // Read the checkout, not ignored developer data or transient build products.
  // Standalone fixture directories have no Git metadata.
  const prefixes = measuredPrefixes(thresholds);
  const directories = [
    ...new Set(prefixes.map(normalizePath).map((p) => (p.endsWith('/') ? p : path.posix.dirname(p))))
  ];
  const paths = fs.existsSync(path.join(root, '.git'))
    ? execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...directories], {
        cwd: root,
        encoding: 'utf8'
      }).split('\0')
    : fs
        .globSync('**/*', { cwd: root, exclude: ['**/node_modules/**'], withFileTypes: true })
        .filter((entry) => !entry.isDirectory())
        .map((entry) => toRepoPath(path.join(entry.parentPath, entry.name), root));
  const files: string[] = [];
  const excludedFiles: { path: string; reason: string }[] = [];
  for (const file of paths.sort()) {
    if (!matchesPrefix(file, prefixes) || !fs.existsSync(path.join(root, file))) continue;
    const reason = exclusionReason(file, thresholds);
    if (reason) excludedFiles.push({ path: file, reason });
    else files.push(file);
  }
  return { files, excludedFiles };
}

function measuredPct(value: MeasuredPercentage, label: string) {
  if (typeof value === 'object' && value.pct === null) {
    assert.ok('total' in value && value.total === 0 && value.covered === 0, `Invalid empty metric: ${label}`);
    return null;
  }
  return pct(typeof value === 'number' ? value : value?.pct, label);
}

function normalizeFileCoverage(summary: CoverageSummary) {
  const files = new Map<string, FileCoverage>();
  for (const [filePath, coverage] of Object.entries(summary.files)) {
    if (filePath === 'total' || filePath === 'meta') continue;
    files.set(normalizePath(filePath), {
      loaded: coverage.loaded,
      lines: measuredPct(coverage.lines, `${filePath}.lines`),
      branches: measuredPct(coverage.branches, `${filePath}.branches`),
      details: coverage.details
    });
  }
  return files;
}

function globalFloors(policy: CoverageThresholds) {
  return {
    lines: pct(policy.baseline.total?.lines, 'baseline.total.lines'),
    branches: pct(policy.baseline.total?.branches, 'baseline.total.branches')
  };
}

function enforceBaselineRatchet(
  thresholds: CoverageThresholds,
  { baseThresholds, baseThresholdsAbsent, fileExists }: RatchetOptions
) {
  if (Boolean(baseThresholds) === Boolean(baseThresholdsAbsent)) {
    throw new Error(
      'Coverage enforcement requires exactly one trust mode: protected base thresholds or verified initial adoption'
    );
  }
  if (baseThresholds) {
    validateThresholds(baseThresholds);
    assert.ok(thresholds.schemaVersion >= baseThresholds.schemaVersion, 'Coverage policy version may not decrease');
    if (baseThresholds.schemaVersion === 1) {
      const base = globalFloors(baseThresholds);
      if (thresholds.schemaVersion === 2) {
        // This is the single reviewed migration, not permission to retire
        // arbitrary protected floors by bumping a version number.
        assert.deepEqual(base, { lines: 9.17, branches: 53.9 }, 'Unrecognized protected global floors for v1 -> v2');
      } else {
        const current = globalFloors(thresholds);
        if (current.lines < base.lines)
          throw new Error(`Configured line baseline decreased from protected base ${base.lines}% to ${current.lines}%`);
        if (current.branches < base.branches)
          throw new Error(
            `Configured ${BRANCH_METRIC} baseline decreased from protected base ${base.branches}% to ${current.branches}%`
          );
      }
    }
    if (normalizePath(thresholds.baseline.artifact) !== normalizePath(baseThresholds.baseline.artifact))
      throw new Error('Coverage artifact policy changed from protected base');
    if (thresholds.changedBusinessCode.line < baseThresholds.changedBusinessCode.line)
      throw new Error('changedBusinessCode.line may not decrease from protected base');
    if (thresholds.changedBusinessCode.branch < baseThresholds.changedBusinessCode.branch)
      throw new Error('changedBusinessCode.branch may not decrease from protected base');
    if (thresholds.pooledBusinessCode) {
      const pool = thresholds.pooledBusinessCode;
      // On first adoption the new pool inherits the trusted v1 patch floors.
      const base = baseThresholds.pooledBusinessCode ?? baseThresholds.changedBusinessCode;
      if (pool.line < base.line || pool.branch < base.branch)
        throw new Error('pooledBusinessCode thresholds may not decrease from protected base');
      assertPolicySuperset(
        pool.pathPatterns,
        baseThresholds.pooledBusinessCode?.pathPatterns ?? [],
        'pooledBusinessCode.pathPatterns',
        fileExists
      );
    }
    if (thresholds.strictBranchMinimum < baseThresholds.strictBranchMinimum)
      throw new Error('strictBranchMinimum may not decrease from protected base');
    assertPolicySuperset(
      thresholds.businessPathPatterns,
      baseThresholds.businessPathPatterns,
      'businessPathPatterns',
      fileExists
    );
    assertPolicySuperset(
      thresholds.strictBranchPaths ?? [],
      baseThresholds.strictBranchPaths ?? [],
      'strictBranchPaths',
      fileExists
    );
    assertNoNewIgnoredPatterns(thresholds.ignoredPathPatterns, baseThresholds.ignoredPathPatterns, fileExists);
    const currentGroups = new Map(thresholds.strictBranchGroups.map((group) => [group.name, group]));
    for (const baseGroup of baseThresholds.strictBranchGroups) {
      const group = currentGroups.get(baseGroup.name);
      if (!group) throw new Error(`Strict branch group removed from protected base: ${baseGroup.name}`);
      if (group.enforcement !== baseGroup.enforcement)
        throw new Error(`Strict branch group enforcement changed: ${baseGroup.name}`);
      assertPolicySuperset(group.paths ?? [], baseGroup.paths ?? [], `${baseGroup.name}.paths`, fileExists);
      assertPolicySuperset(
        group.pathPatterns ?? [],
        baseGroup.pathPatterns ?? [],
        `${baseGroup.name}.pathPatterns`,
        fileExists
      );
    }
    return 'protected-base-ratchet';
  }
  if (baseThresholdsAbsent) {
    const adoption = thresholds.baselinePolicy?.initialAdoption;
    if (
      adoption?.baseConfigAbsent !== true ||
      typeof adoption.reason !== 'string' ||
      adoption.reason.trim().length < 12
    ) {
      throw new Error('Initial coverage baseline adoption requires explicit baseConfigAbsent metadata and a reason');
    }
    return 'explicit-initial-adoption';
  }
}

// A module moved from .js to .ts keeps its protected-base policy through the
// .ts entry, but only once the .js file is really gone: renaming the policy
// entry alone must not unpolice a file that still exists. The move may also
// put the layer behind a dot (`media-job-repository.js` to
// `media-job.repository.ts`), the file naming G10-A05 asks for.
const LAYER_SUFFIX = /-(routes|service|repository|policy|module)$/;

function isRenamedToTypeScript(value: string, current: Set<string>, fileExists: FileExists) {
  if (!value.endsWith('.js') || fileExists(value)) return false;
  const stem = value.slice(0, -3);
  return current.has(`${stem}.ts`) || current.has(`${stem.replace(LAYER_SUFFIX, '.$1')}.ts`);
}

// The Svelte web kept its modules under apps/web/src/lib/; the Vue web keeps
// the same modules one level up. The entry carries over the same way, once the
// file under lib/ is gone.
const SVELTE_LIB = 'apps/web/src/lib/';

function isMovedOutOfSvelteLib(value: string, current: Set<string>, fileExists: FileExists) {
  if (!value.startsWith(SVELTE_LIB) || fileExists(value)) return false;
  return current.has(`apps/web/src/${value.slice(SVELTE_LIB.length)}`);
}

const WEB_ROOM_CLIENT = 'apps/web/src/features/room/client/';

function isMovedToCallEngine(value: string, current: Set<string>, fileExists: FileExists) {
  if (!value.startsWith(WEB_ROOM_CLIENT) || fileExists(value)) return false;
  return current.has(`packages/call/src/engine/${value.slice(WEB_ROOM_CLIENT.length)}`);
}

function assertPolicySuperset(
  currentValues: string[],
  baseValues: string[],
  label: string,
  fileExists: FileExists = fs.existsSync
) {
  const current = new Set(currentValues.map(normalizePath));
  for (const value of baseValues.map(normalizePath)) {
    if (
      current.has(value) ||
      isRenamedToTypeScript(value, current, fileExists) ||
      isMovedOutOfSvelteLib(value, current, fileExists) ||
      isMovedToCallEngine(value, current, fileExists)
    )
      continue;
    throw new Error(`${label} may not remove or narrow protected-base policy entry: ${value}`);
  }
}

// The same rename seen from the other side: a .ts exclusion replaces the
// .js/.mjs exclusion the base already had, once those files are gone.
function replacesIgnoredJavaScript(value: string, base: Set<string>, fileExists: FileExists) {
  if (!value.endsWith('.ts')) return false;
  const stem = value.slice(0, -3);
  const predecessors = [`${stem}.js`, `${stem}.mjs`].filter((candidate) => base.has(candidate));
  return predecessors.length > 0 && predecessors.every((candidate) => !fileExists(candidate));
}

function assertNoNewIgnoredPatterns(
  currentValues: string[],
  baseValues: string[],
  fileExists: FileExists = fs.existsSync
) {
  const base = new Set(baseValues.map(normalizePath));
  for (const value of currentValues.map(normalizePath)) {
    if (base.has(value) || replacesIgnoredJavaScript(value, base, fileExists)) continue;
    throw new Error(`ignoredPathPatterns may not add protected-base exclusions: ${value}`);
  }
}

function readChangedFiles(filePath: string) {
  if (!filePath) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => normalizePath(line.trim()))
    .filter(Boolean);
}

function readChangedLineMap(filePath: string, thresholds: CoverageThresholds) {
  const changed = new Map<string, Set<number>>();
  if (!filePath) return changed;
  let currentPath = '';
  let oldPath = '';
  const inPool = (name: string) => isBusinessFile(name, thresholds) && isPooledBusinessFile(name, thresholds);
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      currentPath = '';
      oldPath = /^diff --git a\/(.+) b\/\1$/.exec(line)?.[1] ?? '';
    } else if (line.startsWith('rename from ')) {
      oldPath = line.slice('rename from '.length);
    } else if (line.startsWith('rename to ') || line.startsWith('new mode ')) {
      // A move within the pool or a chmod changes no lines by itself. A
      // promotion from outside the pool keeps the whole-file fallback.
      const destination = line.startsWith('rename to ') ? line.slice('rename to '.length) : oldPath;
      if (inPool(oldPath) && inPool(destination)) changed.set(destination, new Set());
    } else if (line.startsWith('+++ ')) {
      currentPath = normalizePath(line.slice(4).replace(/^b\//, ''));
      if (currentPath === '/dev/null') currentPath = '';
      continue;
    }
    if (!currentPath || !line.startsWith('@@')) continue;
    const match = line.match(/\+(\d+)(?:,(\d+))?/);
    if (!match) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    const lines = changed.get(currentPath) ?? new Set();
    for (let number = start; number < start + count; number += 1) lines.add(number);
    changed.set(currentPath, lines);
  }
  return changed;
}

function matchesStrictGroup(filePath: string, group: StrictBranchGroup) {
  const normalized = normalizePath(filePath);
  return (
    (group.paths ?? []).map(normalizePath).includes(normalized) ||
    (group.pathPatterns ?? []).map(normalizePath).some((pattern) => normalized.includes(pattern))
  );
}

function strictBranchFiles(changedFiles: string[], thresholds: CoverageThresholds) {
  const strict = new Set((thresholds.strictBranchPaths ?? []).map(normalizePath));
  for (const filePath of changedFiles.map(normalizePath)) {
    if (thresholds.strictBranchGroups.some((group) => matchesStrictGroup(filePath, group))) strict.add(filePath);
  }
  return [...strict].sort();
}

function sourceLines(source: string) {
  const lines: SourceLine[] = [];
  let offset = 0;
  for (const text of source.split(/\n/)) {
    lines.push({ start: offset, end: offset + text.length, text });
    offset += text.length + 1;
  }
  return lines;
}

// Comments are trivia, not missing execution. Walk actual tokens so a comment
// delimiter in a string, regexp or template cannot hide the following code.
function measurableLines(accumulator: Accumulator, lines: SourceLine[]) {
  const { repoPath, source } = accumulator;
  const relevant = new Set<number>();
  // Strip mode preserves source offsets. Type-only lines in mixed modules
  // must not dilute an uncovered addition with fictitious executed lines.
  const runtimeSource = /\.[cm]?ts$/.test(repoPath) ? stripTypeScriptTypes(source) : source;
  const file = ts.createSourceFile(repoPath, runtimeSource, ts.ScriptTarget.Latest);
  const visit = (node: ts.Node) => {
    if (node.kind === ts.SyntaxKind.JSDoc) return;
    const children = node.getChildren(file);
    if (children.length) {
      children.forEach(visit);
      return;
    }
    const start = node.getStart(file);
    if (start >= node.end) return;
    const first = lineNumberAtOffset(lines, start) - 1;
    const last = lineNumberAtOffset(lines, node.end - 1) - 1;
    for (let i = first; i <= last; i++) {
      const text = lines[i]?.text.trim();
      if (text && text !== '{' && text !== '}') relevant.add(i);
    }
  };
  visit(file);
  return relevant;
}

function createAccumulator(repoPath: string, source: string): Accumulator {
  return { repoPath, source, ranges: new Map(), functions: new Map(), seenInCoverage: false };
}

function mergeScriptCoverage(accumulator: Accumulator, script: V8Script) {
  accumulator.seenInCoverage = true;
  // Node appends a `//# sourceURL=` trailer to type-stripped TypeScript, and its
  // length depends on how the module was loaded (file:// URL or plain path).
  // Clamping to the file keeps the same function one identity across processes.
  const sourceLength = accumulator.source.length;
  const clamp = (offset: number) => Math.min(offset, sourceLength);
  for (const fn of script.functions ?? []) {
    const ranges = (fn.ranges ?? []).map((range) => ({
      ...range,
      startOffset: clamp(range.startOffset),
      endOffset: clamp(range.endOffset)
    }));
    const functionRoot = ranges[0];
    if (!functionRoot) continue;
    const functionId = `${fn.functionName || '<anonymous>'}:${functionRoot.startOffset}:${functionRoot.endOffset}`;
    const functionState = accumulator.functions.get(functionId) ?? { executedSamples: 0, rangeKeys: new Set() };
    const currentRangeKeys = new Set(ranges.map((range) => `${functionId}:${range.startOffset}:${range.endOffset}`));
    if (functionRoot.count > 0) {
      for (const key of functionState.rangeKeys) {
        const range = accumulator.ranges.get(key);
        if (range && !currentRangeKeys.has(key)) range.covered = true;
      }
    }
    for (const [index, range] of ranges.entries()) {
      const key = `${functionId}:${range.startOffset}:${range.endOffset}`;
      const previous = accumulator.ranges.get(key);
      accumulator.ranges.set(key, {
        startOffset: range.startOffset,
        endOffset: range.endOffset,
        isFunctionRoot: index === 0,
        covered: Boolean(previous?.covered || range.count > 0 || (!previous && functionState.executedSamples > 0))
      });
      functionState.rangeKeys.add(key);
    }
    if (functionRoot.count > 0) functionState.executedSamples += 1;
    accumulator.functions.set(functionId, functionState);
  }
}

function serializeAccumulator(accumulator: Accumulator) {
  const ranges = [...accumulator.ranges.values()];
  let lineTotal = 0;
  let lineCovered = 0;
  const lines = sourceLines(accumulator.source);
  const relevant = measurableLines(accumulator, lines);
  const lineDetails: CoverageDetails['lines'] = [];
  for (const [lineIndex, line] of lines.entries()) {
    if (!relevant.has(lineIndex)) continue;
    lineTotal += 1;
    const end = Math.max(line.start + 1, line.end);
    const candidates = ranges.filter((range) => range.startOffset < end && range.endOffset > line.start);
    let covered = false;
    if (candidates.length) {
      const shortest = Math.min(...candidates.map((range) => range.endOffset - range.startOffset));
      covered = candidates.some((range) => range.covered && range.endOffset - range.startOffset === shortest);
      if (covered) lineCovered += 1;
    }
    lineDetails.push({ line: lineIndex + 1, covered });
  }
  const branchRanges = ranges.filter((range) => !range.isFunctionRoot);
  return {
    loaded: accumulator.seenInCoverage,
    lines: metric(lineCovered, lineTotal),
    branches: metric(branchRanges.filter((range) => range.covered).length, branchRanges.length),
    details: {
      lines: lineDetails,
      branches: branchRanges.map((range) => ({
        startLine: lineNumberAtOffset(lines, range.startOffset),
        endLine: lineNumberAtOffset(lines, Math.max(range.startOffset, range.endOffset - 1)),
        covered: range.covered
      }))
    }
  };
}

function lineNumberAtOffset(lines: SourceLine[], offset: number) {
  let low = 0;
  let high = lines.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const line = lines[middle];
    if (!line) break;
    if (offset < line.start) high = middle - 1;
    else if (offset > line.end) low = middle + 1;
    else return middle + 1;
  }
  return Math.min(lines.length, low + 1);
}

export function collectV8Coverage({
  v8Dir,
  thresholds,
  root = process.cwd(),
  measuredAt = new Date().toISOString()
}: {
  v8Dir: string;
  thresholds: CoverageThresholds;
  root?: string;
  measuredAt?: string;
}) {
  validateThresholds(thresholds);
  const absoluteRoot = path.resolve(root);
  const accumulators = new Map<string, Accumulator>();
  const inventory = businessInventory(absoluteRoot, thresholds);
  for (const repoPath of inventory.files) {
    accumulators.set(repoPath, createAccumulator(repoPath, fs.readFileSync(path.join(absoluteRoot, repoPath), 'utf8')));
  }
  let observed = false;
  if (!fs.existsSync(v8Dir)) throw new Error(`V8 coverage directory does not exist: ${v8Dir}`);
  for (const entry of fs
    .readdirSync(v8Dir)
    .filter((name) => name.endsWith('.json'))
    .sort()) {
    const payload = readJson(path.join(v8Dir, entry), 'V8 coverage', V8Coverage);
    for (const script of payload.result ?? []) {
      // Most scripts arrive as file:// URLs; a TypeScript module that CommonJS
      // require() loads is reported by its plain filesystem path instead.
      if (typeof script.url !== 'string' || !script.functions?.some((fn) => fn.ranges?.length)) continue;
      const absolute = script.url.startsWith('file://')
        ? fileURLToPath(script.url)
        : path.isAbsolute(script.url)
          ? script.url
          : '';
      if (!absolute) continue;
      const repoPath = toRepoPath(absolute, absoluteRoot);
      const accumulator = accumulators.get(repoPath);
      if (!accumulator) continue;
      observed ||= script.functions.some((fn) => fn.ranges?.some((r) => r.count > 0 && r.endOffset > r.startOffset));
      mergeScriptCoverage(accumulator, script);
    }
  }
  if (!observed) throw new Error('No in-scope V8 execution evidence in ' + v8Dir);
  const files = Object.fromEntries(
    [...accumulators.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([repoPath, accumulator]) => [repoPath, serializeAccumulator(accumulator)])
  );
  const totals = Object.values(files).reduce(
    (result, coverage) => ({
      lineCovered: result.lineCovered + coverage.lines.covered,
      lineTotal: result.lineTotal + coverage.lines.total,
      branchCovered: result.branchCovered + coverage.branches.covered,
      branchTotal: result.branchTotal + coverage.branches.total
    }),
    { lineCovered: 0, lineTotal: 0, branchCovered: 0, branchTotal: 0 }
  );
  return {
    schemaVersion: 2,
    release: '2.5.0',
    meta: {
      measured: true,
      engine: 'node-v8-coverage',
      branchMetric: BRANCH_METRIC,
      branchMetricLabel: 'V8 block branch coverage',
      semantics:
        'branches is deduplicated V8 function/block range coverage from NODE_V8_COVERAGE, not Istanbul AST branch coverage',
      documentation: 'https://nodejs.org/api/cli.html#node_v8_coveragedir',
      root: absoluteRoot,
      measuredAt,
      sourceFileCount: inventory.files.length,
      unloadedFiles: inventory.files.filter((file) => !accumulators.get(file)?.seenInCoverage),
      excludedFiles: inventory.excludedFiles
    },
    total: {
      lines: metric(totals.lineCovered, totals.lineTotal),
      branches: metric(totals.branchCovered, totals.branchTotal)
    },
    files
  };
}

function coverageReport({
  coverageSummary,
  thresholds,
  changedFiles = [],
  changedLineMap = new Map(),
  coveragePath = '',
  baseThresholds,
  baseThresholdsAbsent = false,
  fileExists = fs.existsSync
}: {
  coverageSummary: CoverageSummary;
  thresholds: CoverageThresholds;
  changedFiles?: string[];
  changedLineMap?: Map<string, Set<number>>;
  coveragePath?: string;
  baseThresholds?: CoverageThresholds | undefined;
  baseThresholdsAbsent?: boolean;
  fileExists?: FileExists;
}) {
  validateThresholds(thresholds);
  assert.ok(
    coverageSummary.schemaVersion === 2 || (thresholds.schemaVersion === 1 && coverageSummary.schemaVersion === 1),
    'v2 policy requires a freshly collected v2 coverage summary'
  );
  assert.equal(coverageSummary.release, '2.5.0', 'coverage summary release must be 2.5.0');
  assert.equal(coverageSummary.meta?.measured, true, 'coverage summary must be produced from measured coverage');
  assert.equal(coverageSummary.meta?.engine, 'node-v8-coverage', 'coverage summary must use node-v8-coverage');
  assert.equal(
    coverageSummary.meta?.branchMetric,
    BRANCH_METRIC,
    `coverage summary branchMetric must be ${BRANCH_METRIC}`
  );
  const ratchetMode = enforceBaselineRatchet(thresholds, { baseThresholds, baseThresholdsAbsent, fileExists });
  const files = normalizeFileCoverage(coverageSummary);
  const total = {
    lines: measuredPct(coverageSummary.total?.lines, 'total.lines'),
    branches: measuredPct(coverageSummary.total?.branches, 'total.branches')
  };
  const artifact = normalizePath(thresholds.baseline.artifact);
  if (coveragePath && normalizePath(coveragePath) !== artifact)
    throw new Error(
      `Coverage artifact path ${normalizePath(coveragePath)} does not match baseline artifact ${artifact}`
    );
  if (thresholds.schemaVersion === 1) {
    const baseline = globalFloors(thresholds);
    if ((total.lines ?? 0) < baseline.lines)
      throw new Error(`Total line coverage regressed from ${baseline.lines}% to ${total.lines ?? 'N/A'}`);
    if ((total.branches ?? 0) < baseline.branches)
      throw new Error(
        `Total ${BRANCH_METRIC} coverage regressed from ${baseline.branches}% to ${total.branches ?? 'N/A'}`
      );
  }

  const checkedChangedFiles = [...new Set(changedFiles.map(normalizePath))].filter((file) =>
    isBusinessFile(file, thresholds)
  );
  const { patch, pooled, failures } = judgePatch(
    checkedChangedFiles.map((file) =>
      measurePatch(
        file,
        isPooledBusinessFile(file, thresholds) ? 'pooled' : 'per-file',
        files.get(file),
        changedLineMap.get(file),
        thresholds.schemaVersion
      )
    ),
    thresholds.changedBusinessCode,
    thresholds.pooledBusinessCode
  );

  const checkedStrictPaths = strictBranchFiles(changedFiles, thresholds);
  for (const strictPath of checkedStrictPaths) {
    const file = files.get(strictPath);
    if (!file) {
      failures.push(`Changed strict file is missing from coverage summary: ${strictPath}`);
      continue;
    }
    if (file.branches === null && file.loaded !== true)
      failures.push(`Changed strict file has no measured branch evidence: ${strictPath}`);
    if (file.branches !== null && file.branches < thresholds.strictBranchMinimum) {
      failures.push(
        `${strictPath} requires ${thresholds.strictBranchMinimum}% ${BRANCH_METRIC} coverage, saw ${file.branches.toFixed(2)}%`
      );
    }
  }

  return {
    release: thresholds.release,
    total,
    ratchetMode,
    ok: failures.length === 0,
    failures,
    pooled,
    checkedChangedFiles: checkedChangedFiles.length,
    patch,
    strictBranchPaths: checkedStrictPaths.length,
    coverageDigest: `sha256:${crypto.createHash('sha256').update(JSON.stringify(coverageSummary)).digest('hex')}`
  };
}

class CoverageFailure extends Error {
  readonly report: ReturnType<typeof coverageReport>;
  constructor(report: ReturnType<typeof coverageReport>) {
    super(report.failures.join('\n'));
    this.report = report;
  }
}

export function checkCoverage(options: Parameters<typeof coverageReport>[0]) {
  const report = coverageReport(options);
  if (!report.ok) throw new CoverageFailure(report);
  return report;
}

if (import.meta.main) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const thresholds = readJson(args.thresholds, 'thresholds', ThresholdsFile);
    let coverageSummary: CoverageSummary;
    let coveragePath = args.coverage;
    if (args.v8Dir) {
      coverageSummary = collectV8Coverage({ v8Dir: args.v8Dir, thresholds, root: args.root });
      writeJson(args.out, coverageSummary);
      coveragePath = args.out;
      if (args.collectOnly) {
        console.log(JSON.stringify({ ok: true, collected: true, total: coverageSummary.total }, null, 2));
        process.exit(0);
      }
    } else {
      coverageSummary = readJson(args.coverage, 'coverage summary', SummaryFile);
    }
    const result = coverageReport({
      coverageSummary,
      thresholds,
      changedFiles: readChangedFiles(args.changedFiles),
      changedLineMap: readChangedLineMap(args.changedDiff, thresholds),
      coveragePath,
      baseThresholds: args.baseThresholds
        ? readJson(args.baseThresholds, 'protected base thresholds', ThresholdsFile)
        : undefined,
      baseThresholdsAbsent: args.baseThresholdsAbsent
    });
    if (args.report) writeJson(args.report, result);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) throw new CoverageFailure(result);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
