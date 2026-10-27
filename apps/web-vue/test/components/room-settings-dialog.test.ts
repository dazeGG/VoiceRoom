// Saving a room's settings renames the room and tells the page hosting it, so
// the lobby's room list shows the new name.

import { screen, waitFor } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { defineComponent, h, provide } from 'vue';
import RoomSettingsDialog from '@/features/room/components/RoomSettingsDialog.vue';
import { state as roomClientState } from '@/features/room/client/core/room-runtime.store';
import { useRoomSettingsStore } from '@/features/room/room-settings.store';
import { ROOM_SHELL_KEY } from '@/features/room/shell';
import { stubFetch } from '../fixtures/fetch.ts';
import { renderWithApp } from '../helpers/render.ts';

afterEach(() => {
  roomClientState.roomId = '';
  roomClientState.roomName = '';
});

test('a saved rename tells the host that the room changed', async () => {
  const { calls } = stubFetch({
    'PUT /api/rooms/abc123': {
      body: {
        ok: true,
        room: {
          roomId: 'abc123',
          name: 'Кухня',
          avatarUrl: null,
          createdAt: 1,
          isStatic: true,
          peers: 0,
          relationship: 'owner'
        }
      }
    }
  });
  roomClientState.roomId = 'abc123';
  roomClientState.roomName = 'Планёрка';
  const shell = { roomLeft: vi.fn<(roomId: string) => void>(), roomsChanged: vi.fn<(roomId: string) => void>() };
  const Host = defineComponent(() => {
    provide(ROOM_SHELL_KEY, shell);
    return () => h(RoomSettingsDialog);
  });
  const { pinia } = await renderWithApp(Host);
  useRoomSettingsStore(pinia).openRoomSettings();

  const name = await screen.findByPlaceholderText('Название комнаты');
  await userEvent.clear(name);
  await userEvent.type(name, 'Кухня');
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

  await waitFor(() => expect(shell.roomsChanged).toHaveBeenCalledWith('abc123'));
  expect(calls).toContainEqual({ method: 'PUT', url: '/api/rooms/abc123', body: { name: 'Кухня' } });
  expect(shell.roomLeft).not.toHaveBeenCalled();
});
