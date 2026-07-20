import assert from "node:assert/strict";
import test from "node:test";

import { checkRelease250Coverage } from "../coverage/check-release-250-coverage.mjs";

const thresholds = {
  schemaVersion: 1,
  release: "2.5.0",
  baseline: {
    artifact: "coverage/release-250-summary.json",
    measuredAt: "2026-07-20T00:00:00.000Z",
    total: { lines: 80, branches: 70 }
  },
  changedBusinessCode: { line: 90, branch: 85 },
  strictBranchPaths: ["apps/api/src/server.js", "packages/shared/src/validation.js"],
  businessPathPatterns: ["apps/api/src/", "apps/web/src/", "packages/shared/src/"],
  ignoredPathPatterns: ["/test/", "/migrations/", ".d.ts"]
};

const greenSummary = {
  total: { lines: { pct: 82 }, branches: { pct: 72 } },
  files: {
    "apps/api/src/server.js": { lines: { pct: 94 }, branches: { pct: 100 } },
    "packages/shared/src/validation.js": { lines: { pct: 100 }, branches: { pct: 100 } },
    "apps/web/src/lib/api/http.ts": { lines: { pct: 91 }, branches: { pct: 86 } },
    "apps/api/test/server.test.js": { lines: { pct: 10 }, branches: { pct: 10 } }
  }
};

test("G08-A01 accepts measured baseline, total non-regression, and changed business coverage", () => {
  const result = checkRelease250Coverage({
    coverageSummary: greenSummary,
    thresholds,
    changedFiles: ["apps/web/src/lib/api/http.ts", "apps/api/test/server.test.js"]
  });
  assert.equal(result.release, "2.5.0");
  assert.deepEqual(result.total, { lines: 82, branches: 72 });
  assert.equal(result.checkedChangedFiles, 1);
});

test("G08-A02 rejects total regression, under-covered changed business code, and strict-path branch gaps", () => {
  assert.throws(
    () => checkRelease250Coverage({
      coverageSummary: { ...greenSummary, total: { lines: { pct: 79 }, branches: { pct: 72 } } },
      thresholds,
      changedFiles: []
    }),
    /line coverage regressed/i
  );

  assert.throws(
    () => checkRelease250Coverage({
      coverageSummary: greenSummary,
      thresholds,
      changedFiles: ["apps/api/src/lib/missing-coverage.js"]
    }),
    /missing from coverage summary/i
  );

  assert.throws(
    () => checkRelease250Coverage({
      coverageSummary: {
        ...greenSummary,
        files: {
          ...greenSummary.files,
          "apps/web/src/lib/api/http.ts": { lines: { pct: 89.99 }, branches: { pct: 86 } }
        }
      },
      thresholds,
      changedFiles: ["apps/web/src/lib/api/http.ts"]
    }),
    /line coverage/i
  );

  assert.throws(
    () => checkRelease250Coverage({
      coverageSummary: {
        ...greenSummary,
        files: {
          ...greenSummary.files,
          "apps/api/src/server.js": { lines: { pct: 94 }, branches: { pct: 99.99 } }
        }
      },
      thresholds,
      changedFiles: []
    }),
    /requires 100% branch coverage/i
  );
});
