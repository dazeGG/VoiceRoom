'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRoomRealtimeSummaryFromLobbyRoom } = require('../src/realtime/summary');
const { createRoomRealtimeRuntime } = require('../src/realtime/room-runtime');

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
      isStatic: true,
      relationship: 'owner'
    },
    peers,
    () => 'blurple'
  );

  assert.equal(summary.peers, 6);
  assert.equal(summary.visiblePeers.length, 5);
  assert.equal(summary.hiddenPeerCount, 1);
  assert.equal(summary.name, 'Test room');
  assert.equal('emoji' in summary, false);
});

test('chat messages schedule personalized unread summaries for room recipients', async () => {
  const sent = [];
  const room = { id: 'room1', isStatic: true, name: 'Test room', relationship: 'owner' };
  const store = {
    async getRoom() { return room; },
    async getRoomUnreadCount(_roomId, userId) { return userId === 'owner' ? 2 : 5; },
    async listSummaryRecipientUserIds() { return ['owner', 'bookmark']; }
  };
  const wsRegistry = {
    roomDetailSubscribers() { return []; },
    sendToUser(userId, envelope) { sent.push({ userId, envelope }); }
  };
  const runtime = createRoomRealtimeRuntime({
    presenceRooms: new Map(),
    wsRegistry,
    getRoomStore: () => store,
    publicPeer: (peer) => peer,
    publicLobbyRoom: (value) => ({
      isStatic: value.isStatic,
      name: value.name,
      relationship: value.relationship,
      roomId: value.id,
      unreadCount: value.unreadCount
    }),
    publicChatMessage: (message) => message,
    broadcast() {},
    avatarColorForPeerId: () => 'blurple'
  });

  runtime.broadcastChatMessage('room1', { id: 'message1', text: 'hello' });
  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.deepEqual(
    sent.map(({ userId, envelope }) => [userId, envelope.payload.room.unreadCount]),
    [['owner', 2], ['bookmark', 5]]
  );
});
