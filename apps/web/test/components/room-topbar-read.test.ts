// Opening the chat from the room's top bar marks the room read for an account,
// but only a permanent room: read state is kept for rooms in the account's
// list, and a temporary room is never there.

import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import RoomTopbar from '../../src/lib/features/room/components/RoomTopbar.svelte';
import { state as roomClientState } from '../../src/lib/features/room/client/core/state.svelte';
import { closeChat } from '../../src/lib/features/room/room-ui.svelte';
import { stubFetch } from '../fixtures/fetch.ts';

afterEach(() => {
  cleanup();
  closeChat();
  roomClientState.roomId = '';
  roomClientState.screen = 'start';
  roomClientState.roomIsStatic = false;
  roomClientState.self = null;
});

async function openChatIn(room: { isStatic: boolean }) {
  const { calls } = stubFetch({
    'POST /api/rooms/abc123/read': { body: { ok: true, roomId: 'abc123', lastReadAt: 1 } }
  });
  roomClientState.roomId = 'abc123';
  roomClientState.screen = 'room';
  roomClientState.roomIsStatic = room.isStatic;
  roomClientState.self = { id: 'p1', name: 'Аня', accountUserId: 'u1' } as typeof roomClientState.self;
  render(RoomTopbar);
  await userEvent.click(screen.getByRole('button', { name: 'Чат' }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return calls.filter((call) => call.url.endsWith('/read'));
}

test('opening the chat of a permanent room marks it read', async () => {
  expect(await openChatIn({ isStatic: true })).toHaveLength(1);
});

test('opening the chat of a temporary room asks for nothing', async () => {
  expect(await openChatIn({ isStatic: false })).toEqual([]);
});
