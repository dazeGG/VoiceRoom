'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRoomRealtimeSummaryFromLobbyRoom } = require('../src/realtime/summary');

test('buildRoomRealtimeSummaryFromLobbyRoom mirrors shared summary rules', () => {
  const peers = Array.from({ length: 6 }, (_, index) => ({
    id: `peer-${index}`.padEnd(8, '0'),
    name: `User ${index}`,
    muted: index % 2 === 0,
    avatarColorKey: 'blue'
  }));

  const summary = buildRoomRealtimeSummaryFromLobbyRoom(
    {
      id: 'room1',
      name: 'Test room',
      emoji: '🎧',
      roomColorKey: 'blue',
      roomIconKey: 'headphones',
      roomPresetKey: 'voice-blue',
      isStatic: true,
      relationship: 'owner'
    },
    peers,
    () => 'blurple'
  );

  assert.equal(summary.peers, 6);
  assert.equal(summary.visiblePeers.length, 5);
  assert.equal(summary.hiddenPeerCount, 1);
});