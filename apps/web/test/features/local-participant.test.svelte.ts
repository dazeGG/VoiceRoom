// The room client changes the local participant through the object
// createParticipant returns. Svelte has to be told: a change made on the raw
// model instead of the reactive copy left the local tile showing a stale mute
// or speaking state until something else re-rendered it.

import { flushSync } from 'svelte';
import { beforeEach, expect, test } from 'vitest';
import { state } from '../../src/lib/features/room/client/core/state.svelte.ts';
import { createInitialRoomState } from '../../src/lib/features/room/client/model/room-state.ts';
import { createParticipant } from '../../src/lib/features/room/client/room/participants.ts';

beforeEach(() => {
  Object.assign(state, createInitialRoomState());
  state.peerId = 'me';
});

test('a change to the returned local participant re-renders what reads state.self', () => {
  const self = createParticipant({ id: 'me', name: 'Я' });
  const seen: boolean[] = [];
  const stop = $effect.root(() => {
    $effect(() => {
      seen.push(Boolean(state.self?.muted));
    });
  });
  flushSync();
  self.muted = true;
  flushSync();
  stop();
  expect(seen).toEqual([false, true]);
});
