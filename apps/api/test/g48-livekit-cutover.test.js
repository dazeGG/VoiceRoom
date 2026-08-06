'use strict';

process.env.ROOM_CREATE_POW_DIFFICULTY = '0';
process.env.LIVEKIT_GATE_SECRET = 'g48-test-livekit-gate-secret-at-least-32-bytes';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createApiApp } = require('../src/server');
const { renderPrometheus, resetMetricsForTest } = require('../src/lib/metrics');
const { createCredentialBoundaryService } = require('../src/domains/admission/credential-boundary-service');
const { createLiveKitAuthGateService } = require('../src/domains/admission/livekit-auth-gate-service');

test('G48 supplemental source contract keeps admission ordering visible', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/server.js'), 'utf8');
  const start = source.indexOf('async function handleLiveKitToken');
  const end = source.indexOf('\nfunction handlePowChallenge', start);
  const handler = source.slice(start, end);
  assert.match(handler, /findRoomBan/);
  assert.match(handler, /normalizeGatePrincipal/);
  assert.match(handler, /provider\.issueAdmission/);
  assert.match(handler, /persistSuccessfulAdmission/);
  assert.match(handler, /revokeIssuedAdmission/);
  assert.ok(handler.indexOf('provider.issueAdmission') < handler.indexOf('persistSuccessfulAdmission'));
});

test('G48 supplemental source contract keeps revoke-before-remove ordering visible', () => {
  const root = path.resolve(__dirname, '../src');
  const runtime = fs.readFileSync(path.join(root, 'realtime/room-runtime.js'), 'utf8');
  const leaveStart = runtime.indexOf('async function disconnectAccountFromRoom');
  const leaveEnd = runtime.indexOf('\n  async function updatePeerState', leaveStart);
  const leave = runtime.slice(leaveStart, leaveEnd);
  assert.ok(leave.indexOf('revokePrincipalOnce') < leave.indexOf('removeLiveKitParticipant'));
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /revokePrincipalInTransaction:[\s\S]*revokeLiveKitGatePrincipalInTransaction/);
  assert.match(server, /afterBanCommitted:[\s\S]*disconnectModeratedPeer/);
});

test('G48-A04 real credential boundary survives restart, supports multitab, and rejects replay, tamper and ban-during-mint', async () => {
  const rows = new Map(); const epochs = new Map(); let revokeDuringCreate = false;
  const key = (principal, roomId) => `${roomId}:${principal.principalType}:${principal.principalId}`;
  const store = {
    async assertLiveKitGateReady() {},
    async getLiveKitGatePrincipalEpoch({ principal, roomId }) { return { status: 'ready', epoch: epochs.get(key(principal, roomId)) || 0 }; },
    async createLiveKitGateCredential(input) { if (revokeDuringCreate) epochs.set(key(input.principal, input.roomId), input.principalEpoch + 1); rows.set(input.credentialHash, input); return { status: 'created' }; },
    async verifyLiveKitGateCredential(input) { const row = rows.get(input.credentialHash); const epoch = epochs.get(`${input.roomId}:${input.principalType}:${input.principalId}`) || 0; return row && row.peerId === input.peerId && row.principalEpoch === input.principalEpoch && epoch === input.principalEpoch ? { status: 'allowed' } : { status: 'denied' }; },
    async revokeLiveKitGatePrincipal({ principal, roomId }) { const next = (epochs.get(key(principal, roomId)) || 0) + 1; epochs.set(key(principal, roomId), next); return { status: 'revoked', epoch: next }; }
  };
  const principal = { principalType: 'account', principalId: 'user-1' };
  const boundary = createCredentialBoundaryService({ roomStore: store, secret: process.env.LIVEKIT_GATE_SECRET });
  const first = await boundary.issueCredential({ roomId: 'room', peerId: 'tab-one', principal });
  const second = await boundary.issueCredential({ roomId: 'room', peerId: 'tab-two', principal });
  const restartedGate = createLiveKitAuthGateService({ boundary, roomStore: store, upstreamUrl: 'ws://127.0.0.1:7880' });
  assert.equal((await restartedGate.authorize(`/rtc?vr_gate_credential=${encodeURIComponent(first.credential.value)}`)).ok, true);
  assert.equal((await restartedGate.authorize(`/rtc?vr_gate_credential=${encodeURIComponent(second.credential.value)}`)).ok, true);
  const stolenAndTampered = `${first.credential.value.slice(0, -1)}x`;
  assert.equal((await restartedGate.authorize(`/rtc?vr_gate_credential=${encodeURIComponent(stolenAndTampered)}`)).ok, false);
  await boundary.revokePrincipal({ roomId: 'room', principal });
  assert.equal((await restartedGate.authorize(`/rtc?vr_gate_credential=${encodeURIComponent(first.credential.value)}`)).ok, false);
  assert.equal((await restartedGate.authorize(`/rtc?vr_gate_credential=${encodeURIComponent(second.credential.value)}`)).ok, false);
  revokeDuringCreate = true;
  const raced = await boundary.issueCredential({ roomId: 'room', peerId: 'raced', principal });
  assert.equal(raced.status, 'issued');
  assert.equal((await restartedGate.authorize(`/rtc?vr_gate_credential=${encodeURIComponent(raced.credential.value)}`)).ok, false);
});

