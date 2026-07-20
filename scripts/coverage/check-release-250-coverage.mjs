#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_THRESHOLDS = "config/coverage/release-250-thresholds.json";
const BUSINESS_EXTENSIONS = /\.(?:js|mjs|cjs|ts|svelte)$/;
const BRANCH_METRIC = "node-v8-branch";

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${label} JSON at ${filePath}: ${error.message}`);
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(argv) {
  const args = {
    thresholds: DEFAULT_THRESHOLDS,
    coverage: "",
    v8Dir: "",
    out: "",
    changedFiles: "",
    baseThresholds: "",
    baseThresholdsAbsent: false,
    root: process.cwd()
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--thresholds") args.thresholds = argv[++index];
    else if (arg === "--coverage") args.coverage = argv[++index];
    else if (arg === "--v8-dir") args.v8Dir = argv[++index];
    else if (arg === "--out") args.out = argv[++index];
    else if (arg === "--changed-files") args.changedFiles = argv[++index];
    else if (arg === "--base-thresholds") args.baseThresholds = argv[++index];
    else if (arg === "--base-thresholds-absent") args.baseThresholdsAbsent = true;
    else if (arg === "--root") args.root = argv[++index];
    else if (arg === "--help" || arg === "-h") {
      console.log([
        "Usage:",
        "  node scripts/coverage/check-release-250-coverage.mjs --coverage <summary.json> [--changed-files <paths.txt>] [--base-thresholds <base.json>|--base-thresholds-absent]",
        "  node scripts/coverage/check-release-250-coverage.mjs --v8-dir <NODE_V8_COVERAGE dir> --out <summary.json>"
      ].join("\n"));
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.coverage && !args.v8Dir) throw new Error("--coverage or --v8-dir is required");
  if (args.coverage && args.v8Dir) throw new Error("--coverage and --v8-dir are mutually exclusive");
  if (args.v8Dir && !args.out) throw new Error("--out is required with --v8-dir");
  if (args.baseThresholds && args.baseThresholdsAbsent) {
    throw new Error("--base-thresholds and --base-thresholds-absent are mutually exclusive");
  }
  return args;
}

function normalizePath(value) {
  return String(value || "").split(path.sep).join("/").replace(/^\.\//, "").replace(/\/+/g, "/");
}

function toRepoPath(filePath, root) {
  const relative = path.relative(root, path.resolve(filePath));
  if (relative.startsWith("..") || path.isAbsolute(relative)) return "";
  return normalizePath(relative);
}

function pct(value, label) {
  const percentage = typeof value === "number" ? value : value?.pct;
  if (!Number.isFinite(percentage)) throw new Error(`Coverage metric ${label} must provide a numeric percentage`);
  return percentage;
}

function metric(covered, total) {
  return { total, covered, skipped: 0, pct: total === 0 ? 100 : Number(((covered / total) * 100).toFixed(2)) };
}

function assertStringArray(value, label) {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  for (const item of value) assert.equal(typeof item, "string", `${label} entries must be strings`);
}

function validateThresholds(thresholds) {
  assert.equal(thresholds.schemaVersion, 1, "threshold schemaVersion must be 1");
  assert.equal(thresholds.release, "2.5.0", "threshold release must be 2.5.0");
  assert.equal(thresholds.branchMetric, BRANCH_METRIC, `branchMetric must be ${BRANCH_METRIC}`);
  assertStringArray(thresholds.businessPathPatterns, "businessPathPatterns");
  assertStringArray(thresholds.ignoredPathPatterns, "ignoredPathPatterns");
  assertStringArray(thresholds.strictBranchPaths ?? [], "strictBranchPaths");
  assert.ok(Array.isArray(thresholds.strictBranchGroups), "strictBranchGroups must be an array");
  for (const group of thresholds.strictBranchGroups) {
    assert.equal(typeof group.name, "string", "strictBranchGroups[].name is required");
    assert.equal(group.enforcement, "on-changed", "strict branch groups must use on-changed enforcement");
    assertStringArray(group.paths ?? [], `${group.name}.paths`);
    assertStringArray(group.pathPatterns ?? [], `${group.name}.pathPatterns`);
  }
  assert.equal(typeof thresholds.baseline?.artifact, "string", "baseline.artifact is required");
  assert.ok(Number.isFinite(Date.parse(thresholds.baseline?.measuredAt)), "baseline.measuredAt must be an ISO timestamp");
  pct(thresholds.baseline.total?.lines, "baseline.total.lines");
  pct(thresholds.baseline.total?.branches, "baseline.total.branches");
  pct(thresholds.changedBusinessCode?.line, "changedBusinessCode.line");
  pct(thresholds.changedBusinessCode?.branch, "changedBusinessCode.branch");
  assertStringArray(thresholds.changedBusinessCode?.pathPatterns ?? [], "changedBusinessCode.pathPatterns");
}

function isBusinessFile(filePath, thresholds) {
  const normalized = normalizePath(filePath);
  return thresholds.businessPathPatterns.some((prefix) => normalized.startsWith(normalizePath(prefix)))
    && !thresholds.ignoredPathPatterns.some((pattern) => normalized.includes(normalizePath(pattern)))
    && BUSINESS_EXTENSIONS.test(normalized);
}

function listBusinessSourceFiles(root, thresholds) {
  const results = [];
  const roots = [...new Set(thresholds.businessPathPatterns.map((value) => normalizePath(value).split("/")[0]).filter(Boolean))];
  const visit = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (["node_modules", ".svelte-kit", "dist", "build"].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else {
        const repoPath = toRepoPath(absolute, root);
        if (isBusinessFile(repoPath, thresholds)) results.push(repoPath);
      }
    }
  };
  for (const directory of roots) visit(path.join(root, directory));
  return [...new Set(results)].sort();
}

function normalizeFileCoverage(summary) {
  const files = new Map();
  for (const [filePath, coverage] of Object.entries(summary.files ?? summary)) {
    if (filePath === "total" || filePath === "meta") continue;
    files.set(normalizePath(filePath), {
      lines: pct(coverage.lines, `${filePath}.lines`),
      branches: pct(coverage.branches, `${filePath}.branches`)
    });
  }
  return files;
}

function totalCoverage(summary, files) {
  if (summary.total) return { lines: pct(summary.total.lines, "total.lines"), branches: pct(summary.total.branches, "total.branches") };
  if (!files.size) throw new Error("Coverage summary contains no files");
  const values = [...files.values()];
  return {
    lines: Number((values.reduce((sum, file) => sum + file.lines, 0) / values.length).toFixed(2)),
    branches: Number((values.reduce((sum, file) => sum + file.branches, 0) / values.length).toFixed(2))
  };
}

function configuredBaseline(thresholds) {
  return {
    artifact: normalizePath(thresholds.baseline.artifact),
    lines: pct(thresholds.baseline.total?.lines, "baseline.total.lines"),
    branches: pct(thresholds.baseline.total?.branches, "baseline.total.branches")
  };
}

function enforceBaselineRatchet(thresholds, { baseThresholds, baseThresholdsAbsent }) {
  if (baseThresholds) {
    validateThresholds(baseThresholds);
    const current = configuredBaseline(thresholds);
    const base = configuredBaseline(baseThresholds);
    if (current.lines < base.lines) throw new Error(`Configured line baseline decreased from protected base ${base.lines}% to ${current.lines}%`);
    if (current.branches < base.branches) throw new Error(`Configured ${BRANCH_METRIC} baseline decreased from protected base ${base.branches}% to ${current.branches}%`);
    return "protected-base-ratchet";
  }
  if (baseThresholdsAbsent) {
    const adoption = thresholds.baselinePolicy?.initialAdoption;
    if (adoption?.baseConfigAbsent !== true || typeof adoption.reason !== "string" || adoption.reason.trim().length < 12) {
      throw new Error("Initial coverage baseline adoption requires explicit baseConfigAbsent metadata and a reason");
    }
    return "explicit-initial-adoption";
  }
  return "not-requested";
}

function readChangedFiles(filePath) {
  if (!filePath) return [];
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).map((line) => normalizePath(line.trim())).filter(Boolean);
}

function matchesStrictGroup(filePath, group) {
  const normalized = normalizePath(filePath);
  return (group.paths ?? []).map(normalizePath).includes(normalized)
    || (group.pathPatterns ?? []).map(normalizePath).some((pattern) => normalized.includes(pattern));
}

function strictBranchFiles(changedFiles, thresholds) {
  const strict = new Set((thresholds.strictBranchPaths ?? []).map(normalizePath));
  for (const filePath of changedFiles.map(normalizePath)) {
    if (thresholds.strictBranchGroups.some((group) => matchesStrictGroup(filePath, group))) strict.add(filePath);
  }
  return [...strict].sort();
}

function checkFileThreshold(filePath, coverage, minimums) {
  if (!coverage) throw new Error(`Changed business file is missing from coverage summary: ${filePath}`);
  if (coverage.lines < minimums.line) throw new Error(`${filePath} line coverage ${coverage.lines.toFixed(2)}% is below ${minimums.line}%`);
  if (coverage.branches < minimums.branch) throw new Error(`${filePath} ${BRANCH_METRIC} coverage ${coverage.branches.toFixed(2)}% is below ${minimums.branch}%`);
}

function sourceLines(source) {
  const lines = [];
  let offset = 0;
  for (const text of source.split(/\n/)) {
    lines.push({ start: offset, end: offset + text.length, text });
    offset += text.length + 1;
  }
  return lines;
}

function isRelevantLine(line) {
  const trimmed = line.trim();
  return Boolean(trimmed && trimmed !== "{" && trimmed !== "}" && !trimmed.startsWith("//") && !trimmed.startsWith("*"));
}

function createAccumulator(repoPath, source) {
  return { repoPath, source, ranges: new Map(), functions: new Map(), seenInCoverage: false };
}

function mergeScriptCoverage(accumulator, script) {
  accumulator.seenInCoverage = true;
  for (const fn of script.functions ?? []) {
    const ranges = fn.ranges ?? [];
    const functionRoot = ranges[0];
    if (!functionRoot) continue;
    const functionId = `${fn.functionName || "<anonymous>"}:${functionRoot.startOffset}:${functionRoot.endOffset}`;
    const functionState = accumulator.functions.get(functionId) ?? { executedSamples: 0, rangeKeys: new Set() };
    const currentRangeKeys = new Set(ranges.map((range) => `${functionId}:${range.startOffset}:${range.endOffset}`));
    if (functionRoot.count > 0) {
      for (const key of functionState.rangeKeys) {
        if (!currentRangeKeys.has(key)) accumulator.ranges.get(key).covered = true;
      }
    }
    for (let index = 0; index < ranges.length; index += 1) {
      const range = ranges[index];
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

function serializeAccumulator(accumulator) {
  const ranges = [...accumulator.ranges.values()];
  let lineTotal = 0;
  let lineCovered = 0;
  for (const line of sourceLines(accumulator.source)) {
    if (!isRelevantLine(line.text)) continue;
    lineTotal += 1;
    const end = Math.max(line.start + 1, line.end);
    const candidates = ranges.filter((range) => range.startOffset < end && range.endOffset > line.start);
    if (candidates.length) {
      const shortest = Math.min(...candidates.map((range) => range.endOffset - range.startOffset));
      if (candidates.some((range) => range.covered && range.endOffset - range.startOffset === shortest)) lineCovered += 1;
    }
  }
  const branchRanges = ranges.filter((range) => !range.isFunctionRoot);
  return {
    lines: metric(lineCovered, lineTotal),
    branches: branchRanges.length
      ? metric(branchRanges.filter((range) => range.covered).length, branchRanges.length)
      : metric(accumulator.seenInCoverage ? 0 : 0, accumulator.seenInCoverage ? 0 : 1)
  };
}

export function collectRelease250V8Coverage({ v8Dir, thresholds, root = process.cwd(), measuredAt = new Date().toISOString() }) {
  validateThresholds(thresholds);
  const absoluteRoot = path.resolve(root);
  const accumulators = new Map();
  for (const repoPath of listBusinessSourceFiles(absoluteRoot, thresholds)) {
    accumulators.set(repoPath, createAccumulator(repoPath, fs.readFileSync(path.join(absoluteRoot, repoPath), "utf8")));
  }
  if (!fs.existsSync(v8Dir)) throw new Error(`V8 coverage directory does not exist: ${v8Dir}`);
  for (const entry of fs.readdirSync(v8Dir).filter((name) => name.endsWith(".json")).sort()) {
    const payload = readJson(path.join(v8Dir, entry), "V8 coverage");
    for (const script of payload.result ?? []) {
      if (typeof script.url !== "string" || !script.url.startsWith("file://")) continue;
      const absolute = fileURLToPath(script.url);
      const repoPath = toRepoPath(absolute, absoluteRoot);
      if (!repoPath || !isBusinessFile(repoPath, thresholds) || !fs.existsSync(absolute)) continue;
      const accumulator = accumulators.get(repoPath) ?? createAccumulator(repoPath, fs.readFileSync(absolute, "utf8"));
      mergeScriptCoverage(accumulator, script);
      accumulators.set(repoPath, accumulator);
    }
  }
  const files = Object.fromEntries([...accumulators.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([repoPath, accumulator]) => [repoPath, serializeAccumulator(accumulator)]));
  const totals = Object.values(files).reduce((result, coverage) => ({
    lineCovered: result.lineCovered + coverage.lines.covered,
    lineTotal: result.lineTotal + coverage.lines.total,
    branchCovered: result.branchCovered + coverage.branches.covered,
    branchTotal: result.branchTotal + coverage.branches.total
  }), { lineCovered: 0, lineTotal: 0, branchCovered: 0, branchTotal: 0 });
  return {
    schemaVersion: 1,
    release: "2.5.0",
    meta: {
      measured: true,
      engine: "node-v8-coverage",
      branchMetric: BRANCH_METRIC,
      branchMetricLabel: "V8 block branch coverage",
      semantics: "branches is deduplicated V8 function/block range coverage from NODE_V8_COVERAGE, not Istanbul AST branch coverage",
      documentation: "https://nodejs.org/api/cli.html#node_v8_coveragedir",
      root: absoluteRoot,
      measuredAt,
      sourceFileCount: Object.keys(files).length
    },
    total: { lines: metric(totals.lineCovered, totals.lineTotal), branches: metric(totals.branchCovered, totals.branchTotal) },
    files
  };
}

export function checkRelease250Coverage({
  coverageSummary,
  thresholds,
  changedFiles = [],
  coveragePath = "",
  baseThresholds,
  baseThresholdsAbsent = false
}) {
  validateThresholds(thresholds);
  assert.equal(coverageSummary.schemaVersion, 1, "coverage summary schemaVersion must be 1");
  assert.equal(coverageSummary.release, "2.5.0", "coverage summary release must be 2.5.0");
  assert.equal(coverageSummary.meta?.measured, true, "coverage summary must be produced from measured coverage");
  assert.equal(coverageSummary.meta?.engine, "node-v8-coverage", "coverage summary must use node-v8-coverage");
  assert.equal(coverageSummary.meta?.branchMetric, BRANCH_METRIC, `coverage summary branchMetric must be ${BRANCH_METRIC}`);
  const ratchetMode = enforceBaselineRatchet(thresholds, { baseThresholds, baseThresholdsAbsent });
  const files = normalizeFileCoverage(coverageSummary);
  const total = totalCoverage(coverageSummary, files);
  const baseline = configuredBaseline(thresholds);
  if (coveragePath && normalizePath(coveragePath) !== baseline.artifact) throw new Error(`Coverage artifact path ${normalizePath(coveragePath)} does not match baseline artifact ${baseline.artifact}`);
  if (total.lines < baseline.lines) throw new Error(`Total line coverage regressed from ${baseline.lines}% to ${total.lines.toFixed(2)}%`);
  if (total.branches < baseline.branches) throw new Error(`Total ${BRANCH_METRIC} coverage regressed from ${baseline.branches}% to ${total.branches.toFixed(2)}%`);

  const changedGatePatterns = (thresholds.changedBusinessCode.pathPatterns ?? []).map(normalizePath);
  const checkedChangedFiles = changedFiles.map(normalizePath).filter((filePath) => {
    return isBusinessFile(filePath, thresholds)
      && (!changedGatePatterns.length || changedGatePatterns.some((pattern) => filePath.includes(pattern)));
  });
  for (const changedFile of checkedChangedFiles) checkFileThreshold(changedFile, files.get(changedFile), thresholds.changedBusinessCode);

  const checkedStrictPaths = strictBranchFiles(changedFiles, thresholds);
  for (const strictPath of checkedStrictPaths) {
    const file = files.get(strictPath);
    if (!file) throw new Error(`Changed strict file is missing from coverage summary: ${strictPath}`);
    if (file.branches < 100) throw new Error(`${strictPath} requires 100% ${BRANCH_METRIC} coverage, saw ${file.branches.toFixed(2)}%`);
  }

  return {
    release: thresholds.release,
    total,
    ratchetMode,
    checkedChangedFiles: checkedChangedFiles.length,
    strictBranchPaths: checkedStrictPaths.length,
    coverageDigest: `sha256:${crypto.createHash("sha256").update(JSON.stringify(coverageSummary)).digest("hex")}`
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const thresholds = readJson(args.thresholds, "thresholds");
    let coverageSummary;
    let coveragePath = args.coverage;
    if (args.v8Dir) {
      coverageSummary = collectRelease250V8Coverage({ v8Dir: args.v8Dir, thresholds, root: args.root });
      writeJson(args.out, coverageSummary);
      coveragePath = args.out;
    } else {
      coverageSummary = readJson(args.coverage, "coverage summary");
    }
    const result = checkRelease250Coverage({
      coverageSummary,
      thresholds,
      changedFiles: readChangedFiles(args.changedFiles),
      coveragePath,
      baseThresholds: args.baseThresholds ? readJson(args.baseThresholds, "protected base thresholds") : undefined,
      baseThresholdsAbsent: args.baseThresholdsAbsent
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
