// The profile button opens a status list driven from the keyboard; a chosen
// status is saved on the server and shown as the server answered it.

import { screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import Sidebar from '@/features/home/components/lobby/Sidebar.vue';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';
import { stubFetch } from '../fixtures/fetch.ts';
import { authUser, notificationPreferences } from '../fixtures/users.ts';
import { settle, stubOverlayDom } from '../helpers/overlay-dom';
import { renderWithApp } from '../helpers/render.ts';
import { lobbyHost } from './harness/lobby-host';

stubOverlayDom();

const user = authUser({ id: 'ada', login: 'ada', displayName: 'Ада' });

async function renderSidebar() {
  const onToast = vi.fn();
  const { pinia } = await renderWithApp(
    lobbyHost(Sidebar, { user, onGoHome: vi.fn(), onOpenPeople: vi.fn(), onOpenSettings: vi.fn(), onToast })
  );
  const preferences = useNotificationPreferencesStore(pinia);
  preferences.prepareNotificationPreferences(user.id, false, 'online');
  return { onToast, preferences: preferences.notificationPreferences };
}

const focusedLabel = () => document.activeElement?.querySelector('.sidebar__status-label')?.textContent;

test('the status list opens on the current status and moves with arrows, Home, End and typing', async () => {
  stubFetch({});
  await renderSidebar();

  await userEvent.click(screen.getByRole('button', { name: /Ада/ }));
  expect(await screen.findByRole('listbox', { name: 'Статус пользователя' })).toBeTruthy();
  await vi.waitFor(() => expect(focusedLabel()).toBe('В сети'));
  expect(screen.getByText('Уведомления и звуковые сигналы будут отключены')).toBeTruthy();

  await userEvent.keyboard('{ArrowDown}');
  expect(focusedLabel()).toBe('Отошёл');
  await userEvent.keyboard('{End}');
  expect(focusedLabel()).toBe('Не в сети');
  await userEvent.keyboard('{Home}');
  expect(focusedLabel()).toBe('В сети');
  await userEvent.keyboard('н');
  expect(focusedLabel()).toBe('Не беспокоить');
});

test('choosing do-not-disturb saves it and shows what the server stored', async () => {
  const { calls } = stubFetch({
    'POST /api/presence/status': {
      body: {
        ok: true,
        preferences: notificationPreferences({ presenceStatus: 'dnd', doNotDisturb: true })
      }
    }
  });
  const { preferences } = await renderSidebar();

  await userEvent.click(screen.getByRole('button', { name: /Ада/ }));
  await userEvent.click(await screen.findByRole('option', { name: /Не беспокоить/ }));

  await vi.waitFor(() => expect(preferences.presenceStatus).toBe('dnd'));
  expect(calls[0]).toMatchObject({ url: '/api/presence/status', body: { status: 'dnd', automatic: false } });
  await vi.waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
});

test('a refused change keeps the old status and says so', async () => {
  stubFetch({ 'POST /api/presence/status': { status: 500, body: { ok: false, error: 'boom', code: 'internal' } } });
  const { onToast, preferences } = await renderSidebar();

  await userEvent.click(screen.getByRole('button', { name: /Ада/ }));
  await userEvent.click(await screen.findByRole('option', { name: /Отошёл/ }));

  await vi.waitFor(() => expect(onToast).toHaveBeenCalledWith('Не удалось изменить статус'));
  expect(preferences.presenceStatus).toBe('online');
});

test('the status list is drawn outside the sidebar so its edge cannot clip it', async () => {
  stubFetch({});
  await renderSidebar();

  await userEvent.click(screen.getByRole('button', { name: /Ада/ }));
  const panel = await screen.findByRole('listbox', { name: 'Статус пользователя' });
  await settle();
  expect(panel.closest('.sidebar')).toBeNull();
  expect(document.body.contains(panel)).toBe(true);
});
