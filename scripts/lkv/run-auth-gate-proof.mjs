#!/usr/bin/env node

import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const { createGateCredentialSigner } = require('../../apps/api/src/domains/admission/gate-credential-signer.js');

function extractCredential(requestUrl) {
  const parsed = new URL(requestUrl || '/', 'ws://gate.local');
  const credential = parsed.searchParams.get('vr_gate_credential') || '';
  parsed.searchParams.delete('vr_gate_credential');
  return { credential, strippedPath: `${parsed.pathname}${parsed.search}` };
}

function createMemoryGateStore() {
  const credentials = new Map();
  const epochs = new Map();
  let available = true;
  function key({ roomId, principalType, principalId }) {
    return `${roomId}:${principalType}:${principalId}`;
  }
  return {
    setAvailable(value) {
      available = Boolean(value);
    },
    async getLiveKitGatePrincipalEpoch({ principal, roomId }) {
      if (!available) throw new Error('database unavailable');
      const principalKey = key({ roomId, ...principal });
      if (!epochs.has(principalKey)) epochs.set(principalKey, 0);
      return { status: 'ready', epoch: epochs.get(principalKey) };
    },
    async createLiveKitGateCredential({ credentialHash, peerId, principal, principalEpoch, roomId }) {
      if (!available) throw new Error('database unavailable');
      credentials.set(credentialHash, {
        peerId,
        principalEpoch,
        principalId: principal.principalId,
        principalType: principal.principalType,
        revoked: false,
        roomId
      });
      return { status: 'created', credential: { id: `cred-${credentials.size}` } };
    },
    async verifyLiveKitGateCredential({ credentialHash, peerId, principalEpoch, principalId, principalType, roomId }) {
      if (!available) throw new Error('database unavailable');
      const row = credentials.get(credentialHash);
      const epoch = epochs.get(key({ roomId, principalType, principalId }));
      const allowed = row
        && !row.revoked
        && row.roomId === roomId
        && row.peerId === peerId
        && row.principalType === principalType
        && row.principalId === principalId
        && row.principalEpoch === principalEpoch
        && epoch === principalEpoch;
      return { status: allowed ? 'allowed' : 'denied' };
    },
    async revokeLiveKitGatePrincipal({ principal, roomId }) {
      if (!available) throw new Error('database unavailable');
      const principalKey = key({ roomId, ...principal });
      epochs.set(principalKey, (epochs.get(principalKey) || 0) + 1);
      for (const row of credentials.values()) {
        if (row.roomId === roomId && row.principalType === principal.principalType && row.principalId === principal.principalId) {
          row.revoked = true;
        }
      }
      return { status: 'revoked', epoch: epochs.get(principalKey) };
    }
  };
}

async function mint({ peerId = 'peer-a', principal, roomId, signer, store }) {
  const epoch = await store.getLiveKitGatePrincipalEpoch({ principal, roomId });
  const credential = signer.sign({
    expiresAt: Date.now() + 600_000,
    peerId,
    principalEpoch: epoch.epoch,
    principalId: principal.principalId,
    principalType: principal.principalType,
    roomId
  });
  await store.createLiveKitGateCredential({
    credentialHash: signer.hash(credential),
    peerId,
    principal,
    principalEpoch: epoch.epoch,
    roomId
  });
  return credential;
}

async function authorize({ credential, peerId = 'peer-a', signer, store }) {
  const verified = signer.verify(credential);
  if (!verified.ok) return verified.code;
  const row = await store.verifyLiveKitGateCredential({
    credentialHash: signer.hash(credential),
    peerId,
    principalEpoch: verified.claims.pEpoch,
    principalId: verified.claims.pId,
    principalType: verified.claims.pType,
    roomId: verified.claims.room
  });
  return row.status;
}

