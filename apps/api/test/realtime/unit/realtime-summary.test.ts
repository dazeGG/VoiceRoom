import test from 'node:test';
import type { StoredRoom } from '../../../src/domains/rooms/room-views.ts';
import { dbRoom, fake, lobbyRoom } from '../../fakes/index.ts';
import assert from 'node:assert/strict';
import { buildRoomRealtimeSummary } from '@voiceroom/shared/realtime';
import { buildServerEnvelope } from '../../../src/realtime/envelope.ts';
import type { WsConnection } from '../../../src/realtime/registry.ts';
import { createFullTestRuntime, runtimeDeps } from '../../fakes/room-runtime.ts';

test('buildRoomRealtimeSummary mirrors shared summary rules', () => {
  const peers = Array.from({ length: 6 }, (_, index) => ({
    id: `peer-${index}`.padEnd(8, '0'),
    name: `User ${index}`,
    muted: index % 2 === 0,
    avatarColorKey: 'blue'
  }));

  const summary = buildRoomRealtimeSummary(
    {
      roomId: 'room1',
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

test('legacy widget chat skips snapshot reads and queued room detail deliveries', async () => {
  const roomId = 'widget01';
  const widget = fake<WsConnection>({
    roomSurface: 'widget',
    previewRoomIds: new Set(),
    activeVoice: { roomId, peerId: 'peer1', sessionToken: 'token', transportId: 'transport1' }
  });
  const delivered: string[] = [];
  let reads = 0;
  const runtime = createFullTestRuntime(
    runtimeDeps({
      store: {
        getRoom: async () => dbRoom(roomId, { kind: 'widget', widgetChatEnabled: true }),
        async listMessages() {
          reads++;
          return [];
        }
      },
      wsRegistry: {
        roomDetailSubscribers: () => new Set([widget]),
        sendToConnection(_connection, envelope) {
          delivered.push(envelope.type);
          return true;
        }
      }
    })
  );
  const snapshot = await runtime.buildRoomSnapshot(roomId, 'active');
  assert.deepEqual(snapshot?.recentMessages, []);
  assert.equal(reads, 0);
  runtime.broadcastRoomDetail(roomId, buildServerEnvelope('room.chat.deleted', { roomId, messageId: 'old' }));
  runtime.broadcastRoomDetail(roomId, buildServerEnvelope('room.not_found', { roomId }));
  assert.deepEqual(delivered, ['room.not_found']);
});

test('chat messages schedule personalized unread summaries for room recipients', async () => {
  const sent: Array<{ userId: string; unreadCount: unknown }> = [];
  const runtime = createFullTestRuntime(
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
