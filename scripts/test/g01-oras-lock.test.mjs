import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const json = (file) => JSON.parse(fs.readFileSync(file));
const source = (file) => fs.readFileSync(file, "utf8");
const toolPlatform = os.platform() === "darwin" && os.arch() === "arm64"
  ? "darwin_arm64"
  : os.platform() === "linux" && os.arch() === "x64"
    ? "linux_amd64"
    : null;

test("actionlint bootstrap revalidates provenance and never probes a cached executable", () => {
  const lock = json("config/tool-locks/actionlint-v1.7.12.json");
  const wrapper = source("scripts/ci/run-actionlint.sh");
  assert.equal(lock.assets.linux_amd64.sha256, "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8");
  for (const value of ["hash_ok \"$sha\" \"$file\"", "gh attestation verify", "mktemp -d", "candidate=\"$extract/actionlint\"", "rm -f \"$bin\"", "mv \"$candidate\" \"$bin\""]) assert.ok(wrapper.includes(value), value);
  assert.ok(wrapper.indexOf("hash_ok \"$sha\" \"$file\"") < wrapper.indexOf("exec \"$bin\""));
  assert.doesNotMatch(wrapper, /\$bin" -version/);
  assert.doesNotMatch(wrapper, /latest|npx /);
});

test("ORAS bootstrap revalidates archive signature, checksums and immutable keys before fresh extraction", () => {
  const lock = json("config/tool-locks/oras-v1.3.3.json");
  const wrapper = source("scripts/ci/run-oras.sh");
  assert.equal(lock.assets.linux_amd64.sha256, "9ce999f8d2de03fc03968b29d743077a58783e545e5eaa53917ca177352d0e59");
  assert.equal(lock.assets.linux_amd64.signatureSha256, "4b101042ee0b95b893de6f0ce6a4ec6ddfbff98df1ed23389de6c4e1ec1c1baf");
  assert.equal(lock.assets.darwin_arm64.signatureSha256, "06e9e1d88b4e7c1e972268a21bfc454dbce9683bd14bd080c078d6684c6a7e31");
  assert.equal(lock.sourceCommit, "210747c29c1d38732b3194878dfd8b5a6b9ad7eb");
  assert.equal(lock.signerFingerprint, "2DA461D13B0C27845EDFA77FE462A3894CBAAA47");
  for (const value of ["config/tool-locks/oras-v1.3.3.json", "asset.signatureSha256", "lock.downloadBase", "hash_ok \"$sha\" \"$file\"", "hash_ok \"$sig_sha\" \"$sig\"", "VALIDSIG $signer_fingerprint", "mktemp -d", "candidate=\"$extract/oras\"", "rm -f \"$bin\"", "mv \"$candidate\" \"$bin\""]) assert.ok(wrapper.includes(value), value);
  for (const digest of [lock.assets.linux_amd64.signatureSha256, lock.assets.darwin_arm64.signatureSha256]) assert.equal(wrapper.includes(`sig_sha=${digest}`), false);
  assert.doesNotMatch(wrapper, /\[\[ -s \"\$sig\" \]\]/);
  assert.doesNotMatch(wrapper, /\$bin" version/);
  assert.doesNotMatch(wrapper, /latest|npx |npm |brew /);
});

test("poisoned executable caches are rejected without execution", { skip: !toolPlatform }, () => {
  const platform = toolPlatform;
  for (const tool of ["actionlint", "oras"]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `g01-${tool}-poison-`));
    try {
      const version = tool === "actionlint" ? "actionlint-v1.7.12" : "oras-v1.3.3";
      const cache = path.join(root, "voiceroom-tools", version, platform);
      const fakebin = path.join(root, "fakebin");
      const marker = path.join(root, "POISON_EXECUTED");
      fs.mkdirSync(cache, { recursive: true }); fs.mkdirSync(fakebin);
      fs.writeFileSync(path.join(cache, tool), `#!/usr/bin/env bash\ntouch ${JSON.stringify(marker)}\n${tool === "actionlint" ? "echo 1.7.12" : "printf 'Version: 1.3.3\\nGit commit: 210747c29c1d38732b3194878dfd8b5a6b9ad7eb\\n'"}\n`);
      fs.chmodSync(path.join(cache, tool), 0o755);
      fs.writeFileSync(path.join(fakebin, "curl"), "#!/usr/bin/env bash\nexit 42\n"); fs.chmodSync(path.join(fakebin, "curl"), 0o755);
      const result = spawnSync("bash", [`scripts/ci/run-${tool}.sh`, tool === "actionlint" ? ".github/workflows/ci.yml" : "version"], { env: { ...process.env, XDG_CACHE_HOME: root, PATH: `${fakebin}:${process.env.PATH}` }, encoding: "utf8" });
      assert.notEqual(result.status, 0);
      assert.equal(fs.existsSync(marker), false, `${tool} poison executed`);
      assert.equal(fs.existsSync(path.join(cache, tool)), false, `${tool} poison was retained`);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});
