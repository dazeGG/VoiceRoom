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
    changedDiff: "",
    baseThresholds: "",
    baseThresholdsAbsent: false,
    collectOnly: false,
    root: process.cwd()
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--thresholds") args.thresholds = argv[++index];
    else if (arg === "--coverage") args.coverage = argv[++index];
    else if (arg === "--v8-dir") args.v8Dir = argv[++index];
    else if (arg === "--out") args.out = argv[++index];
    else if (arg === "--changed-files") args.changedFiles = argv[++index];
    else if (arg === "--changed-diff") args.changedDiff = argv[++index];
    else if (arg === "--base-thresholds") args.baseThresholds = argv[++index];
    else if (arg === "--base-thresholds-absent") args.baseThresholdsAbsent = true;
    else if (arg === "--collect-only") args.collectOnly = true;
    else if (arg === "--root") args.root = argv[++index];
    else if (arg === "--help" || arg === "-h") {
      console.log([
        "Usage:",
        "  node scripts/coverage/check-release-250-coverage.mjs --coverage <summary.json> [--changed-files <paths.txt>] [--changed-diff <patch.diff>] (--base-thresholds <base.json>|--base-thresholds-absent)",
        "  node scripts/coverage/check-release-250-coverage.mjs --v8-dir <NODE_V8_COVERAGE dir> --out <summary.json> --collect-only"
      ].join("\n"));
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.coverage && !args.v8Dir) throw new Error("--coverage or --v8-dir is required");
  if (args.coverage && args.v8Dir) throw new Error("--coverage and --v8-dir are mutually exclusive");
  if (args.v8Dir && !args.out) throw new Error("--out is required with --v8-dir");
  if (args.collectOnly && !args.v8Dir) throw new Error("--collect-only requires --v8-dir");
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
      branches: pct(coverage.branches, `${filePath}.branches`),
      details: coverage.details
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
  if (Boolean(baseThresholds) === Boolean(baseThresholdsAbsent)) {
    throw new Error("Coverage enforcement requires exactly one trust mode: protected base thresholds or verified initial adoption");
  }
  if (baseThresholds) {
    validateThresholds(baseThresholds);
    const current = configuredBaseline(thresholds);
    const base = configuredBaseline(baseThresholds);
    if (current.lines < base.lines) throw new Error(`Configured line baseline decreased from protected base ${base.lines}% to ${current.lines}%`);
    if (current.branches < base.branches) throw new Error(`Configured ${BRANCH_METRIC} baseline decreased from protected base ${base.branches}% to ${current.branches}%`);
    if (current.artifact !== base.artifact) throw new Error(`Coverage artifact policy changed from protected base ${base.artifact} to ${current.artifact}`);
    if (thresholds.changedBusinessCode.line < baseThresholds.changedBusinessCode.line) throw new Error("changedBusinessCode.line may not decrease from protected base");
    if (thresholds.changedBusinessCode.branch < baseThresholds.changedBusinessCode.branch) throw new Error("changedBusinessCode.branch may not decrease from protected base");
    assertPolicySuperset(thresholds.businessPathPatterns, baseThresholds.businessPathPatterns, "businessPathPatterns");
    assertPolicySuperset(thresholds.strictBranchPaths ?? [], baseThresholds.strictBranchPaths ?? [], "strictBranchPaths");
    assertNoNewIgnoredPatterns(thresholds.ignoredPathPatterns, baseThresholds.ignoredPathPatterns);
    const currentGroups = new Map(thresholds.strictBranchGroups.map((group) => [group.name, group]));
    for (const baseGroup of baseThresholds.strictBranchGroups) {
      const group = currentGroups.get(baseGroup.name);
      if (!group) throw new Error(`Strict branch group removed from protected base: ${baseGroup.name}`);
      if (group.enforcement !== baseGroup.enforcement) throw new Error(`Strict branch group enforcement changed: ${baseGroup.name}`);
      assertPolicySuperset(group.paths ?? [], baseGroup.paths ?? [], `${baseGroup.name}.paths`);
      assertPolicySuperset(group.pathPatterns ?? [], baseGroup.pathPatterns ?? [], `${baseGroup.name}.pathPatterns`);
    }
    return "protected-base-ratchet";
  }
  if (baseThresholdsAbsent) {
    const adoption = thresholds.baselinePolicy?.initialAdoption;
    if (adoption?.baseConfigAbsent !== true || typeof adoption.reason !== "string" || adoption.reason.trim().length < 12) {
      throw new Error("Initial coverage baseline adoption requires explicit baseConfigAbsent metadata and a reason");
    }
    return "explicit-initial-adoption";
  }
}

