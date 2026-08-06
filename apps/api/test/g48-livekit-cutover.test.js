'use strict';

process.env.ROOM_CREATE_POW_DIFFICULTY = '0';
process.env.LIVEKIT_GATE_SECRET = 'g48-test-livekit-gate-secret-at-least-32-bytes';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createApiApp } = require('../src/server');
const { renderPrometheus, resetMetricsForTest } = require('../src/lib/metrics');

test('G48-A01 HTTP admission uses the external gate and membership/ban cutover', () => {
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

test('G48-A02 leave and ban revoke before participant removal and success', () => {
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
