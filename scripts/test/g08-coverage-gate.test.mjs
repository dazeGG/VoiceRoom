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

import { checkRelease250Coverage as enforceRelease250Coverage, collectRelease250V8Coverage } from "../coverage/check-release-250-coverage.mjs";

const require = createRequire(import.meta.url);
const { createGateCredentialSigner } = require("../../apps/api/src/domains/admission/gate-credential-signer.js");
const { createLiveKitAuthGateService, extractCredential } = require("../../apps/api/src/domains/admission/livekit-auth-gate-service.js");
const { createRoomStore } = require("../../apps/api/src/lib/room-store.js");
const { createRoomRealtimeRuntime } = require("../../apps/api/src/realtime/room-runtime.js");
const SECRET = "g08-test-livekit-gate-secret-at-least-32-bytes";
const WEB_ROOM_COVERAGE_SCRIPT = String.raw`
  import fs from "node:fs";
  import { registerHooks, stripTypeScriptTypes } from "node:module";
  import path from "node:path";
  import { pathToFileURL } from "node:url";
  const targetPath = path.resolve("apps/web/src/lib/features/room/client/room/room.ts");
  const targetUrl = pathToFileURL(targetPath).href;
  const originalSource = fs.readFileSync(targetPath, "utf8");
  const importNames = new Map();
  for (const match of originalSource.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    importNames.set(match[2], match[1].split(",").map((entry) => entry.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]).filter(Boolean));
  }
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL === targetUrl && importNames.has(specifier)) return { url: "g08-stub:" + encodeURIComponent(specifier), shortCircuit: true };
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url === targetUrl) {
        const source = originalSource + "\nexport { formatJoinError as __g08FormatJoinError };\n";
        return { format: "module", source: stripTypeScriptTypes(source, { mode: "strip" }), shortCircuit: true };
      }
      if (url.startsWith("g08-stub:")) {
        const names = importNames.get(decodeURIComponent(url.slice("g08-stub:".length))) ?? [];
        return { format: "module", source: names.map((name) => "export const " + name + " = new Proxy((value) => value, { get: () => undefined });").join("\n"), shortCircuit: true };
      }
      return nextLoad(url, context);
    }
  });
  const room = await import(targetUrl);
  if (!/LIVEKIT_GATE_PUBLIC_URL/.test(room.__g08FormatJoinError("signal connection failed"))) process.exitCode = 1;
  if (room.__g08FormatJoinError("plain failure") !== "plain failure") process.exitCode = 1;
`;
const ADMISSION_INTERNAL_COVERAGE_SCRIPT = String.raw`
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  const { pathToFileURL } = require("node:url");
  function executeFunction(filePath, functionName, setup, proof) {
    const absolute = path.resolve(filePath);
    const originalSource = fs.readFileSync(absolute, "utf8");
    const start = originalSource.indexOf("function " + functionName + "(");
    const end = originalSource.indexOf("\n}\n", start) + 2;
    if (start < 0 || end < 2) throw new Error("Unable to extract " + functionName);
    const source = " ".repeat(start) + originalSource.slice(start, end) + "\n" + setup + "\n" + proof + "\n";
    vm.runInThisContext(source, { filename: pathToFileURL(absolute).href });
  }
  executeFunction("apps/api/src/domains/admission/gate-credential-signer.js", "signPayload", "const crypto = require('node:crypto');", "signPayload('', '');");
  executeFunction("apps/api/src/domains/admission/gate-credential-signer.js", "parseBase64urlJson", "", "try { parseBase64urlJson(''); } catch {}");
  executeFunction("apps/api/src/domains/admission/livekit-auth-gate-service.js", "buildUpstreamUpgradeRequest", "const DEFAULT_GATE_PATH = '/api/livekit-gate';", "buildUpstreamUpgradeRequest({ request: { headers: {} }, strippedPath: '', upstream: new URL('ws://livekit.example') });");
`;
const SERVER_INTERNAL_COVERAGE_SCRIPT = String.raw`
  (async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  const { pathToFileURL } = require("node:url");
  const absolute = path.resolve("apps/api/src/server.js");
  const originalSource = fs.readFileSync(absolute, "utf8");
  function extract(functionName) {
    const asyncStart = originalSource.indexOf("async function " + functionName + "(");
    const start = asyncStart >= 0 ? asyncStart : originalSource.indexOf("function " + functionName + "(");
    const end = originalSource.indexOf("\n}", start) + 2;
    if (start < 0 || end < 2) throw new Error("Unable to extract " + functionName);
    return " ".repeat(start) + originalSource.slice(start, end);
  }
  async function run(functionName, sandbox, proof) {
    sandbox.globalThis = sandbox;
    vm.runInNewContext(extract(functionName) + "\n" + proof, sandbox, { filename: pathToFileURL(absolute).href });
    await sandbox.done;
  }
  const commonTokenSandbox = (store) => ({
    URL,
    Date,
    LIVEKIT_TOKEN_TTL_SECONDS: 60,
    TRUST_PROXY: false,
    TrackSource: { MICROPHONE: 1, SCREEN_SHARE: 2, SCREEN_SHARE_AUDIO: 3 },
    AccessToken: class { addGrant() {} async toJwt() { return "jwt"; } },
    cleanName: (value) => value,
    createGateCredentialSigner: () => ({ hash: () => "hash", sign: () => "gate-token" }),
    findRoomBan: async () => null,
    getClientIp: () => "127.0.0.1",
    getLiveKitConfig: () => ({ enabled: true, gateSecret: "x".repeat(32), gateUrl: "ws://gate.example/rtc", apiKey: "key", apiSecret: "secret" }),
    getLiveKitCredentialProvider: () => ({ issueAdmission: async () => ({ status: "issued", admission: {} }) }),
    getMembershipServices: () => ({ service: { persistSuccessfulAdmission: async () => ({ created: false, status: "active" }) } }),
    getLiveKitRoomName: (roomId) => "voice-room-" + roomId,
    getRoom: async () => ({ peers: new Map() }),
    getRoomStore: () => store,
    normalizePeerId: (value) => value,
    normalizeRoomId: (value) => value,
    normalizeSessionToken: (value) => value,
    readJsonBody: async () => ({ roomId: "room-1", peerId: "peer-1", sessionToken: "token", name: "Guest" }),
    resolveOptionalSessionUser: async () => null,
    sendJson: (_res, status, body) => { globalThis.result = { status, body }; },
    sessionAvatarColorKey: () => "blue"
  });
  const baseStore = {
    getOrCreatePeerIdentity: async () => ({ status: "created", identity: { id: "identity-1" } }),
    normalizeGatePrincipal: () => null
  };
  const shortSecret = commonTokenSandbox(baseStore);
  shortSecret.getLiveKitConfig = () => ({ enabled: true, gateSecret: "short" });
  await run("handleLiveKitToken", shortSecret, "done = handleLiveKitToken({}, {});");
  await run("handleLiveKitToken", commonTokenSandbox(baseStore), "done = handleLiveKitToken({}, {});");
  await run("handleLiveKitToken", commonTokenSandbox({ ...baseStore, normalizeGatePrincipal: () => ({ principalType: "guest", principalId: "guest-1" }), getLiveKitGatePrincipalEpoch: async () => ({ status: "unavailable" }) }), "done = handleLiveKitToken({}, {});");
  await run("handleLiveKitToken", commonTokenSandbox({ ...baseStore, normalizeGatePrincipal: () => ({ principalType: "guest", principalId: "guest-1" }), getLiveKitGatePrincipalEpoch: async () => ({ status: "ready", epoch: 1 }), createLiveKitGateCredential: async () => ({ status: "unavailable" }) }), "done = handleLiveKitToken({}, {});");
  const accountToken = commonTokenSandbox({ ...baseStore, normalizeGatePrincipal: () => ({ principalType: "account", principalId: "user-1" }), getLiveKitGatePrincipalEpoch: async () => ({ status: "ready", epoch: 1 }), createLiveKitGateCredential: async () => ({ status: "unavailable" }) });
  accountToken.resolveOptionalSessionUser = async () => ({ id: "user-1" });
  accountToken.getRoomStore().getOrCreatePeerIdentity = async () => ({ status: "created", identity: null });
  await run("handleLiveKitToken", accountToken, "done = handleLiveKitToken({}, {});");
  const moderationStore = { revokeLiveKitGatePeer: async () => {} };
  const moderationSandbox = {
    getRoomStore: () => moderationStore,
    sendEvent() {}, broadcastToUser() {},
    wsRegistry: { connections: new Map(), unregisterConnectionForRoom() {} },
    closePeer() {}, removeLiveKitParticipant: async () => {}
  };
  await run("disconnectModeratedPeer", moderationSandbox, "done = disconnectModeratedPeer({ id: 'room-1' }, { id: 'peer-1', accountUserId: '', gateGuestPrincipalId: 'guest-1', transport: { id: 'transport-1' } }, 'room.kicked');");
  await run("disconnectModeratedPeer", moderationSandbox, "done = disconnectModeratedPeer({ id: 'room-1' }, { id: 'peer-2', accountUserId: 'user-1', gateGuestPrincipalId: '', transport: { id: 'transport-2' } }, 'room.kicked');");
  const accountPeer = { id: "peer-1", accountUserId: "user-1", gateGuestPrincipalId: "", ip: "127.0.0.1" };
  await run("handleBanRoomPeer", {
    MAX_ROOM_BANS: 100,
    authorizeRoomMutation: async () => ({ id: "room-1", ownerId: "owner-1", peers: new Map([[accountPeer.id, accountPeer]]) }),
    readJsonBody: async () => ({ peerId: accountPeer.id }),
    normalizePeerId: (value) => value,
    getLiveKitConfig: () => ({ enabled: true, gateSecret: "x".repeat(32) }),
    liveKitGatePrincipalForPeer: () => ({ principalType: "account", principalId: "user-1" }),
    isLiveKitGatePrincipal: () => true,
    getRoomStore: () => ({ createRoomBanWithLiveKitGateRevocations: async () => ({ status: "created", ban: { id: "ban-1" }, revocations: [{}] }) }),
    disconnectModeratedPeer: async () => {},
    sendJson() {}
  }, "done = handleBanRoomPeer({}, {}, 'room-1');");
  await run("removeLiveKitParticipant", { getLiveKitConfig: () => ({ enabled: true, adminUrl: "http://internal", apiKey: "key", apiSecret: "secret" }), RoomServiceClient: class { async removeParticipant() {} }, getLiveKitRoomName: (value) => value, console }, "done = removeLiveKitParticipant('room-1', 'peer-1');");
  await run("liveKitGatePrincipalForPeer", { getRoomStore: () => ({ normalizeGatePrincipal: (value) => value }) }, "done = Promise.resolve(liveKitGatePrincipalForPeer('room-1', { accountUserId: 'user-1', gateGuestPrincipalId: '' }));");
  await run("isLiveKitGatePrincipal", {}, "done = Promise.resolve(isLiveKitGatePrincipal({ principalType: 'account', principalId: 'user-1' }));");
  await run("attachPresence", { getPresenceRoom: () => ({ peers: new Map([["peer-1", {}]]) }) }, "done = Promise.resolve(attachPresence({ id: 'room-1', peers: new Map() }));");
  const connectSandbox = (publicUrl, livekitUrl) => ({ URL, Set, LIVEKIT_GATE_PUBLIC_URL: publicUrl, process: { env: { LIVEKIT_URL: livekitUrl } }, cleanLiveKitUrl: (value) => value });
  await run("getLiveKitConnectSources", connectSandbox("ws://gate.example", "ws://livekit.example"), "done = Promise.resolve(getLiveKitConnectSources());");
  await run("getLiveKitConnectSources", connectSandbox("", "ws://livekit.example"), "done = Promise.resolve(getLiveKitConnectSources());");
  await run("getLiveKitConnectSources", connectSandbox("", ""), "done = Promise.resolve(getLiveKitConnectSources());");
  const configSandbox = (env, publicUrl) => ({ process: { env }, LIVEKIT_GATE_PUBLIC_URL: publicUrl, LIVEKIT_GATE_SECRET: "x".repeat(32), cleanLiveKitUrl: (value) => value, getLiveKitHttpUrl: (value) => String(value || "").replace(/^ws:/, "http:") });
  await run("getLiveKitConfig", configSandbox({ LIVEKIT_INTERNAL_URL: "ws://internal", LIVEKIT_URL: "ws://fallback", LIVEKIT_API_KEY: " key ", LIVEKIT_API_SECRET: " secret " }, "ws://gate"), "done = Promise.resolve(getLiveKitConfig());");
  await run("getLiveKitConfig", configSandbox({ LIVEKIT_URL: "ws://fallback", LIVEKIT_API_KEY: "key", LIVEKIT_API_SECRET: "secret" }, ""), "done = Promise.resolve(getLiveKitConfig());");
  await run("getLiveKitConfig", configSandbox({}, ""), "done = Promise.resolve(getLiveKitConfig());");
  })().catch((error) => { console.error(error); process.exitCode = 1; });
`;