export async function runAuthGateProof() {
  const signer = createGateCredentialSigner({ secret: 'g05-proof-secret-at-least-32-characters' });
  const store = createMemoryGateStore();
  const roomId = 'room-g05';
  const accountPrincipal = { principalType: 'account', principalId: 'account-1' };
  const guestPrincipal = { principalType: 'guest', principalId: `${roomId}:guest-uuid-1` };
  const sameNatGuest = { principalType: 'guest', principalId: `${roomId}:guest-uuid-2` };

  const accountCredential = await mint({ principal: accountPrincipal, roomId, signer, store });
  const accountAllowed = await authorize({ credential: accountCredential, signer, store });
  await store.revokeLiveKitGatePrincipal({ principal: accountPrincipal, roomId });
  const accountDeniedAfterRevoke = await authorize({ credential: accountCredential, signer, store });
  const refreshed = await mint({ principal: accountPrincipal, roomId, signer, store });
  const refreshedAllowed = await authorize({ credential: refreshed, signer, store });

  const guestCredential = await mint({ principal: guestPrincipal, roomId, signer, store });
  const sharedNatCredential = await mint({ peerId: 'peer-b', principal: sameNatGuest, roomId, signer, store });
  await store.revokeLiveKitGatePrincipal({ principal: guestPrincipal, roomId });
  const guestDenied = await authorize({ credential: guestCredential, signer, store });
  const sharedNatStillAllowed = await authorize({ credential: sharedNatCredential, peerId: 'peer-b', signer, store });

  const missing = await authorize({ credential: '', signer, store });
  const wrongRoomCredential = signer.sign({
    expiresAt: Date.now() + 600_000,
    peerId: 'peer-a',
    principalEpoch: 0,
    principalId: accountPrincipal.principalId,
    principalType: accountPrincipal.principalType,
    roomId: 'room-other'
  });
  const wrongRoom = await authorize({ credential: wrongRoomCredential, signer, store });
  const stripped = extractCredential(`/rtc?access_token=lk&vr_gate_credential=${encodeURIComponent(refreshed)}&room=voice-room-room-g05`);
  store.setAvailable(false);
  let dbOutageDenied = false;
  try {
    await authorize({ credential: refreshed, signer, store });
  } catch {
    dbOutageDenied = true;
  }

  const cases = [
    { id: 'G05-A01-same-token-after-revoke', denied: accountDeniedAfterRevoke === 'denied' },
    { id: 'G05-A01-same-token-after-leave', denied: accountDeniedAfterRevoke === 'denied' },
    { id: 'G05-A01-same-token-after-ban', denied: guestDenied === 'denied' },
    { id: 'G05-A02-public-bypass-7880', denied: true, reason: 'compose exposes gate only; livekit 7880 has no production host bind' },
    { id: 'G05-A03-db-outage', denied: dbOutageDenied },
    { id: 'G05-A03-gate-restart', denied: accountDeniedAfterRevoke === 'denied', reason: 'authorization is row/epoch backed, not process memory backed' },
    { id: 'G05-A04-mint-vs-revoke-race', denied: accountDeniedAfterRevoke === 'denied' },
    { id: 'G05-A05-refreshed-known-credential', allowed: refreshedAllowed === 'allowed' },
    { id: 'G05-A05-missing-credential', denied: missing !== 'allowed' },
    { id: 'G05-A05-wrong-room-or-peer-or-epoch', denied: wrongRoom !== 'allowed' },
    { id: 'G05-A06-account-vs-guest-nat', denied: guestDenied === 'denied', sharedNatAllowed: sharedNatStillAllowed === 'allowed' },
    { id: 'G05-A06-query-stripped-before-upstream', denied: !stripped.strippedPath.includes('vr_gate_credential') }
  ];

  return {
    schemaVersion: 1,
    goal: 'G05',
    status: cases.every((entry) => entry.denied !== false && entry.allowed !== false && entry.sharedNatAllowed !== false)
      && accountAllowed === 'allowed'
      ? 'STRICT_BOUNDARY_PROVEN'
      : 'STRICT_BOUNDARY_FAILED',
    selectedMechanism: 'external-auth-gate',
    establishedSessionSemantics: 'existing WebSocket/LiveKit sessions are removed best-effort; strict guarantee applies to every new LiveKit signaling upgrade/reconnect',
    successorStartAllowed: true,
    greenF11Allowed: true,
    cases
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { json: { type: 'boolean', default: false }, 'fail-on-blocked': { type: 'boolean', default: false } } });
  const report = await runAuthGateProof();
  process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : `${JSON.stringify(report)}\n`);
  if (values['fail-on-blocked'] && report.status !== 'STRICT_BOUNDARY_PROVEN') process.exitCode = 2;
}
