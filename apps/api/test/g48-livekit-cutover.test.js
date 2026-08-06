'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

test('G48-A01 HTTP admission uses the external gate and membership/ban cutover', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/server.js'), 'utf8');
  const start = source.indexOf('async function handleLiveKitToken');
  const end = source.indexOf('\nfunction handlePowChallenge', start);
  const handler = source.slice(start, end);
  assert.match(handler, /findRoomBan/);
  assert.match(handler, /normalizeGatePrincipal/);
  assert.match(handler, /provider\.issueAdmission/);
  assert.match(handler, /persistSuccessfulAdmission/);
  assert.match(handler, /revokePrincipal/);
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