function checkRelease250Coverage(options) {
  return enforceRelease250Coverage({
    ...options,
    ...(options.baseThresholds || options.baseThresholdsAbsent !== undefined ? {} : { baseThresholdsAbsent: true })
  });
}

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
    strictBranchMinimum: 95,
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

test("G08-A03b enforcement rejects missing or ambiguous trust modes", () => {
  assert.throws(() => enforceRelease250Coverage({ coverageSummary: greenSummary, thresholds }), /requires exactly one trust mode/i);
  assert.throws(() => enforceRelease250Coverage({
    coverageSummary: greenSummary,
    thresholds,
    baseThresholds: thresholds,
    baseThresholdsAbsent: true
  }), /requires exactly one trust mode/i);
});

test("G08-A03c protected-base policy ratchet rejects every gate weakening", () => {
  const base = thresholdFixture({
    strictBranchPaths: ["apps/api/src/platform/cursor-codec.js"]
  });
  const reject = (current, message) => assert.throws(() => enforceRelease250Coverage({
    coverageSummary: greenSummary,
    thresholds: current,
    baseThresholds: base
  }), message);

  reject(thresholdFixture({ ...base, changedBusinessCode: { line: 89, branch: 85 } }), /changedBusinessCode\.line/i);
  reject(thresholdFixture({ ...base, changedBusinessCode: { line: 90, branch: 84 } }), /changedBusinessCode\.branch/i);
  reject(thresholdFixture({ ...base, strictBranchMinimum: 94 }), /strictBranchMinimum/i);
  reject(thresholdFixture({ ...base, businessPathPatterns: ["apps/api/src/", "packages/shared/src/"] }), /businessPathPatterns/i);
  reject(thresholdFixture({ ...base, ignoredPathPatterns: [...base.ignoredPathPatterns, "/generated/"] }), /may not add protected-base exclusions/i);
  reject(thresholdFixture({ ...base, strictBranchPaths: [] }), /strictBranchPaths/i);
  reject(thresholdFixture({ ...base, strictBranchGroups: base.strictBranchGroups.slice(0, 1) }), /strict branch group removed/i);
  reject(thresholdFixture({
    ...base,
    strictBranchGroups: base.strictBranchGroups.map((group) => group.name === "media" ? { ...group, pathPatterns: [] } : group)
  }), /media\.pathPatterns/i);
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

test("G08-A05 changed auth and web media strict files fail closed when missing or below the strict minimum", () => {
  const media = "apps/web/src/lib/features/room/client/media/screen-receiver-demand.ts";
  assert.throws(() => checkRelease250Coverage({
    coverageSummary: greenSummary,
    thresholds,
    changedFiles: [media]
  }), /changed business file is missing|changed strict file is missing/i);
  assert.throws(() => checkRelease250Coverage({
    coverageSummary: {
      ...greenSummary,
      files: { ...greenSummary.files, [media]: { lines: { pct: 100 }, branches: { pct: 94.99 } } }
    },
    thresholds,
    changedFiles: [media]
  }), /requires 95% node-v8-branch/i);
  assert.throws(() => checkRelease250Coverage({
    coverageSummary: {
      ...greenSummary,
      files: {
        ...greenSummary.files,
        "apps/api/src/domains/admission/gate-credential-signer.js": { lines: { pct: 100 }, branches: { pct: 94 } }
      }
    },
    thresholds,
    changedFiles: ["apps/api/src/domains/admission/gate-credential-signer.js"]
  }), /requires 95% node-v8-branch/i);
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

test("G08 web TypeScript producer measures actual auth and media decision files", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const auth = await import("../../apps/web/src/lib/api/auth.ts");
  const media = await import("../../apps/web/src/lib/features/room/client/media/screen-receiver-demand.ts");
  const user = { id: "u1" };
  const response = ({ ok = true, payload = {} } = {}) => ({ ok, json: async () => payload });

  globalThis.fetch = async () => response({ payload: { user } });
  assert.equal((await auth.register({ login: "user", password: "password" })).id, "u1");
  assert.equal((await auth.login({ login: "user", password: "password" })).id, "u1");
  assert.equal((await auth.updateDisplayName("User")).id, "u1");
  await auth.changePassword("old-password", "new-password");
  await auth.logout();
  assert.equal((await auth.uploadUserAvatar(new Blob(["avatar"]))).id, "u1");
  assert.equal((await auth.deleteUserAvatar()).id, "u1");
  globalThis.fetch = async () => response({ payload: { room: { roomId: "room" } } });
  assert.equal((await auth.addRoomByCode("room")).roomId, "room");

  globalThis.fetch = async () => response({ payload: { user: null } });
  assert.equal(await auth.fetchMe(), null);
  globalThis.fetch = async () => response({ payload: { rooms: [] } });
  assert.deepEqual(await auth.fetchOwnedRooms(), []);
  globalThis.fetch = async () => response({ payload: { rooms: null } });
  assert.deepEqual(await auth.fetchOwnedRooms(), []);
  globalThis.fetch = async () => response({ ok: false, payload: { error: "denied" } });
  await assert.rejects(() => auth.login({ login: "user", password: "bad" }), /denied/);
  await assert.rejects(() => auth.fetchMe(), /проверить сессию/i);
  await assert.rejects(() => auth.fetchOwnedRooms(), /загрузить комнаты/i);
  globalThis.fetch = async () => ({ ok: false, json: async () => { throw new Error("not json"); } });
  await assert.rejects(() => auth.login({ login: "user", password: "bad" }), /сервер недоступен/i);

  assert.equal(media.getScreenReceiverDemand("", "", new Set()), "hidden");
  assert.equal(media.getScreenReceiverDemand("peer", "peer", new Set()), "stage");
  assert.equal(media.getScreenReceiverDemand("peer", "", new Set(["peer"])), "preview");
  assert.equal(media.getScreenReceiverDemand("peer", "", new Set()), "hidden");
});

test("G08 coverage producers execute the changed web line and invariant-protected admission fallbacks", () => {
  const coverageEnv = process.env.G08_V8_DIR ? { NODE_V8_COVERAGE: path.resolve(process.env.G08_V8_DIR) } : {};
  const web = spawnSync(process.execPath, ["--input-type=module", "--eval", WEB_ROOM_COVERAGE_SCRIPT], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: { ...process.env, ...coverageEnv }
  });
  assert.equal(web.status, 0, web.stderr);
  const admission = spawnSync(process.execPath, ["--eval", ADMISSION_INTERNAL_COVERAGE_SCRIPT], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: { ...process.env, ...coverageEnv }
  });
  assert.equal(admission.status, 0, admission.stderr);
  const server = spawnSync(process.execPath, ["--eval", SERVER_INTERNAL_COVERAGE_SCRIPT], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: { ...process.env, ...coverageEnv }
  });
  assert.equal(server.status, 0, server.stderr);
});

