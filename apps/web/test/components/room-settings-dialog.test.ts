// Saving a room's settings renames the room and tells the page hosting it, so
// the lobby's room list shows the new name.

import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import RoomSettingsDialog from '../../src/lib/features/room/components/RoomSettingsDialog.svelte';
import { state as roomClientState } from '../../src/lib/features/room/client/core/state.svelte';
import { closeRoomSettings, openRoomSettings } from '../../src/lib/features/room/room-settings.svelte';
import { roomShellContext } from '../../src/lib/features/room/shell';
import { stubFetch } from '../fixtures/fetch.ts';

afterEach(() => {
  cleanup();
  closeRoomSettings();
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
  openRoomSettings();
  const shell = { roomLeft: vi.fn<(roomId: string) => void>(), roomsChanged: vi.fn<(roomId: string) => void>() };
  render(RoomSettingsDialog, { context: roomShellContext(shell) });

  const name = screen.getByPlaceholderText('Название комнаты');
  await userEvent.clear(name);
  await userEvent.type(name, 'Кухня');
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

  await vi.waitFor(() => expect(shell.roomsChanged).toHaveBeenCalledWith('abc123'));
  expect(calls).toContainEqual({ method: 'PUT', url: '/api/rooms/abc123', body: { name: 'Кухня' } });
  expect(shell.roomLeft).not.toHaveBeenCalled();
});
