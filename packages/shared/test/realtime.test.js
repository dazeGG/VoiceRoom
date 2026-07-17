'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_VISIBLE_ROOM_PEERS,
  parseClientEnvelope,
  buildServerEnvelope,
  toRoomPeerSummary,
  buildRoomRealtimeSummary,
  validateClientCommand
} = require('../src/realtime');

test('parseClientEnvelope accepts valid envelopes', () => {
  const result = parseClientEnvelope(JSON.stringify({ type: 'ping', payload: { at: 1 } }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.envelope.type, 'ping');
  assert.equal(result.envelope.payload.at, 1);
});

test('parseClientEnvelope rejects malformed input', () => {
  assert.equal(parseClientEnvelope('').ok, false);
  assert.equal(parseClientEnvelope('{').ok, false);
  assert.equal(parseClientEnvelope(JSON.stringify({ payload: {} })).ok, false);
});

test('buildRoomRealtimeSummary caps visible peers and sets hiddenPeerCount', () => {
  const peers = Array.from({ length: 8 }, (_, index) => ({
    id: `peer-${index}`,
    name: `User ${index}`,
    muted: false,
    avatarAccent: '#123456',
    avatarColorKey: 'blue',
    avatarUrl: `/api/avatars/av_${index}_deadbeef.webp`
  }));

  const summary = buildRoomRealtimeSummary(
    {
      id: 'room1',
      name: 'Lobby',
      isStatic: true,
      relationship: 'owner',
      avatarUrl: '/api/avatars/room_room1_deadbeef.webp'
    },
    peers
  );

  assert.equal(summary.peers, 8);
  assert.equal(summary.visiblePeers.length, MAX_VISIBLE_ROOM_PEERS);
  assert.equal(summary.hiddenPeerCount, 3);
  assert.equal(summary.name, 'Lobby');
  assert.equal(summary.avatarUrl, '/api/avatars/room_room1_deadbeef.webp');
  assert.equal(summary.visiblePeers[0].avatarAccent, '#123456');
  assert.equal(summary.visiblePeers[0].avatarUrl, '/api/avatars/av_0_deadbeef.webp');
  assert.equal('emoji' in summary, false);
});

test('realtime avatar fields remain nullable for legacy summaries', () => {
  const peer = toRoomPeerSummary({ id: 'peer-1', name: 'Guest', muted: false });
  const summary = buildRoomRealtimeSummary({ id: 'room1' }, [peer]);

  assert.equal(peer.avatarAccent, null);
  assert.equal(peer.avatarUrl, null);
  assert.equal(summary.avatarUrl, null);
  assert.equal(summary.visiblePeers[0].avatarAccent, null);
  assert.equal(summary.visiblePeers[0].avatarUrl, null);
});

test('validateClientCommand enforces ping payload', () => {
  assert.equal(validateClientCommand({ type: 'ping', payload: { at: Date.now() } }).ok, true);
  assert.equal(validateClientCommand({ type: 'ping', payload: {} }).ok, false);
  assert.equal(validateClientCommand({ type: 'unknown', payload: {} }).ok, false);
});

test('buildServerEnvelope preserves optional id', () => {
  const frame = buildServerEnvelope('ready', { userId: 'u1' }, 'req-1');
  assert.equal(frame.type, 'ready');
  assert.equal(frame.id, 'req-1');
  assert.equal(frame.payload.userId, 'u1');
});
