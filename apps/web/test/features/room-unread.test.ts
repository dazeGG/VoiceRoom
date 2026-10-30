// Unread counts on lobby room cards.

import { effectScope, nextTick, watchEffect } from 'vue';
import { expect, test } from 'vitest';
import { freshImport } from '../helpers/fresh-module.ts';
import type { RoomRealtimeSummary } from '../../src/api/realtime.ts';

const loadFresh = async () => {
  const module = await freshImport(() => import('../../src/entities/room/room-presence.store.ts'));
  return module.useRoomPresenceStore();
};

function summary(roomId: string, unreadCount: number): RoomRealtimeSummary {
  return {
    roomId,
    name: roomId,
    isStatic: true,
    relationship: 'owner',
    peers: 0,
    visiblePeers: [],
    hiddenPeerCount: 0,
    unreadCount
  };
}

test('a room summary sets the unread badge', async () => {
  const rooms = await loadFresh();
  rooms.applyRoomSummary(summary('room-a', 3));
  expect(rooms.unreadCountByRoomId['room-a']).toBe(3);
});

test('while a room chat is open its badge stays at zero, even for summaries that arrive late', async () => {
  const rooms = await loadFresh();
  rooms.applyRoomSummary(summary('room-a', 3));
  const endReading = rooms.beginRoomChatReadSession('room-a');
  expect(rooms.unreadCountByRoomId['room-a']).toBe(0);

  rooms.applyRoomSummary(summary('room-a', 5));
  expect(rooms.unreadCountByRoomId['room-a']).toBe(0);

  endReading();
  rooms.applyRoomSummary(summary('room-a', 1));
  expect(rooms.unreadCountByRoomId['room-a']).toBe(1);
});

test('two readers of the same room keep it read until both leave', async () => {
  const rooms = await loadFresh();
  const first = rooms.beginRoomChatReadSession('room-a');
  const second = rooms.beginRoomChatReadSession('room-a');
  first();
  first();
  rooms.applyRoomSummary(summary('room-a', 2));
  expect(rooms.unreadCountByRoomId['room-a']).toBe(0);
  second();
  rooms.applyRoomSummary(summary('room-a', 2));
  expect(rooms.unreadCountByRoomId['room-a']).toBe(2);
});

test('clearing a badge from inside an effect does not make that effect re-run on every badge change', async () => {
  // Same module instance (and reactivity runtime) as this test's effect, so
  // dependency tracking between them is real.
  const presence = await loadFresh();
  let runs = 0;
  const scope = effectScope();
  scope.run(() => {
    watchEffect(() => {
      runs += 1;
      presence.setRoomUnreadCount('room-a', 0);
    });
  });
  await nextTick();
  presence.setRoomUnreadCount('room-b', 4);
  await nextTick();
  expect(runs).toBe(1);
  scope.stop();
});