test('G48-A03 issued credential fails closed when membership persistence and revoke both fail', async (t) => {
  resetMetricsForTest(); const rooms = new Map();
  const store = {
    async countQuotaRoomsForIp() { return 0; }, async countRooms() { return rooms.size; },
    async createRoom({ roomId, creatorIp, isStatic, name = '', now = Date.now() }) { const room = { id: roomId, creatorIp, isStatic, name, createdAt: now, updatedAt: now, emptySince: now, peers: new Map() }; rooms.set(roomId, room); return room; },
    async createRoomWithQuota(input) { return { status: 'created', room: await this.createRoom(input) }; },
    async getRoom(id) { return rooms.get(id) || null; }, async markRoomActive() {}, async markRoomEmpty() {}, async pruneRooms() {}, async listSummaryRecipientUserIds() { return []; },
    async getOrCreatePeerIdentity({ peerId }) { return { status: 'created', identity: { id: peerId, peerId, avatarColorKey: 'green' } }; },
    normalizeGatePrincipal({ accountUserId, guestPrincipalId, roomId }) { return accountUserId ? { principalType: 'account', principalId: accountUserId } : { principalType: 'guest', principalId: `${roomId}:${guestPrincipalId}` }; },
    async getLiveKitGatePrincipalEpoch() { return { status: 'ready', epoch: 0 }; }, async createLiveKitGateCredential() { return { status: 'created' }; }, async verifyLiveKitGateCredential() { return { status: 'allowed' }; },
    async revokeLiveKitGatePrincipal() { throw new Error('revoke unavailable'); }
  };
  const app = createApiApp({ store, users: { async getSessionUser() { return { user: { id: 'account', avatarColorKey: 'green' } }; } }, liveKitCredentials: { async issueAdmission() { return { status: 'issued', admission: { token: 'issued', room: 'room', url: 'ws://gate', ttlSeconds: 60 } }; } }, membershipServicesOverride: { service: { async persistSuccessfulAdmission() { throw new Error('membership unavailable'); } } } });
  t.after(() => app.close());
  const room = await app.inject({ method: 'POST', url: '/api/rooms', payload: { isStatic: false } });
  const response = await app.inject({ method: 'POST', url: '/api/livekit-token', headers: { cookie: 'vr_session=session' }, payload: { name: 'Account', peerId: 'peer0001', roomId: room.json().roomId, sessionToken: 'goodtoken123456789012345678901234' } });
  assert.equal(response.statusCode, 500); assert.doesNotMatch(response.body, /issued/);
  assert.match(renderPrometheus(), /voice_room_credential_revoke_cleanup_failures_total 1/);
});
