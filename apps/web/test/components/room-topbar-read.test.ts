// Opening the chat from the room's top bar marks the room read for an account,
// but only a permanent room: read state is kept for rooms in the account's
// list, and a temporary room is never there.

import { screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { nextTick } from 'vue';
import RoomTopbar from '@/features/room/components/RoomTopbar.vue';
import { state as roomClientState } from '@/features/room/client/core/room-runtime.store';
import { useRoomUiStore } from '@/features/room/room-ui.store';
import { usePageStore } from '@/stores/page.store';
import { stubFetch } from '../fixtures/fetch.ts';
import { participant } from '../fixtures/participant.ts';
import { renderWithApp } from '../helpers/render.ts';

afterEach(() => {
  roomClientState.roomId = '';
  roomClientState.roomIsStatic = false;
  roomClientState.self = null;
});

async function openChatIn(room: { isStatic: boolean }) {
  const { calls } = stubFetch({
    'POST /api/rooms/abc123/read': { body: { ok: true, roomId: 'abc123', lastReadAt: 1 } }
  });
  roomClientState.roomId = 'abc123';
  roomClientState.roomIsStatic = room.isStatic;
  roomClientState.self = participant({ id: 'p1', name: 'Аня', accountUserId: 'u1' });
  const { pinia } = await renderWithApp(RoomTopbar);
  usePageStore(pinia).screen = 'room';
  await nextTick();
  await userEvent.click(screen.getByRole('button', { name: 'Чат' }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  useRoomUiStore(pinia).closeChat();
  return calls.filter((call) => call.url.endsWith('/read'));
}

test('opening the chat of a permanent room marks it read', async () => {
  expect(await openChatIn({ isStatic: true })).toHaveLength(1);
});

test('opening the chat of a temporary room asks for nothing', async () => {
  expect(await openChatIn({ isStatic: false })).toEqual([]);
});
