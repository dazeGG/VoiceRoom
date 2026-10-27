// The room client reads and writes `state` as a plain object; components read the same
// object from the store. Foreign objects must stay out of the reactive proxy.

import type { LocalTrackPublication, Room } from 'livekit-client';
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

test('publications kept in state come back unproxied, so unpublishTrack finds them', async () => {
  const { unpublishLocalScreenTracks } = await import('@/features/room/client/services/livekit/local-publications');
  const track = { id: 'screen-track' };
  const unpublished: unknown[] = [];
  state.livekitRoom = mistyped<Room>({
    localParticipant: {
      unpublishTrack: (candidate: unknown) => {
        unpublished.push(candidate);
        return Promise.resolve();
      }
    }
  });
  const publication = { track };
  state.localScreenPublications = new Map([['screen-track', mistyped<LocalTrackPublication>(publication)]]);
  expect(state.localScreenPublications.get('screen-track')).toBe(publication);

  await unpublishLocalScreenTracks();
  expect(unpublished).toHaveLength(1);
  expect(unpublished[0]).toBe(track);

  Object.assign(state, createInitialRoomState());
  state.localScreenPublications.set('x', mistyped<LocalTrackPublication>(publication));
  expect(state.localScreenPublications.get('x')).toBe(publication);
});
