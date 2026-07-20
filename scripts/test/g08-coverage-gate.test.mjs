import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

import { checkRelease250Coverage, collectRelease250V8Coverage } from "../coverage/check-release-250-coverage.mjs";

const require = createRequire(import.meta.url);
const { createGateCredentialSigner } = require("../../apps/api/src/domains/admission/gate-credential-signer.js");
const { createLiveKitAuthGateService, extractCredential } = require("../../apps/api/src/domains/admission/livekit-auth-gate-service.js");
const SECRET = "g08-test-livekit-gate-secret-at-least-32-bytes";

function thresholdFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    release: "2.5.0",
    branchMetric: "node-v8-branch",
    baselinePolicy: {
      mode: "protected-base-ratchet",
      initialAdoption: { baseConfigAbsent: true, reason: "Initial G08 adoption on a base without coverage configuration." }
    },
    baseline: {
      artifact: "coverage/release-250-summary.json",
      measuredAt: "2026-07-20T00:00:00.000Z",
      total: { lines: 80, branches: 70 }
    },
    changedBusinessCode: { line: 90, branch: 85 },
    strictBranchPaths: [],
    strictBranchGroups: [
      {
        name: "auth-admission",
        enforcement: "on-changed",
        paths: ["apps/api/src/domains/admission/gate-credential-signer.js"],
        pathPatterns: ["apps/api/src/domains/admission/"]
      },
      {
        name: "media",
        enforcement: "on-changed",
        paths: [],
        pathPatterns: ["apps/web/src/lib/features/room/client/media/"]
      }
    ],
    businessPathPatterns: ["apps/api/src/", "apps/web/src/", "packages/shared/src/"],
    ignoredPathPatterns: ["/test/", "/migrations/", ".d.ts"],
    ...overrides
  };
}

const thresholds = thresholdFixture();
const greenSummary = {
  schemaVersion: 1,
  release: "2.5.0",
  meta: { measured: true, engine: "node-v8-coverage", branchMetric: "node-v8-branch" },
  total: { lines: { pct: 82 }, branches: { pct: 72 } },
  files: {
    "apps/api/src/domains/admission/gate-credential-signer.js": { lines: { pct: 100 }, branches: { pct: 100 } },
    "apps/web/src/lib/api/http.ts": { lines: { pct: 91 }, branches: { pct: 86 } }
  }
};

test("G08-A01 accepts measured coverage and explicit initial adoption", () => {
  const result = checkRelease250Coverage({
    coverageSummary: greenSummary,
    thresholds,
    changedFiles: ["apps/api/src/domains/admission/gate-credential-signer.js"],
    baseThresholdsAbsent: true
  });
  assert.equal(result.ratchetMode, "explicit-initial-adoption");
  assert.equal(result.checkedChangedFiles, 1);
  assert.equal(result.strictBranchPaths, 1);
  assert.match(result.coverageDigest, /^sha256:[a-f0-9]{64}$/);
});

test("G08-A02 protected-base ratchet rejects a lowered PR baseline", () => {
  const baseThresholds = thresholdFixture({
    baseline: { ...thresholds.baseline, total: { lines: 81, branches: 71 } }
  });
  assert.throws(() => checkRelease250Coverage({
    coverageSummary: greenSummary,
    thresholds,
    baseThresholds
  }), /configured line baseline decreased from protected base/i);
  assert.throws(() => checkRelease250Coverage({
    coverageSummary: greenSummary,
    thresholds: thresholdFixture({ baseline: { ...thresholds.baseline, total: { lines: 81, branches: 70 } } }),
    baseThresholds
  }), /node-v8-branch baseline decreased from protected base/i);

  const ratcheted = checkRelease250Coverage({
    coverageSummary: greenSummary,
    thresholds: thresholdFixture({ baseline: { ...thresholds.baseline, total: { lines: 81, branches: 71 } } }),
    baseThresholds
  });
  assert.equal(ratcheted.ratchetMode, "protected-base-ratchet");
});

