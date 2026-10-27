// The room client changes the local participant through the object
// createParticipant returns. Vue has to be told: a change made on the raw
// model instead of the reactive copy left the local tile showing a stale mute
// or speaking state until something else re-rendered it.

import { nextTick, watchEffect } from 'vue';
import { beforeEach, expect, test } from 'vitest';
import { state } from '@/features/room/client/core/room-runtime.store';
import { createInitialRoomState } from '@/features/room/client/model/room-state.ts';
import { createParticipant } from '@/features/room/client/room/participants.ts';

beforeEach(() => {
  Object.assign(state, createInitialRoomState());
  state.peerId = 'me';
});

test('a change to the returned local participant re-renders what reads state.self', async () => {
  const self = createParticipant({ id: 'me', name: 'Я' });
  const seen: boolean[] = [];
  const stop = watchEffect(() => {
    seen.push(Boolean(state.self?.muted));
  });
  await nextTick();
  self.muted = true;
  await nextTick();
  stop();
  expect(seen).toEqual([false, true]);
});
