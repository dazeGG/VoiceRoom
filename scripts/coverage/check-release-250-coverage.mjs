#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_THRESHOLDS = "config/coverage/release-250-thresholds.json";
const BUSINESS_EXTENSIONS = /\.(?:js|mjs|cjs|ts|svelte)$/;

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
    root: process.cwd()
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--thresholds") args.thresholds = argv[++index];
    else if (arg === "--coverage") args.coverage = argv[++index];
    else if (arg === "--v8-dir") args.v8Dir = argv[++index];
    else if (arg === "--out") args.out = argv[++index];
    else if (arg === "--changed-files") args.changedFiles = argv[++index];
    else if (arg === "--root") args.root = argv[++index];
    else if (arg === "--help" || arg === "-h") {
      console.log([
        "Usage:",
        "  node scripts/coverage/check-release-250-coverage.mjs --coverage <summary.json> [--changed-files <paths.txt>]",
        "  node scripts/coverage/check-release-250-coverage.mjs --v8-dir <NODE_V8_COVERAGE dir> --out <summary.json> [--changed-files <paths.txt>]"
      ].join("\n"));
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.coverage && !args.v8Dir) throw new Error("--coverage or --v8-dir is required");
  if (args.coverage && args.v8Dir) throw new Error("--coverage and --v8-dir are mutually exclusive");
  if (args.v8Dir && !args.out) throw new Error("--out is required with --v8-dir");
  return args;
}

function normalizePath(value) {
  return String(value || "")
    .split(path.sep)
    .join("/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/");
}

function normalizeRoot(root) {
  return path.resolve(root);
}

function toRepoPath(filePath, root) {
  const absolute = path.resolve(filePath);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return "";
  return normalizePath(relative);
}

function pct(metric, label) {
  const value = typeof metric === "number" ? metric : metric?.pct;
  if (!Number.isFinite(value)) throw new Error(`Coverage metric ${label} must provide a numeric percentage`);
  return value;
}

function ratio(covered, total) {
  if (total === 0) return 100;
  return Number(((covered / total) * 100).toFixed(2));
}

function metric(covered, total) {
  return { total, covered, skipped: 0, pct: ratio(covered, total) };
}

function assertArray(value, label) {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  for (const item of value) assert.equal(typeof item, "string", `${label} entries must be strings`);
}

function validateThresholds(thresholds) {
  assert.equal(thresholds.schemaVersion, 1, "threshold schemaVersion must be 1");
  assert.equal(thresholds.release, "2.5.0", "threshold release must be 2.5.0");
  assertArray(thresholds.businessPathPatterns, "businessPathPatterns");
  assertArray(thresholds.ignoredPathPatterns, "ignoredPathPatterns");
  assertArray(thresholds.strictBranchPaths, "strictBranchPaths");
  assertArray(thresholds.strictBranchPathPatterns ?? [], "strictBranchPathPatterns");
  assert.equal(typeof thresholds.baseline?.artifact, "string", "baseline.artifact is required");
  assert.equal(typeof thresholds.baseline?.measuredAt, "string", "baseline.measuredAt is required");
  assert.ok(Number.isFinite(Date.parse(thresholds.baseline.measuredAt)), "baseline.measuredAt must be an ISO timestamp");
  pct(thresholds.baseline.total?.lines, "baseline.total.lines");
  pct(thresholds.baseline.total?.branches, "baseline.total.branches");
  pct(thresholds.changedBusinessCode?.line, "changedBusinessCode.line");
  pct(thresholds.changedBusinessCode?.branch, "changedBusinessCode.branch");
}

function isBusinessFile(filePath, thresholds) {
  const normalized = normalizePath(filePath);
  const included = thresholds.businessPathPatterns.some((pattern) => normalized.startsWith(normalizePath(pattern)));
  const ignored = thresholds.ignoredPathPatterns.some((pattern) => normalized.includes(normalizePath(pattern)));
  return included && !ignored && BUSINESS_EXTENSIONS.test(normalized);
}

function listBusinessSourceFiles(root, thresholds) {
  const results = [];
  const startDirs = [...new Set(thresholds.businessPathPatterns.map((pattern) => normalizePath(pattern).split("/")[0]).filter(Boolean))];
  const visit = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".svelte-kit" || entry.name === "dist" || entry.name === "build") continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else {
        const repoPath = toRepoPath(absolute, root);
        if (isBusinessFile(repoPath, thresholds)) results.push(repoPath);
      }
    }
  };
  for (const startDir of startDirs) visit(path.join(root, startDir));
  return [...new Set(results)].sort();
}