test("G08-A03 initial adoption fails closed without explicit metadata", () => {
  const invalid = thresholdFixture({ baselinePolicy: { mode: "protected-base-ratchet", initialAdoption: { baseConfigAbsent: false, reason: "" } } });
  assert.throws(() => checkRelease250Coverage({
    coverageSummary: greenSummary,
    thresholds: invalid,
    baseThresholdsAbsent: true
  }), /initial coverage baseline adoption requires explicit/i);
});

test("G08-A04 rejects unmeasured/regressed coverage and changed business gaps", () => {
  assert.throws(() => checkRelease250Coverage({
    coverageSummary: { ...greenSummary, meta: { ...greenSummary.meta, measured: false } },
    thresholds
  }), /must be produced from measured coverage/i);
  assert.throws(() => checkRelease250Coverage({
    coverageSummary: { ...greenSummary, total: { lines: { pct: 79 }, branches: { pct: 72 } } },
    thresholds
  }), /line coverage regressed/i);
  assert.throws(() => checkRelease250Coverage({
    coverageSummary: greenSummary,
    thresholds,
    changedFiles: ["apps/api/src/lib/missing-coverage.js"]
  }), /missing from coverage summary/i);
  assert.throws(() => checkRelease250Coverage({
    coverageSummary: greenSummary,
    thresholds,
    coveragePath: "coverage/other-summary.json"
  }), /does not match baseline artifact/i);
});

test("G08-A05 changed auth and web media strict files fail closed when missing or under 100", () => {
  const media = "apps/web/src/lib/features/room/client/media/screen-receiver-demand.ts";
  assert.throws(() => checkRelease250Coverage({
    coverageSummary: greenSummary,
    thresholds,
    changedFiles: [media]
  }), /changed business file is missing|changed strict file is missing/i);
  assert.throws(() => checkRelease250Coverage({
    coverageSummary: {
      ...greenSummary,
      files: { ...greenSummary.files, [media]: { lines: { pct: 100 }, branches: { pct: 99.99 } } }
    },
    thresholds,
    changedFiles: [media]
  }), /requires 100% node-v8-branch/i);
  assert.throws(() => checkRelease250Coverage({
    coverageSummary: {
      ...greenSummary,
      files: {
        ...greenSummary.files,
        "apps/api/src/domains/admission/gate-credential-signer.js": { lines: { pct: 100 }, branches: { pct: 99 } }
      }
    },
    thresholds,
    changedFiles: ["apps/api/src/domains/admission/gate-credential-signer.js"]
  }), /requires 100% node-v8-branch/i);
});

test("G08-A06 collector unions complementary raw V8 ranges across shards", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "g08-v8-union-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, "apps/api/src/decision.js");
  const v8Dir = path.join(root, "v8");
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.mkdirSync(v8Dir);
  const source = "export function decision(value) { return value ? 'yes' : 'no'; }\n";
  fs.writeFileSync(sourcePath, source);
  const scriptUrl = new URL(`file://${sourcePath}`).href;
  const functions = (left, right) => [{
    functionName: "decision",
    ranges: [
      { startOffset: 0, endOffset: source.length, count: 1 },
      { startOffset: 34, endOffset: 48, count: left },
      { startOffset: 51, endOffset: 57, count: right }
    ]
  }];
  fs.writeFileSync(path.join(v8Dir, "one.json"), JSON.stringify({ result: [{ url: scriptUrl, functions: functions(1, 0) }] }));
  fs.writeFileSync(path.join(v8Dir, "two.json"), JSON.stringify({ result: [{ url: scriptUrl, functions: functions(0, 1) }] }));
  const summary = collectRelease250V8Coverage({
    v8Dir,
    root,
    thresholds: thresholdFixture({
      baseline: { ...thresholds.baseline, total: { lines: 0, branches: 0 } },
      businessPathPatterns: ["apps/api/src/"]
    })
  });
  assert.deepEqual(summary.files["apps/api/src/decision.js"].branches, { total: 2, covered: 2, skipped: 0, pct: 100 });
  assert.equal(summary.meta.branchMetric, "node-v8-branch");
  assert.match(summary.meta.semantics, /not Istanbul AST branch coverage/);
});

