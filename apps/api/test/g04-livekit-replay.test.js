'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

test('G04-A01 replay harness pins LiveKit v1.13.2 and records same-token baseline reconnects', async () => {
  const compose = fs.readFileSync('docker-compose.lkv.yml', 'utf8');
  assert.match(compose, /livekit\/livekit-server:v1\.13\.2/);
  assert.match(compose, /partition-proxy/);

  const { LIVEKIT_REPLAY_IMAGE, runReplayScenario } = await import('../../../scripts/lkv/run-replay-scenario.mjs');
  const report = runReplayScenario();

  assert.equal(LIVEKIT_REPLAY_IMAGE, 'livekit/livekit-server:v1.13.2');
  assert.equal(report.livekit.version, 'v1.13.2');
  assert.equal(report.token.claims.video.roomJoin, true);
  assert.equal(report.summary.sameTokenReconnectAccepted, true);
  assert.equal(report.summary.strictInvalidationProven, false);

  const requiredActions = new Set(['removeParticipant', 'permissionChange', 'banOrLeaveInApp']);
  for (const action of requiredActions) {
    const row = report.cases.find((entry) => entry.action === action);
    assert.ok(row, `missing ${action}`);
    assert.equal(row.outcome, 'same-token-reconnect-accepted');
    assert.equal(row.tokenId, report.token.tokenId);
  }
});

test('G04-A02 replay harness covers restart, partition and clock skew fixtures', async () => {
  const { buildReplayTopologyCommand } = await import('../../../scripts/lkv/start-replay-topology.mjs');
  const { createPartitionProxy } = await import('../../../scripts/lkv/partition-proxy.mjs');
  const { collectReplayEvidence } = await import('../../../scripts/lkv/collect-replay-evidence.mjs');
  const { runReplayScenario } = await import('../../../scripts/lkv/run-replay-scenario.mjs');

  const command = buildReplayTopologyCommand({ detach: true });
  assert.deepEqual(command.args, ['compose', '-f', 'docker-compose.lkv.yml', 'up', '-d']);
  assert.equal(command.env.LIVEKIT_REPLAY_IMAGE, 'livekit/livekit-server:v1.13.2');

  const proxy = createPartitionProxy({ listenPort: 0, targetHost: '127.0.0.1', targetPort: 9 });
  proxy.setMode('partitioned');
  assert.equal(proxy.state.mode, 'partitioned');
  proxy.setMode('open');
  assert.equal(proxy.state.mode, 'open');

  const report = runReplayScenario();
  const actions = new Set(report.cases.map((entry) => entry.action));
  assert.ok(actions.has('livekitRestart'));
  assert.ok(actions.has('partitionProxyDropThenHeal'));
  assert.ok(actions.has('clockSkewWithinTokenWindow'));

  const evidence = collectReplayEvidence({ scenario: report, producedAt: '2026-07-20T00:00:00.000Z' });
  assert.match(evidence.scenarioDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidence.scenario.summary.sameTokenReconnectAccepted, true);
});

test('G04 replay scenario CLI emits deterministic JSON', () => {
  const result = spawnSync(process.execPath, ['scripts/lkv/run-replay-scenario.mjs', '--json'], {
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.goal, 'G04');
  assert.equal(report.cases.length, 6);
  assert.equal(new Set(report.cases.map((entry) => entry.tokenId)).size, 1);
});