function normalizeFileCoverage(summary) {
  const raw = summary.files ?? summary;
  const files = new Map();
  for (const [filePath, coverage] of Object.entries(raw)) {
    if (filePath === "total" || filePath === "meta") continue;
    const lines = pct(coverage.lines, `${filePath}.lines`);
    const branches = pct(coverage.branches, `${filePath}.branches`);
    files.set(normalizePath(filePath), { lines, branches });
  }
  return files;
}

function totalCoverage(summary, files) {
  if (summary.total) {
    return {
      lines: pct(summary.total.lines, "total.lines"),
      branches: pct(summary.total.branches, "total.branches")
    };
  }
  if (!files.size) throw new Error("Coverage summary contains no files");
  let lines = 0;
  let branches = 0;
  for (const file of files.values()) {
    lines += file.lines;
    branches += file.branches;
  }
  return {
    lines: Number((lines / files.size).toFixed(2)),
    branches: Number((branches / files.size).toFixed(2))
  };
}

function configuredBaseline(thresholds) {
  return {
    artifact: normalizePath(thresholds.baseline.artifact),
    lines: pct(thresholds.baseline.total?.lines, "baseline.total.lines"),
    branches: pct(thresholds.baseline.total?.branches, "baseline.total.branches")
  };
}

function readChangedFiles(filePath) {
  if (!filePath) return [];
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).map((line) => normalizePath(line.trim())).filter(Boolean);
}

function strictBranchFiles(files, thresholds) {
  const exact = new Set((thresholds.strictBranchPaths ?? []).map(normalizePath));
  const patterns = (thresholds.strictBranchPathPatterns ?? []).map(normalizePath);
  for (const filePath of files.keys()) {
    if (patterns.some((pattern) => filePath.includes(pattern))) exact.add(filePath);
  }
  return [...exact].sort();
}

function checkFileThreshold(filePath, coverage, minimums) {
  if (!coverage) throw new Error(`Changed business file is missing from coverage summary: ${filePath}`);
  if (coverage.lines < minimums.line) {
    throw new Error(`${filePath} line coverage ${coverage.lines.toFixed(2)}% is below ${minimums.line}%`);
  }
  if (coverage.branches < minimums.branch) {
    throw new Error(`${filePath} branch coverage ${coverage.branches.toFixed(2)}% is below ${minimums.branch}%`);
  }
}

function lineRanges(source) {
  const ranges = [];
  let offset = 0;
  for (const line of source.split(/\n/)) {
    ranges.push({ start: offset, end: offset + line.length, source: line });
    offset += line.length + 1;
  }
  return ranges;
}

function isRelevantLine(line) {
  const trimmed = line.trim();
  return Boolean(trimmed && trimmed !== "{" && trimmed !== "}" && !trimmed.startsWith("//") && !trimmed.startsWith("*"));
}

function coverageForScript(script, root) {
  const absolutePath = fileURLToPath(script.url);
  const repoPath = toRepoPath(absolutePath, root);
  if (!repoPath || !fs.existsSync(absolutePath)) return null;
  const source = fs.readFileSync(absolutePath, "utf8");
  const executedOffsets = new Uint8Array(source.length + 1);
  const branchRanges = [];
  for (const fn of script.functions ?? []) {
    for (const range of fn.ranges ?? []) {
      if (range.count > 0) {
        for (let index = range.startOffset; index < range.endOffset; index += 1) executedOffsets[index] = 1;
      }
      if (!(range.startOffset === 0 && range.endOffset === source.length)) branchRanges.push(range);
    }
  }

  let totalLines = 0;
  let coveredLines = 0;
  for (const line of lineRanges(source)) {
    if (!isRelevantLine(line.source)) continue;
    totalLines += 1;
    const end = Math.max(line.start + 1, line.end);
    for (let index = line.start; index < end; index += 1) {
      if (executedOffsets[index]) {
        coveredLines += 1;
        break;
      }
    }
  }
  const coveredBranches = branchRanges.filter((range) => range.count > 0).length;
  return {
    repoPath,
    lines: metric(coveredLines, totalLines),
    branches: metric(coveredBranches, branchRanges.length)
  };
}

