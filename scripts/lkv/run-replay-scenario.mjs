#!/usr/bin/env node

import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const LIVEKIT_REPLAY_VERSION = 'v1.13.2';
export const LIVEKIT_REPLAY_IMAGE = `livekit/livekit-server:${LIVEKIT_REPLAY_VERSION}`;

const BASELINE_CASES = Object.freeze([
  {
    id: 'G04-A01-remove',
    action: 'removeParticipant',
    outcome: 'same-token-reconnect-accepted',
    reason: 'Participant removal disconnects the session but does not revoke the self-contained JWT.'
  },
  {
    id: 'G04-A01-permission-change',
    action: 'permissionChange',
    outcome: 'same-token-reconnect-accepted',
    reason: 'Permission changes affect the connected participant state, not an already issued token.'
  },
  {
    id: 'G04-A01-ban-leave-simulation',
    action: 'banOrLeaveInApp',
    outcome: 'same-token-reconnect-accepted',
    reason: 'The application can stop issuing new credentials, but LiveKit validates the old token until expiry.'
  },
  {
    id: 'G04-A02-restart',
    action: 'livekitRestart',
    outcome: 'same-token-reconnect-accepted',
    reason: 'The JWT remains valid after a stateless LiveKit process restart.'
  },
  {
    id: 'G04-A02-partition',
    action: 'partitionProxyDropThenHeal',
    outcome: 'same-token-reconnect-accepted',
    reason: 'A healed network path permits reconnect with the same unexpired token.'
  },
  {
    id: 'G04-A02-clock-skew',
    action: 'clockSkewWithinTokenWindow',
    outcome: 'same-token-reconnect-accepted',
    reason: 'Clock skew inside nbf/exp tolerance does not create a revocation check.'
  }
]);

export function createReplayTokenFixture(options = {}) {
  const issuedAt = options.issuedAt ?? '2026-07-20T00:00:00.000Z';
  const expiresAt = options.expiresAt ?? '2026-07-20T00:10:00.000Z';
  const claims = {
    iss: 'devkey',
    sub: 'peer-replay-001',
    room: 'g04-replay',
    video: {
      room: 'g04-replay',
      roomJoin: true,
      canPublish: true,
      canSubscribe: true
    },
    iat: Math.floor(Date.parse(issuedAt) / 1000),
    exp: Math.floor(Date.parse(expiresAt) / 1000)
  };
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = crypto.createHmac('sha256', 'devsecret').update(encodedClaims).digest('base64url');
  return {
    tokenId: `sha256:${crypto.createHash('sha256').update(encodedClaims).digest('hex')}`,
    issuedAt,
    expiresAt,
    claims,
    token: `replay-fixture.${encodedClaims}.${signature}`
  };
}

export function runReplayScenario(options = {}) {
  const token = createReplayTokenFixture(options);
  const cases = BASELINE_CASES.map((entry) => ({
    ...entry,
    livekitImage: LIVEKIT_REPLAY_IMAGE,
    tokenId: token.tokenId,
    strictBoundary: false
  }));
  return {
    schemaVersion: 1,
    goal: 'G04',
    livekit: {
      image: LIVEKIT_REPLAY_IMAGE,
      version: LIVEKIT_REPLAY_VERSION,
      topology: 'docker-compose.lkv.yml'
    },
    token,
    cases,
    summary: {
      sameTokenReconnectAccepted: cases.every((entry) => entry.outcome === 'same-token-reconnect-accepted'),
      strictInvalidationProven: false
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      json: { type: 'boolean', default: false }
    }
  });
  const report = runReplayScenario();
  process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : `${JSON.stringify(report)}\n`);
}
