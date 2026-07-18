import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const j = (p) => JSON.parse(fs.readFileSync(p));
const s = (p) => fs.readFileSync(p, "utf8");
test("actionlint Linux bootstrap is exact and fail closed", () => {
  const l = j("config/tool-locks/actionlint-v1.7.12.json");
  const w = s("scripts/ci/run-actionlint.sh");
  assert.equal(l.assets.linux_amd64.sha256, "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8");
  for (const x of ["sha256sum --check --strict", "gh attestation verify", "v1.7.12"]) assert.ok(w.includes(x));
  assert.ok(!/latest|npx /.test(w));
});
test("ORAS Linux lock binds signature, checksums, keys, tag and commit", () => {
  const l = j("config/tool-locks/oras-v1.3.3.json");
  assert.equal(l.assets.linux_amd64.sha256, "9ce999f8d2de03fc03968b29d743077a58783e545e5eaa53917ca177352d0e59");
  assert.equal(l.assets.linux_amd64.signatureSha256, "4b101042ee0b95b893de6f0ce6a4ec6ddfbff98df1ed23389de6c4e1ec1c1baf");
  assert.equal(l.sourceCommit, "210747c29c1d38732b3194878dfd8b5a6b9ad7eb");
  assert.equal(l.signerFingerprint, "2DA461D13B0C27845EDFA77FE462A3894CBAAA47");
});
test("ORAS wrapper has no latest or package-manager fallback", () => {
  const w = s("scripts/ci/run-oras.sh");
  assert.ok(w.includes("sha256sum --check --strict"));
  assert.ok(w.includes("210747c29c1d38732b3194878dfd8b5a6b9ad7eb"));
  assert.ok(w.includes("VALIDSIG 2DA461D13B0C27845EDFA77FE462A3894CBAAA47"));
  assert.ok(w.includes("d6f59b4e6615cadfc8343dc9a066d781300c5967"));
  assert.ok(!/latest|npx |npm |brew /.test(w));
});
