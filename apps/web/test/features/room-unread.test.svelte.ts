// Unread counts on lobby room cards.

import { flushSync } from 'svelte';
import * as presence from '../../src/lib/features/home/model/room-presence.svelte.ts';
import { expect, test } from 'vitest';
import { freshImport } from '../helpers/fresh-module.ts';
import type { RoomRealtimeSummary } from '../../src/lib/api/realtime.ts';
import type * as RoomPresenceModule from '../../src/lib/features/home/model/room-presence.svelte.ts';

const loadFresh = () => freshImport<typeof RoomPresenceModule>('/src/lib/features/home/model/room-presence.svelte.ts');

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
  expect(rooms.roomPresence.unreadCountByRoomId['room-a']).toBe(3);
});

test('while a room chat is open its badge stays at zero, even for summaries that arrive late', async () => {
  const rooms = await loadFresh();
  rooms.applyRoomSummary(summary('room-a', 3));
  const endReading = rooms.beginRoomChatReadSession('room-a');
  expect(rooms.roomPresence.unreadCountByRoomId['room-a']).toBe(0);

  rooms.applyRoomSummary(summary('room-a', 5));
  expect(rooms.roomPresence.unreadCountByRoomId['room-a']).toBe(0);

  endReading();
  rooms.applyRoomSummary(summary('room-a', 1));
  expect(rooms.roomPresence.unreadCountByRoomId['room-a']).toBe(1);
});

test('two readers of the same room keep it read until both leave', async () => {
  const rooms = await loadFresh();
  const first = rooms.beginRoomChatReadSession('room-a');
  const second = rooms.beginRoomChatReadSession('room-a');
  first();
  first();
  rooms.applyRoomSummary(summary('room-a', 2));
  expect(rooms.roomPresence.unreadCountByRoomId['room-a']).toBe(0);
  second();
  rooms.applyRoomSummary(summary('room-a', 2));
  expect(rooms.roomPresence.unreadCountByRoomId['room-a']).toBe(2);
});

test('clearing a badge from inside an effect does not make that effect re-run on every badge change', () => {
  // Same module instance (and Svelte runtime) as this test's effect, so
  // dependency tracking between them is real.
  let runs = 0;
  const stop = $effect.root(() => {
    $effect(() => {
      runs += 1;
      presence.setRoomUnreadCount('room-a', 0);
    });
  });
  flushSync();
  presence.setRoomUnreadCount('room-b', 4);
  flushSync();
  expect(runs).toBe(1);
  stop();
});
