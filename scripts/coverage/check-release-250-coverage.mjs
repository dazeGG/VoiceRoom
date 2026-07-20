#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${label} JSON at ${filePath}: ${error.message}`);
  }
}

function parseArgs(argv) {
  const args = {
    thresholds: "config/coverage/release-250-thresholds.json",
    coverage: "",
    changedFiles: ""
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--thresholds") args.thresholds = argv[++index];
    else if (arg === "--coverage") args.coverage = argv[++index];
    else if (arg === "--changed-files") args.changedFiles = argv[++index];
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/coverage/check-release-250-coverage.mjs --coverage <summary.json> [--changed-files <paths.txt>]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.coverage) throw new Error("--coverage is required");
  return args;
}

function normalizePath(value) {
  return value.split(path.sep).join("/").replace(/^\.\//, "");
}

function pct(metric, label) {
  const value = typeof metric === "number" ? metric : metric?.pct;
  if (!Number.isFinite(value)) throw new Error(`Coverage metric ${label} must provide a numeric percentage`);
  return value;
}

function normalizeFileCoverage(summary) {
  const raw = summary.files ?? summary;
  const files = new Map();
  for (const [filePath, coverage] of Object.entries(raw)) {
    if (filePath === "total") continue;
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
    lines: lines / files.size,
    branches: branches / files.size
  };
}

function configuredBaseline(thresholds) {
  const baseline = thresholds.baseline;
  assert.equal(typeof baseline?.artifact, "string", "baseline.artifact is required");
  assert.equal(typeof baseline?.measuredAt, "string", "baseline.measuredAt is required");
  assert.ok(Number.isFinite(Date.parse(baseline.measuredAt)), "baseline.measuredAt must be an ISO timestamp");
  return {
    lines: pct(baseline.total?.lines, "baseline.total.lines"),
    branches: pct(baseline.total?.branches, "baseline.total.branches")
  };
}

function readChangedFiles(filePath) {
  if (!filePath) return [];
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).map((line) => normalizePath(line.trim())).filter(Boolean);
}

function isBusinessFile(filePath, thresholds) {
  const included = thresholds.businessPathPatterns.some((pattern) => filePath.startsWith(pattern));
  const ignored = thresholds.ignoredPathPatterns.some((pattern) => filePath.includes(pattern));
  return included && !ignored && /\.(?:js|mjs|cjs|ts|svelte)$/.test(filePath);
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

export function checkRelease250Coverage({ coverageSummary, thresholds, changedFiles = [] }) {
  assert.equal(thresholds.schemaVersion, 1, "threshold schemaVersion must be 1");
  assert.equal(thresholds.release, "2.5.0", "threshold release must be 2.5.0");
  const files = normalizeFileCoverage(coverageSummary);
  const total = totalCoverage(coverageSummary, files);
  const baseline = configuredBaseline(thresholds);
  if (total.lines < baseline.lines) {
    throw new Error(`Total line coverage regressed from ${baseline.lines}% to ${total.lines.toFixed(2)}%`);
  }
  if (total.branches < baseline.branches) {
    throw new Error(`Total branch coverage regressed from ${baseline.branches}% to ${total.branches.toFixed(2)}%`);
  }

  for (const changedFile of changedFiles.filter((filePath) => isBusinessFile(filePath, thresholds))) {
    checkFileThreshold(changedFile, files.get(changedFile), thresholds.changedBusinessCode);
  }

  for (const strictPath of thresholds.strictBranchPaths) {
    const normalized = normalizePath(strictPath);
    const file = files.get(normalized);
    if (file && file.branches < 100) {
      throw new Error(`${normalized} requires 100% branch coverage, saw ${file.branches.toFixed(2)}%`);
    }
  }

  return {
    release: thresholds.release,
    total,
    checkedChangedFiles: changedFiles.filter((filePath) => isBusinessFile(filePath, thresholds)).length,
    strictBranchPaths: thresholds.strictBranchPaths.length
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = checkRelease250Coverage({
      coverageSummary: readJson(args.coverage, "coverage summary"),
      thresholds: readJson(args.thresholds, "thresholds"),
      changedFiles: readChangedFiles(args.changedFiles)
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
