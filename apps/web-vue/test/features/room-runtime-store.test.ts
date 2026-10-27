// The room client reads and writes `state` as a plain object; components read the same
// object from the store. Foreign objects must stay out of the reactive proxy.

import type { Room } from 'livekit-client';
import { createPinia, setActivePinia } from 'pinia';
import { watch } from 'vue';
import { beforeEach, expect, test } from 'vitest';
import { clientRoomName, state, useRoomRuntimeStore } from '@/features/room/client/core/room-runtime.store';
import { createInitialRoomState } from '@/features/room/client/model/room-state';
import { mistyped } from '../helpers/mistyped';

beforeEach(() => {
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState());
});

class FakeLiveKitRoom {
  name = 'room';
}

test('writes through state are what the store hands to components, and are seen reactively', () => {
  const seen: boolean[] = [];
  watch(
    () => useRoomRuntimeStore().state.muted,
    (muted) => seen.push(muted),
    { flush: 'sync' }
  );
  state.muted = true;
  expect(useRoomRuntimeStore().state.muted).toBe(true);
  expect(seen).toEqual([true]);
});

test('a class instance assigned to state keeps its identity', () => {
  const room = new FakeLiveKitRoom();
  state.livekitRoom = mistyped<Room>(room);
  expect(state.livekitRoom).toBe(room);
});

test('the peer id sets are reactive collections', () => {
  const seen: number[] = [];
  watch(
    () => state.serverPeerIds.size,
    (size) => seen.push(size),
    { flush: 'sync' }
  );
  state.serverPeerIds.add('a');
  state.serverPeerIds.add('a');
  state.serverPeerIds.add('b');
  expect(seen).toEqual([1, 2]);
});

test('Object.assign with a fresh initial state resets it', () => {
  state.muted = true;
  state.roomName = 'kitchen';
  Object.assign(state, createInitialRoomState());
  expect(state).toMatchObject({ muted: false, roomName: '' });
});

test('the room name is the client name only for the room it holds', () => {
  state.roomId = 'kitchen';
  state.roomName = 'Кухня';
  expect(clientRoomName('kitchen')).toBe('Кухня');
  expect(clientRoomName('other')).toBe('');
});
