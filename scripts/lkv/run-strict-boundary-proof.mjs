#!/usr/bin/env node

import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { runAuthGateProof } from './run-auth-gate-proof.mjs';
import { runReplayScenario } from './run-replay-scenario.mjs';

const APPROVED_SHAPE = Object.freeze({
  provider: 'livekit/livekit-server:v1.13.2',
  topology: 'docker-compose.lkv.yml',
  credentialForm: 'standard-livekit-jwt',
  appAuthority: 'VoiceRoom API can mint future credentials and remove connected participants',
  livekitAuthority: 'LiveKit validates already issued JWT signature and time claims without app callback'
});

const ATTEMPTS = Object.freeze([
  {
    id: 'G05-A01-remove-participant',
    mechanism: 'remove connected LiveKit participant',
    denied: false,
    materialChangeRequired: false,
    reason: 'Removal terminates the current connection only; the same unexpired JWT can reconnect.'
  },
  {
    id: 'G05-A01-stop-future-mints',
    mechanism: 'stop issuing new credentials after leave or ban',
    denied: false,
    materialChangeRequired: false,
    reason: 'App-side admission blocks future token issuance but cannot revoke a token already accepted by LiveKit.'
  },
  {
    id: 'G05-A02-short-ttl',
    mechanism: 'shorten token lifetime',
    denied: false,
    materialChangeRequired: false,
    reason: 'A TTL window is bounded replay, which the approved release scope explicitly rejects.'
  },
  {
    id: 'G05-A02-external-admission',
    mechanism: 'introduce external admission callback, proxy, fork or replacement provider',
    denied: true,
    materialChangeRequired: true,
    reason: 'This could deny same-token reconnects, but changes the approved topology/provider/credential architecture.'
  }
]);

export async function runStrictBoundaryProof(options = {}) {
  if (options.mechanism === 'external-auth-gate' || process.env.G05_SELECTED_MECHANISM === 'external-auth-gate') {
    return runAuthGateProof();
  }
  const replay = options.replay ?? runReplayScenario();
  const sameTokenAccepted = replay.summary.sameTokenReconnectAccepted === true;
  const inShapeAttempts = ATTEMPTS.filter((attempt) => !attempt.materialChangeRequired);
  const strictInApprovedShape = inShapeAttempts.every((attempt) => attempt.denied) && !sameTokenAccepted;
  const status = strictInApprovedShape ? 'STRICT_BOUNDARY_PROVEN' : 'BLOCKED_FOR_AMENDMENT';
  const report = {
    schemaVersion: 1,
    goal: 'G05',
    status,
    approvedShape: APPROVED_SHAPE,
    replayDigest: `sha256:${crypto.createHash('sha256').update(JSON.stringify(replay)).digest('hex')}`,
    replaySummary: replay.summary,
    attempts: ATTEMPTS,
    greenF11Allowed: status === 'STRICT_BOUNDARY_PROVEN',
    amendmentRequired: status === 'BLOCKED_FOR_AMENDMENT',
    amendmentPath: 'docs/releases/2.5.0/amendments/G05-STRICT-LKV.json',
    successorStartAllowed: status === 'STRICT_BOUNDARY_PROVEN'
  };
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      json: { type: 'boolean', default: false },
      'fail-on-blocked': { type: 'boolean', default: false }
    }
  });
  const report = await runStrictBoundaryProof({ mechanism: process.env.G05_SELECTED_MECHANISM });
  process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : `${JSON.stringify(report)}\n`);
  if (values['fail-on-blocked'] && report.status !== 'STRICT_BOUNDARY_PROVEN') process.exitCode = 2;
}