function assertPolicySuperset(currentValues, baseValues, label) {
  const current = new Set(currentValues.map(normalizePath));
  for (const value of baseValues.map(normalizePath)) {
    if (!current.has(value)) throw new Error(`${label} may not remove or narrow protected-base policy entry: ${value}`);
  }
}

function assertNoNewIgnoredPatterns(currentValues, baseValues) {
  const base = new Set(baseValues.map(normalizePath));
  for (const value of currentValues.map(normalizePath)) {
    if (!base.has(value)) throw new Error(`ignoredPathPatterns may not add protected-base exclusions: ${value}`);
  }
}

function readChangedFiles(filePath) {
  if (!filePath) return [];
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).map((line) => normalizePath(line.trim())).filter(Boolean);
}

function readChangedLineMap(filePath) {
  const changed = new Map();
  if (!filePath) return changed;
  let currentPath = "";
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (line.startsWith("+++ ")) {
      currentPath = normalizePath(line.slice(4).replace(/^b\//, ""));
      if (currentPath === "/dev/null") currentPath = "";
      continue;
    }
    if (!currentPath || !line.startsWith("@@")) continue;
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

function checkFileThreshold(filePath, coverage, minimums, changedLines) {
  if (!coverage) throw new Error(`Changed business file is missing from coverage summary: ${filePath}`);
  let lines = coverage.lines;
  let branches = coverage.branches;
  if (changedLines) {
    if (!coverage.details) throw new Error(`Changed-line coverage details are missing for business file: ${filePath}`);
    const lineDetails = coverage.details.lines.filter((entry) => changedLines.has(entry.line));
    const branchDetails = coverage.details.branches.filter((entry) => {
      for (let number = entry.startLine; number <= entry.endLine; number += 1) if (changedLines.has(number)) return true;
      return false;
    });
    lines = metric(lineDetails.filter((entry) => entry.covered).length, lineDetails.length).pct;
    branches = metric(branchDetails.filter((entry) => entry.covered).length, branchDetails.length).pct;
  }
  if (lines < minimums.line) throw new Error(`${filePath} changed line coverage ${lines.toFixed(2)}% is below ${minimums.line}%`);
  if (branches < minimums.branch) throw new Error(`${filePath} changed ${BRANCH_METRIC} coverage ${branches.toFixed(2)}% is below ${minimums.branch}%`);
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
  const lines = sourceLines(accumulator.source);
  const lineDetails = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!isRelevantLine(line.text)) continue;
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
    lines: metric(lineCovered, lineTotal),
    branches: branchRanges.length
      ? metric(branchRanges.filter((range) => range.covered).length, branchRanges.length)
      : metric(accumulator.seenInCoverage ? 0 : 0, accumulator.seenInCoverage ? 0 : 1),
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

function lineNumberAtOffset(lines, offset) {
  let low = 0;
  let high = lines.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const line = lines[middle];
    if (offset < line.start) high = middle - 1;
    else if (offset > line.end) low = middle + 1;
    else return middle + 1;
  }
  return Math.min(lines.length, low + 1);
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
  changedLineMap = new Map(),
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

  const checkedChangedFiles = changedFiles.map(normalizePath).filter((filePath) => isBusinessFile(filePath, thresholds));
  for (const changedFile of checkedChangedFiles) {
    checkFileThreshold(changedFile, files.get(changedFile), thresholds.changedBusinessCode, changedLineMap.get(changedFile));
  }

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
      if (args.collectOnly) {
        console.log(JSON.stringify({ ok: true, collected: true, total: coverageSummary.total }, null, 2));
        process.exit(0);
      }
    } else {
      coverageSummary = readJson(args.coverage, "coverage summary");
    }
    const result = checkRelease250Coverage({
      coverageSummary,
      thresholds,
      changedFiles: readChangedFiles(args.changedFiles),
      changedLineMap: readChangedLineMap(args.changedDiff),
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