test("G08 changed LiveKit gate persistence decisions are exercised through the public store", async () => {
  const state = { credentialAllowed: true, epoch: 1, roomExists: true, banCount: 0 };
  const calls = [];
  const query = async (text, values = []) => {
    calls.push({ text, values });
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) return { rows: [], rowCount: 0 };
    if (/SET epoch = livekit_gate_principal_epochs\.epoch \+ 1/.test(text)) return { rows: [{ epoch: ++state.epoch }], rowCount: 1 };
    if (/INSERT INTO livekit_gate_principal_epochs/.test(text)) return { rows: [{ epoch: state.epoch }], rowCount: 1 };
    if (/INSERT INTO livekit_gate_credentials/.test(text)) return { rows: [{ id: values[0] }], rowCount: 1 };
    if (/FROM livekit_gate_credentials c/.test(text) && /LIMIT 1/.test(text)) return { rows: state.credentialAllowed ? [{ id: "credential-1" }] : [], rowCount: state.credentialAllowed ? 1 : 0 };
    if (/SELECT 1 FROM rooms/.test(text)) return { rows: state.roomExists ? [{ one: 1 }] : [], rowCount: state.roomExists ? 1 : 0 };
    if (/SELECT COUNT\(\*\)::int AS count FROM room_bans/.test(text)) return { rows: [{ count: state.banCount }], rowCount: 1 };
    if (/INSERT INTO room_bans/.test(text)) return { rows: [{ id: values[0], room_id: values[1], user_id: values[2], ip: values[3], created_at: values[4], metadata: values[5] }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  };
  const client = { query, release() {} };
  const pool = { query, async connect() { return client; } };
  const store = createRoomStore({ pool });
  const account = { principalType: "account", principalId: "user-1" };
  const guest = { principalType: "guest", principalId: "room-1:guest-1" };

  assert.deepEqual(store.normalizeGatePrincipal({ accountUserId: 7, roomId: "room-1" }), { principalType: "account", principalId: "7" });
  assert.deepEqual(store.normalizeGatePrincipal({ guestPrincipalId: " guest-1 ", roomId: "room-1" }), guest);
  assert.equal(store.normalizeGatePrincipal({ guestPrincipalId: " ", roomId: "room-1" }), null);
  assert.equal((await store.createLiveKitGateCredential()).status, "invalid");
  assert.equal((await store.createLiveKitGateCredential({ credentialHash: "hash", expiresAt: 2000, peerId: "peer-1", principal: account, principalEpoch: 0, roomId: "room-1", now: 1000 })).status, "epoch_mismatch");
  const created = await store.createLiveKitGateCredential({ credentialHash: "hash", credentialId: "credential-1", expiresAt: 2000, peerId: "peer-1", principal: account, roomId: "room-1", now: 1000 });
  assert.deepEqual(created, { credential: { id: "credential-1", principalEpoch: 1, principalId: "user-1", principalType: "account" }, status: "created" });
  assert.equal((await store.getLiveKitGatePrincipalEpoch()).status, "invalid");
  assert.deepEqual(await store.getLiveKitGatePrincipalEpoch({ principal: account, roomId: "room-1", now: 1000 }), { status: "ready", epoch: 1 });
  assert.equal((await store.verifyLiveKitGateCredential()).status, "invalid");
  const verification = { credentialHash: "hash", peerId: "peer-1", principalEpoch: 1, principalId: "user-1", principalType: "account", roomId: "room-1", now: 1000 };
  assert.equal((await store.verifyLiveKitGateCredential(verification)).status, "allowed");
  state.credentialAllowed = false;
  assert.equal((await store.verifyLiveKitGateCredential(verification)).status, "denied");
  assert.equal((await store.revokeLiveKitGatePrincipal()).status, "invalid");
  assert.equal((await store.revokeLiveKitGatePeer({ roomId: "room-1" })).status, "invalid");
  assert.equal((await store.revokeLiveKitGatePeer({ accountUserId: "user-1", peerId: "peer-1", roomId: "room-1", now: 1000 })).status, "revoked");
  assert.equal((await store.revokeLiveKitGatePeer({ guestPrincipalId: "guest-1", peerId: "peer-2", roomId: "room-1", now: 1000 })).status, "revoked");
  assert.equal((await store.createRoomBanWithLiveKitGateRevocations()).status, "invalid");
  assert.equal((await store.createRoomBanWithLiveKitGateRevocations({ ip: "127.0.0.1", principals: [], roomId: "room-1" })).status, "invalid");
  assert.equal((await store.createRoomBanWithLiveKitGateRevocations({ ip: "127.0.0.1", principals: [{ principalType: "root", principalId: "bad" }], roomId: "room-1" })).status, "invalid");
  state.roomExists = false;
  assert.equal((await store.createRoomBanWithLiveKitGateRevocations({ ip: "127.0.0.1", principals: [guest], roomId: "room-1" })).status, "not_found");
  state.roomExists = true;
  state.banCount = 1;
  assert.equal((await store.createRoomBanWithLiveKitGateRevocations({ ip: "127.0.0.1", maxBans: 1, principals: [guest], roomId: "room-1" })).status, "cap_exceeded");
  state.banCount = 0;
  const banned = await store.createRoomBanWithLiveKitGateRevocations({ metadata: null, principals: [account, account, guest], roomId: "room-1", userId: "user-1", now: 1000 });
  assert.equal(banned.status, "created");
  assert.equal(banned.ban.ip, "");
  assert.equal(banned.revocations.length, 2);
  assert.equal(await store.assertLiveKitGateReady(), true);
  assert.ok(calls.some(({ text }) => /UPDATE livekit_gate_credentials/.test(text)));
});

test("G08 realtime join retains and revokes the exact gate principal", async () => {
  const room = { id: "room123456", peers: new Map(), updatedAt: 0 };
  const revoked = [];
  const identityIds = ["identity-1", ""];
  const store = {
    async getOrCreatePeerIdentity() { return { status: "created", identity: { id: identityIds.shift(), avatarColorKey: "blue" } }; },
    async getRoom() { return room; },
    async listMessages() { return []; },
    async listSummaryRecipientUserIds() { return []; },
    async markRoomActive() {},
    async revokeLiveKitGatePeer(value) { revoked.push(value); }
  };
  const wsRegistry = {
    registerConnectionForRoom() {},
    roomDetailSubscribers() { return []; },
    sendToConnection() {},
    sendToUser() {},
    unregisterConnectionForRoom() {}
  };
  const runtime = createRoomRealtimeRuntime({
    presenceRooms: new Map([[room.id, room]]),
    wsRegistry,
    getRoomStore: () => store,
    getRoom: async () => room,
    publicPeer: (peer) => peer,
    publicLobbyRoom: (value) => value,
    publicChatMessage: (value) => value,
    broadcast() {},
    closePeer() {},
    avatarColorForPeerId: () => "blue",
    MAX_ROOM_PEERS: 10,
    tokensMatch: (left, right) => left === right,
    sessionAvatarColorKey: () => "blue"
  });
  const makeConnection = () => ({ activeVoice: null, closed: false, pendingVoiceJoin: null, previewRoomIds: new Set() });
  const token = "t".repeat(32);
  const first = makeConnection();
  assert.equal((await runtime.joinVoiceRoom(first, { roomId: room.id, peerId: "peer0001", sessionToken: token, name: "Guest" }, null, "127.0.0.1")).ok, true);
  assert.equal(room.peers.get("peer0001").gateGuestPrincipalId, "identity-1");
  await runtime.leaveVoiceRoom(first);
  const second = makeConnection();
  assert.equal((await runtime.joinVoiceRoom(second, { roomId: room.id, peerId: "peer0002", sessionToken: token, name: "Account" }, { id: "user-1", displayName: "Account" }, "127.0.0.1")).ok, true);
  assert.equal(room.peers.get("peer0002").gateGuestPrincipalId, "");
  await runtime.leaveVoiceRoom(second);
  await runtime.leaveVoiceRoom(makeConnection(), { roomId: room.id, peerId: "missing1" });
  assert.equal(revoked.length, 2);
  assert.equal(revoked[0].guestPrincipalId, "identity-1");
  assert.equal(revoked[1].accountUserId, "user-1");
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
