// The room avatar in room settings: its button says whether it uploads or
// changes, removal is offered only for an avatar, and nothing reaches the
// server until the settings are saved.

import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import LobbyRoomSettingsDialog from '../../src/lib/features/home/components/lobby/LobbyRoomSettingsDialog.svelte';
import type { OwnedRoom } from '../../src/lib/api/auth';
import { stubFetch } from '../fixtures/fetch.ts';

afterEach(cleanup);

function room(avatarUrl: string | null): OwnedRoom {
  return {
    roomId: 'kitchen',
    name: 'Кухня',
    createdAt: 1,
    avatarUrl,
    isStatic: true,
    relationship: 'owner',
    peers: 0
  };
}

function renderSettings(avatarUrl: string | null) {
  const saved = room(avatarUrl);
  const { calls } = stubFetch({
    'PUT /api/rooms/kitchen': { body: { ok: true, room: { ...saved, avatarUrl: null } } },
    'DELETE /api/rooms/kitchen/avatar': { body: { ok: true, room: { ...saved, avatarUrl: null } } }
  });
  const onSaved = vi.fn();
  render(LobbyRoomSettingsDialog, {
    props: { room: saved, onClose: vi.fn(), onSaved, onDeleted: vi.fn(), onToast: vi.fn() }
  });
  return { calls, onSaved };
}

test('a room without an avatar offers an upload and no removal', () => {
  renderSettings(null);
  expect(screen.getByRole('button', { name: 'Загрузить аватар комнаты' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Удалить аватар комнаты' })).toBeNull();
});

test('removing the avatar shows the initials at once and deletes it only on save', async () => {
  const { calls, onSaved } = renderSettings('/api/rooms/kitchen/avatar/a.webp');
  expect(screen.getByRole('button', { name: 'Изменить аватар комнаты' })).toBeTruthy();

  await userEvent.click(screen.getByRole('button', { name: 'Удалить аватар комнаты' }));
  expect(screen.getByRole('button', { name: 'Загрузить аватар комнаты' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Удалить аватар комнаты' })).toBeNull();
  expect(calls).toEqual([]);

  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
    'PUT /api/rooms/kitchen',
    'DELETE /api/rooms/kitchen/avatar'
  ]);
});

test('a file that is not an image never reaches the crop dialog', async () => {
  renderSettings(null);
  const input = document.querySelector<HTMLInputElement>('.room-avatar-input')!;
  await userEvent.upload(input, new File(['x'], 'notes.txt', { type: 'text/plain' }), { applyAccept: false });
  expect((await screen.findByRole('alert')).textContent).toBe('Выберите изображение JPEG, PNG или WebP');
  expect(screen.queryByRole('dialog', { name: 'Аватар комнаты' })).toBeNull();
});