test("G08 admission signer exported decisions are fully exercised", () => {
  assert.throws(() => createGateCredentialSigner(), /at least 32/);
  assert.throws(() => createGateCredentialSigner({ secret: " short " }), /at least 32/);
  const signer = createGateCredentialSigner({ secret: SECRET, now: 1000 });
  assert.throws(() => signer.sign(), /invalid gate credential payload/i);
  const valid = {
    credentialId: "cred-g08",
    expiresAt: 2000,
    issuedAt: 1000,
    peerId: "peer-g08",
    principalEpoch: 0,
    principalId: "principal-g08",
    principalType: "guest",
    roomId: "room-g08"
  };
  for (const patch of [
    { credentialId: "" }, { roomId: "" }, { peerId: "" }, { principalId: "" }, { principalType: "other" },
    { principalEpoch: Number.NaN }, { principalEpoch: -1 }, { issuedAt: Number.NaN },
    { expiresAt: Number.NaN }, { expiresAt: 1000 }
  ]) assert.throws(() => signer.sign({ ...valid, ...patch }), /invalid gate credential/i);
  const credential = signer.sign({ ...valid, expiresAt: Date.now() + 10000 });
  assert.equal(signer.hash(credential).length, 64);
  assert.equal(signer.hash(), crypto.createHash("sha256").update("").digest("hex"));
  assert.equal(signer.verify(credential).ok, true);
  assert.equal(signer.verify("").code, "malformed");
  assert.equal(signer.verify(`wrong.${credential.split(".").slice(1).join(".")}`).code, "malformed");
  assert.equal(signer.verify(`${credential}x`).code, "bad_signature");
  const parts = credential.split(".");
  assert.equal(signer.verify(`${parts[0]}.${parts[1]}.${"x".repeat(parts[2].length)}`).code, "bad_signature");

  const signedClaims = (claimsText) => {
    const payload = Buffer.from(claimsText).toString("base64url");
    const signature = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
    return `vrg1.${payload}.${signature}`;
  };
  assert.equal(signer.verify(signedClaims("{" )).code, "malformed_payload");
  assert.equal(signer.verify(signedClaims("")).code, "malformed_payload");
  for (const claims of [
    { ...JSON.parse(Buffer.from(parts[1], "base64url").toString()), iat: null },
    { ...JSON.parse(Buffer.from(parts[1], "base64url").toString()), exp: null },
    { ...JSON.parse(Buffer.from(parts[1], "base64url").toString()), pEpoch: 1.5 },
    { ...JSON.parse(Buffer.from(parts[1], "base64url").toString()), pEpoch: -1 },
    { ...JSON.parse(Buffer.from(parts[1], "base64url").toString()), exp: 1000 }
  ]) assert.equal(signer.verify(signedClaims(JSON.stringify(claims))).code, "invalid_claims");
  const expiredCredential = createGateCredentialSigner({ secret: SECRET, now: () => 1000 }).sign(valid);
  const expiredSigner = createGateCredentialSigner({ secret: SECRET, now: () => 2000 });
  assert.equal(expiredSigner.verify(expiredCredential).code, "expired");
  const defaulted = createGateCredentialSigner({ secret: SECRET }).sign({ ...valid, credentialId: undefined, issuedAt: undefined, expiresAt: Date.now() + 10000 });
  assert.equal(createGateCredentialSigner({ secret: SECRET }).verify(defaulted).ok, true);
});

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.writes = [];
    this.destroyed = false;
    this.pipes = [];
  }
  write(value) { this.writes.push(value); return true; }
  destroy() { this.destroyed = true; }
  pipe(target) { this.pipes.push(target); return target; }
}

