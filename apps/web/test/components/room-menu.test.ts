import { screen, waitFor } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import RoomMenuContent from '@/shared/components/room-menu/RoomMenuContent.vue';
import { stubFetch } from '../fixtures/fetch.ts';
import { renderWithApp } from '../helpers/render.ts';

async function renderMenu(props: Record<string, unknown> = {}) {
  const handlers = { onClose: vi.fn(), onToast: vi.fn(), onOpenSettings: vi.fn(), onRoomsChanged: vi.fn() };
  await renderWithApp(RoomMenuContent, {
    props: { roomId: 'abc123', name: 'Планёрка', showNotificationControls: false, ...handlers, ...props }
  });
  return handlers;
}

test('the owner gets room settings and cannot remove the room from the list', async () => {
  const menu = await renderMenu({ relationship: 'owner' });
  expect(screen.queryByRole('menuitem', { name: 'Удалить из списка' })).toBeNull();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Настройки комнаты' }));
  expect(menu.onOpenSettings).toHaveBeenCalledTimes(1);
  expect(menu.onClose).toHaveBeenCalledWith(false);
});

test('a saved room can be removed from the list, and the list refreshes', async () => {
  const { calls } = stubFetch({ 'DELETE /api/auth/rooms/abc123': { body: { ok: true, removed: true } } });
  const menu = await renderMenu({ relationship: 'bookmarked' });
  expect(screen.queryByRole('menuitem', { name: 'Настройки комнаты' })).toBeNull();

  await userEvent.click(screen.getByRole('menuitem', { name: 'Удалить из списка' }));

  await waitFor(() => expect(menu.onRoomsChanged).toHaveBeenCalledTimes(1));
  expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['DELETE /api/auth/rooms/abc123']);
  expect(menu.onToast).toHaveBeenCalledWith('Комната «Планёрка» удалена из списка');
});

test('copying the code or link reports success, and a missing clipboard is reported instead of thrown', async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const menu = await renderMenu();

  await userEvent.click(screen.getByRole('menuitem', { name: 'Скопировать код' }));
  await waitFor(() => expect(menu.onToast).toHaveBeenCalledWith('Код скопирован'));
  expect(writeText).toHaveBeenCalledWith('abc123');

  await userEvent.click(screen.getByRole('menuitem', { name: 'Скопировать ссылку' }));
  await waitFor(() => expect(menu.onToast).toHaveBeenCalledWith('Ссылка скопирована'));
  expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/r/abc123`);

  vi.stubGlobal('navigator', { clipboard: undefined });
  await userEvent.click(screen.getByRole('menuitem', { name: 'Скопировать код' }));
  await waitFor(() => expect(menu.onToast).toHaveBeenCalledWith('Не удалось скопировать'));
});

test('a copy that finishes after the menu moved to another room says nothing', async () => {
  let finish: () => void = () => {};
  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    }
  });
  const menu = await renderMenu({ canClose: () => false });
  await userEvent.click(screen.getByRole('menuitem', { name: 'Скопировать код' }));
  finish();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(menu.onToast).not.toHaveBeenCalled();
  expect(menu.onClose).not.toHaveBeenCalled();
});
