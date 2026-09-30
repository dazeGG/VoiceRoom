// The profile button opens a status list driven from the keyboard; a chosen
// status is saved on the server and shown as the server answered it.

import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import Sidebar from '../../src/lib/features/home/components/lobby/Sidebar.svelte';
import { LobbyStore } from '../../src/lib/features/home/model/lobby.svelte';
import { lobbyContext } from '../../src/lib/features/home/model/lobby-context';
import {
  notificationPreferences as preferences,
  prepareNotificationPreferences
} from '../../src/lib/shared/notifications/preferences.svelte';
import { stubFetch } from '../fixtures/fetch.ts';
import { authUser, notificationPreferences } from '../fixtures/users.ts';

const user = authUser({ id: 'ada', login: 'ada', displayName: 'Ада' });

beforeEach(() => prepareNotificationPreferences(user.id, false, 'online'));
afterEach(cleanup);

function renderSidebar() {
  const onToast = vi.fn();
  render(Sidebar, {
    props: { user, onGoHome: vi.fn(), onOpenPeople: vi.fn(), onOpenSettings: vi.fn(), onToast },
    context: lobbyContext(new LobbyStore())
  });
  return onToast;
}

const focusedLabel = () => document.activeElement?.querySelector('.lv-status-label')?.textContent;

test('the status list opens on the current status and moves with arrows, Home, End and typing', async () => {
  stubFetch({});
  renderSidebar();

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
  renderSidebar();

  await userEvent.click(screen.getByRole('button', { name: /Ада/ }));
  await userEvent.click(await screen.findByRole('option', { name: /Не беспокоить/ }));

  await vi.waitFor(() => expect(preferences.presenceStatus).toBe('dnd'));
  expect(calls[0]).toMatchObject({ url: '/api/presence/status', body: { status: 'dnd', automatic: false } });
  expect(screen.queryByRole('listbox')).toBeNull();
});

test('a refused change keeps the old status and says so', async () => {
  stubFetch({ 'POST /api/presence/status': { status: 500, body: { ok: false, error: 'boom', code: 'internal' } } });
  const onToast = renderSidebar();

  await userEvent.click(screen.getByRole('button', { name: /Ада/ }));
  await userEvent.click(await screen.findByRole('option', { name: /Отошёл/ }));

  await vi.waitFor(() => expect(onToast).toHaveBeenCalledWith('Не удалось изменить статус'));
  expect(preferences.presenceStatus).toBe('online');
});