test("G08 admission gate service exported decisions and server paths are exercised", async (t) => {
  assert.deepEqual(extractCredential(), { credential: "", strippedPath: "/" });
  assert.throws(() => createLiveKitAuthGateService({ roomStore: {}, secret: SECRET, upstreamUrl: "http://livekit" }), /must be ws/);
  const oldInternal = process.env.LIVEKIT_INTERNAL_URL;
  const oldPublic = process.env.LIVEKIT_URL;
  t.after(() => {
    if (oldInternal === undefined) delete process.env.LIVEKIT_INTERNAL_URL; else process.env.LIVEKIT_INTERNAL_URL = oldInternal;
    if (oldPublic === undefined) delete process.env.LIVEKIT_URL; else process.env.LIVEKIT_URL = oldPublic;
  });
  const signer = createGateCredentialSigner({ secret: SECRET, now: () => 1000 });
  const credential = signer.sign({
    credentialId: "cred", expiresAt: Date.now() + 10000, issuedAt: 1000, peerId: "peer", principalEpoch: 0,
    principalId: "principal", principalType: "account", roomId: "room"
  });
  let ready = true;
  let decision = "allowed";
  const store = {
    assertLiveKitGateReady: async () => { if (!ready) throw new Error("not ready"); },
    verifyLiveKitGateCredential: async () => { if (decision === "throw") throw new Error("db down"); return { status: decision }; }
  };
  const errors = [];
  const gate = createLiveKitAuthGateService({ roomStore: store, secret: SECRET, gatePath: "rtc", upstreamUrl: "ws://livekit.example", logger: { error: (...args) => errors.push(args) } });
  assert.equal(gate.path, "/rtc");
  assert.equal(createLiveKitAuthGateService({ roomStore: store, secret: SECRET, gatePath: "", upstreamUrl: "" }).path, "/rtc");
  process.env.LIVEKIT_INTERNAL_URL = "ws://internal.example";
  assert.equal(createLiveKitAuthGateService({ roomStore: store, secret: SECRET }).upstream.hostname, "internal.example");
  delete process.env.LIVEKIT_INTERNAL_URL;
  process.env.LIVEKIT_URL = "ws://public.example";
  assert.equal(createLiveKitAuthGateService({ roomStore: store, secret: SECRET }).upstream.hostname, "public.example");
  delete process.env.LIVEKIT_URL;
  assert.equal(createLiveKitAuthGateService({ roomStore: store, secret: SECRET }).upstream.hostname, "127.0.0.1");
  assert.ok(createLiveKitAuthGateService({ pool: {}, secret: SECRET, upstreamUrl: "ws://livekit" }));
  assert.ok(createLiveKitAuthGateService({ databaseUrl: "postgresql://localhost/voice", secret: SECRET, upstreamUrl: "ws://livekit" }));
  assert.equal((await gate.authorize(`/rtc?vr_gate_credential=${credential}`)).ok, true);
  decision = "denied";
  assert.equal((await gate.authorize(`/rtc?vr_gate_credential=${credential}`)).code, "denied");
  assert.equal((await gate.authorize("/rtc")).code, "malformed");
  const server = gate.createServer();
  t.after(() => server.close());

  const response = () => ({ status: 0, body: "", writeHead(status) { this.status = status; }, end(body = "") { this.body += body; } });
  let res = response();
  server.emit("request", { url: "/readyz" }, res);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(res.status, 200);
  ready = false;
  res = response();
  server.emit("request", { url: "/readyz" }, res);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(res.status, 503);
  res = response();
  server.emit("request", { url: "/missing" }, res);
  assert.equal(res.status, 404);

  const missingPathSocket = new FakeSocket();
  server.emit("upgrade", { url: "/other", headers: {} }, missingPathSocket, Buffer.alloc(0));
  assert.match(String(missingPathSocket.writes[0]), /404 Not Found/);
  const missingUrlSocket = new FakeSocket();
  server.emit("upgrade", { headers: {} }, missingUrlSocket, Buffer.alloc(0));
  assert.match(String(missingUrlSocket.writes[0]), /404 Not Found/);
  const deniedSocket = new FakeSocket();
  server.emit("upgrade", { url: "/rtc", headers: {} }, deniedSocket, Buffer.alloc(0));
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(String(deniedSocket.writes[0]), /403 Forbidden/);

  const originalConnect = net.connect;
  t.after(() => { net.connect = originalConnect; });
  decision = "allowed";
  const upstream = new FakeSocket();
  net.connect = () => upstream;
  const client = new FakeSocket();
  server.emit("upgrade", {
    url: `/rtc?vr_gate_credential=${credential}`,
    headers: { host: "gate", "x-vr-gate-credential": "remove", array: ["a", "b"], skip: undefined }
  }, client, Buffer.from("head"));
  await new Promise((resolve) => setImmediate(resolve));
  upstream.emit("connect");
  assert.match(String(upstream.writes[0]), /^GET \/rtc HTTP\/1\.1/);
  assert.equal(upstream.writes[1].toString(), "head");

  const secureGate = createLiveKitAuthGateService({ roomStore: store, secret: SECRET, upstreamUrl: "wss://secure-livekit.example" });
  const secureServer = secureGate.createServer();
  t.after(() => secureServer.close());
  const secureUpstream = new FakeSocket();
  net.connect = () => secureUpstream;
  secureServer.emit("upgrade", { url: `/rtc?vr_gate_credential=${credential}`, headers: {} }, new FakeSocket(), Buffer.alloc(0));
  await new Promise((resolve) => setImmediate(resolve));

  const upstreamError = new FakeSocket();
  net.connect = () => upstreamError;
  const errorClient = new FakeSocket();
  server.emit("upgrade", { url: `/rtc?vr_gate_credential=${credential}`, headers: {} }, errorClient, Buffer.alloc(0));
  await new Promise((resolve) => setImmediate(resolve));
  upstreamError.emit("error", new Error("connect failed"));
  assert.match(String(errorClient.writes[0]), /503 Service Unavailable/);

  decision = "throw";
  const authErrorClient = new FakeSocket();
  server.emit("upgrade", { url: `/rtc?vr_gate_credential=${credential}`, headers: {} }, authErrorClient, Buffer.alloc(0));
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(String(authErrorClient.writes[0]), /503 Service Unavailable/);
  assert.equal(errors.length, 2);

  const mainEnv = (extra) => ({
    ...process.env,
    LIVEKIT_GATE_SECRET: SECRET,
    ...extra,
    ...(process.env.G08_V8_DIR ? { NODE_V8_COVERAGE: path.resolve(process.env.G08_V8_DIR) } : {})
  });
  const invalidSecretMain = spawnSync(process.execPath, [require.resolve("../../apps/api/src/domains/admission/livekit-auth-gate-service.js")], {
    encoding: "utf8",
    env: mainEnv({ LIVEKIT_GATE_SECRET: "short" })
  });
  assert.equal(invalidSecretMain.status, 1);
  assert.match(invalidSecretMain.stderr, /failed to start/i);
  const defaultHostMain = spawnSync(process.execPath, [require.resolve("../../apps/api/src/domains/admission/livekit-auth-gate-service.js")], {
    encoding: "utf8",
    env: mainEnv({ LIVEKIT_GATE_PORT: "-1", LIVEKIT_GATE_HOST: "" })
  });
  assert.equal(defaultHostMain.status, 1);
  const defaultPortMain = spawnSync(process.execPath, [require.resolve("../../apps/api/src/domains/admission/livekit-auth-gate-service.js")], {
    encoding: "utf8",
    env: mainEnv({ LIVEKIT_GATE_PORT: "", LIVEKIT_GATE_HOST: "256.256.256.256" })
  });
  assert.equal(defaultPortMain.status, 1);
});
