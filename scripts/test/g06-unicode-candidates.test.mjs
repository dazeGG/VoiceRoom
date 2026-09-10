import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const ADR_PATH = "docs/ADR_UNICODE_REACTIONS.md";
const EXPECTED_SHA256 = "1d8a944f88d7952f7ef7c5167fef3c67995bcae24543949710231b03a201acda";
const EXPECTED_AUTHORITY_URL = "https://www.unicode.org/Public/17.0.0/emoji/emoji-test.txt";

function readDecision(markdown = fs.readFileSync(ADR_PATH, "utf8")) {
  const match = markdown.match(/```json authority-decision\n([\s\S]*?)\n```/);
  assert.ok(match, "ADR must contain a json authority-decision block");
  return JSON.parse(match[1]);
}

function validateAuthorityDecision(decision) {
  assert.equal(decision.schemaVersion, 1);
  assert.equal(decision.goal, "G06");
  assert.equal(decision.release, "2.5.0");
  assert.equal(decision.status, "ACCEPTED");

  assert.equal(decision.authority.name, "Unicode emoji-test.txt");
  assert.equal(decision.authority.provider, "Unicode Consortium");
  assert.equal(decision.authority.url, EXPECTED_AUTHORITY_URL);
  assert.equal(decision.authority.unicodeVersion, "17.0");
  assert.equal(decision.authority.fileDate, "2025-08-04, 20:55:31 GMT");
  assert.equal(decision.authority.accessedDate, "2026-07-20");
  assert.equal(decision.authority.byteSize, 669326);
  assert.equal(decision.authority.sha256, EXPECTED_SHA256);
  assert.equal(decision.authority.license, "Unicode Terms of Use");
  assert.equal(decision.authority.licenseUrl, "https://www.unicode.org/terms_of_use.html");
  assert.equal(decision.authority.attributionRequired, true);
  assert.deepEqual(decision.authority.counts, {
    "fully-qualified": 3944,
    "minimally-qualified": 1029,
    unqualified: 243,
    component: 9,
    total: 5225
  });

  assert.deepEqual(decision.reactionPolicy.acceptedStatuses, ["fully-qualified"]);
  assert.deepEqual(decision.reactionPolicy.rejectedStatuses, ["minimally-qualified", "unqualified", "component"]);
  assert.equal(decision.reactionPolicy.rejectStandaloneComponents, true);
  assert.equal(decision.reactionPolicy.rejectUnknownSequences, true);

  assert.equal(decision.manifestAuthorization.npmPackagesAuthorized, false);
  assert.equal(decision.manifestAuthorization.packageManifestsMayChangeInG06, false);
  assert.equal(decision.manifestAuthorization.nextGoal, "G07");
}

test("G06-A01 records Unicode emoji-test.txt v17.0 as the sole reaction authority", () => {
  const markdown = fs.readFileSync(ADR_PATH, "utf8");
  const decision = readDecision(markdown);

  validateAuthorityDecision(decision);
  assert.match(markdown, /accept exactly one `fully-qualified` emoji sequence/);
  assert.match(markdown, /reject `minimally-qualified` and `unqualified` sequences/);
  assert.match(markdown, /reject standalone `component` entries/);
  assert.match(markdown, /No npm package is authorized by this ADR/);
});

test("G06-A01 compares required candidates with metadata, license, maintenance, runtime, module, and coverage findings", () => {
  const decision = readDecision();
  const candidatesByName = new Map(decision.candidates.map((candidate) => [candidate.name, candidate]));
  const snapshotsByName = new Map(decision.maintenanceSnapshots.map((snapshot) => [snapshot.name, snapshot]));

  for (const name of ["Unicode emoji-test.txt", "emojibase-data", "emoji-regex", "emoji-regex-xs"]) {
    assert.ok(candidatesByName.has(name), `missing candidate ${name}`);
    assert.ok(candidatesByName.get(name).version, `missing candidate version for ${name}`);
    assert.ok(candidatesByName.get(name).license, `missing candidate license for ${name}`);
    assert.ok(candidatesByName.get(name).moduleShape, `missing module shape for ${name}`);
  }

  assert.equal(candidatesByName.get("Unicode emoji-test.txt").authority, true);
  assert.equal(candidatesByName.get("emojibase-data").authority, false);
  assert.equal(candidatesByName.get("emoji-regex").authority, false);
  assert.equal(candidatesByName.get("emoji-regex-xs").authority, false);
  assert.equal(candidatesByName.get("emojibase-data").unpackedSize, 50042068);
  assert.equal(candidatesByName.get("emoji-regex").moduleShape, "CJS, ESM, types");
  assert.equal(candidatesByName.get("emoji-regex-xs").version, "2.0.1");

  for (const name of ["emojibase-data", "emoji-regex", "emoji-regex-xs"]) {
    assert.ok(snapshotsByName.has(name), `missing maintenance snapshot ${name}`);
    assert.ok(snapshotsByName.get(name).latest, `missing latest version for ${name}`);
    assert.ok(snapshotsByName.get(name).versionCount >= 2, `maintenance history is too thin for ${name}`);
    assert.ok(Date.parse(snapshotsByName.get(name).modified), `missing modified timestamp for ${name}`);
    assert.ok(Date.parse(snapshotsByName.get(name).selectedVersionPublishedAt), `missing selected publication timestamp for ${name}`);
  }
});

test("G06-A02 blocks missing authority, stale checksum, package authority, and broader qualification policies", () => {
  const good = readDecision();

  assert.throws(
    () => validateAuthorityDecision({ ...good, authority: { ...good.authority, sha256: "0".repeat(64) } }),
    /Expected values to be strictly equal/
  );

  assert.throws(
    () => validateAuthorityDecision({ ...good, authority: { ...good.authority, url: "https://registry.npmjs.org/emoji-regex" } }),
    /Expected values to be strictly equal/
  );

  assert.throws(
    () => validateAuthorityDecision({
      ...good,
      reactionPolicy: { ...good.reactionPolicy, acceptedStatuses: ["fully-qualified", "component"] }
    }),
    /Expected values to be strictly deep-equal/
  );

  assert.throws(
    () => validateAuthorityDecision({
      ...good,
      manifestAuthorization: { ...good.manifestAuthorization, npmPackagesAuthorized: true }
    }),
    /Expected values to be strictly equal/
  );
});
