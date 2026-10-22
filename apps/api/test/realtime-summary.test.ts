import test from 'node:test';
import type { StoredRoom } from '../src/domains/rooms/room-views.ts';
import { dbRoom, lobbyRoom } from './fakes/index.ts';
import assert from 'node:assert/strict';
import { buildRoomRealtimeSummary } from '@voice-room/shared/realtime';
import { createRoomRealtimeRuntime } from '../src/realtime/room-runtime.ts';
import { runtimeDeps } from './fakes/room-runtime.ts';

test('buildRoomRealtimeSummary mirrors shared summary rules', () => {
  const peers = Array.from({ length: 6 }, (_, index) => ({
    id: `peer-${index}`.padEnd(8, '0'),
    name: `User ${index}`,
    muted: index % 2 === 0,
    avatarColorKey: 'blue'
  }));

  const summary = buildRoomRealtimeSummary(
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
  const sent: Array<{ userId: string; unreadCount: unknown }> = [];
  const runtime = createRoomRealtimeRuntime(
    runtimeDeps({
      store: {
        getRoom: async () => dbRoom('room1', { createdAt: 0, name: 'Test room' }),
        async getRoomUnreadCount(_roomId, userId) {
          return userId === 'owner' ? 2 : 5;
        },
        async listSummaryRecipientUserIds() {
          return ['owner', 'bookmark'];
        }
      },
      wsRegistry: {
        sendToUser(userId, envelope) {
          sent.push({
            userId,
            unreadCount: envelope.type === 'room.summary' ? envelope.payload.room.unreadCount : undefined
          });
          return 1;
        }
      },
      publicLobbyRoom: (value: StoredRoom) =>
        lobbyRoom(value.id, {
          isStatic: value.isStatic,
          name: value.name,
          relationship: value.relationship || 'owner',
          ...(value.unreadCount === undefined ? {} : { unreadCount: value.unreadCount })
        }),
      avatarColorForPeerId: () => 'blurple'
    })
  );

  runtime.broadcastChatMessage('room1', {
    id: 'message1',
    roomId: 'room1',
    peerId: 'peer-1',
    name: 'Ada',
    text: 'hello',
    createdAt: 1
  });
  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.deepEqual(
    sent.map(({ userId, unreadCount }) => [userId, unreadCount]),

    [
      ['owner', 2],
      ['bookmark', 5]
    ]
  );
});