function mergeCoverageEntry(left, right) {
  if (!left) return right;
  return {
    lines: metric(
      Math.max(left.lines.covered, right.lines.covered),
      Math.max(left.lines.total, right.lines.total)
    ),
    branches: metric(
      Math.max(left.branches.covered, right.branches.covered),
      Math.max(left.branches.total, right.branches.total)
    )
  };
}

export function collectRelease250V8Coverage({ v8Dir, thresholds, root = process.cwd(), measuredAt = new Date().toISOString() }) {
  validateThresholds(thresholds);
  const absoluteRoot = normalizeRoot(root);
  const files = new Map();
  for (const repoPath of listBusinessSourceFiles(absoluteRoot, thresholds)) {
    files.set(repoPath, { lines: metric(0, 1), branches: metric(0, 1) });
  }
  if (!fs.existsSync(v8Dir)) throw new Error(`V8 coverage directory does not exist: ${v8Dir}`);
  for (const entry of fs.readdirSync(v8Dir)) {
    if (!entry.endsWith(".json")) continue;
    const payload = readJson(path.join(v8Dir, entry), "V8 coverage");
    for (const script of payload.result ?? []) {
      if (typeof script.url !== "string" || !script.url.startsWith("file://")) continue;
      const coverage = coverageForScript(script, absoluteRoot);
      if (!coverage || !isBusinessFile(coverage.repoPath, thresholds)) continue;
      files.set(coverage.repoPath, mergeCoverageEntry(files.get(coverage.repoPath), {
        lines: coverage.lines,
        branches: coverage.branches
      }));
    }
  }

  const serializedFiles = Object.fromEntries([...files.entries()].sort(([a], [b]) => a.localeCompare(b)));
  let totalLineCovered = 0;
  let totalLineCount = 0;
  let totalBranchCovered = 0;
  let totalBranchCount = 0;
  for (const coverage of Object.values(serializedFiles)) {
    totalLineCovered += coverage.lines.covered;
    totalLineCount += coverage.lines.total;
    totalBranchCovered += coverage.branches.covered;
    totalBranchCount += coverage.branches.total;
  }
  return {
    schemaVersion: 1,
    release: "2.5.0",
    meta: {
      measured: true,
      engine: "node-v8-coverage",
      root: absoluteRoot,
      measuredAt,
      sourceFileCount: Object.keys(serializedFiles).length
    },
    total: {
      lines: metric(totalLineCovered, totalLineCount),
      branches: metric(totalBranchCovered, totalBranchCount)
    },
    files: serializedFiles
  };
}

export function checkRelease250Coverage({ coverageSummary, thresholds, changedFiles = [], coveragePath = "" }) {
  validateThresholds(thresholds);
  assert.equal(coverageSummary.schemaVersion, 1, "coverage summary schemaVersion must be 1");
  assert.equal(coverageSummary.release, "2.5.0", "coverage summary release must be 2.5.0");
  assert.equal(coverageSummary.meta?.measured, true, "coverage summary must be produced from measured coverage");
  assert.equal(coverageSummary.meta?.engine, "node-v8-coverage", "coverage summary must use node-v8-coverage");
  const files = normalizeFileCoverage(coverageSummary);
  const total = totalCoverage(coverageSummary, files);
  const baseline = configuredBaseline(thresholds);
  if (coveragePath && normalizePath(coveragePath) !== baseline.artifact) {
    throw new Error(`Coverage artifact path ${normalizePath(coveragePath)} does not match baseline artifact ${baseline.artifact}`);
  }
  if (total.lines < baseline.lines) {
    throw new Error(`Total line coverage regressed from ${baseline.lines}% to ${total.lines.toFixed(2)}%`);
  }
  if (total.branches < baseline.branches) {
    throw new Error(`Total branch coverage regressed from ${baseline.branches}% to ${total.branches.toFixed(2)}%`);
  }

  const checkedChangedFiles = changedFiles.filter((filePath) => isBusinessFile(filePath, thresholds));
  for (const changedFile of checkedChangedFiles) {
    checkFileThreshold(changedFile, files.get(changedFile), thresholds.changedBusinessCode);
  }

  const checkedStrictPaths = strictBranchFiles(files, thresholds);
  for (const strictPath of checkedStrictPaths) {
    const file = files.get(strictPath);
    if (!file) throw new Error(`${strictPath} is configured for strict branch coverage but is missing from coverage summary`);
    if (file.branches < 100) {
      throw new Error(`${strictPath} requires 100% branch coverage, saw ${file.branches.toFixed(2)}%`);
    }
  }

  return {
    release: thresholds.release,
    total,
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
      coveragePath
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
