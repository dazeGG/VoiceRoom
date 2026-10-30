import { fireEvent, screen, waitFor } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import VoiceHome from '@/features/home/components/lobby/VoiceHome.vue';
import { useLobbyStore } from '@/features/home/model/lobby.store';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';
import { incomingRequest, publicUser } from '../fixtures/answers.ts';
import { defined } from '../helpers/assert.ts';
import { settle, stubOverlayDom } from '../helpers/overlay-dom';
import { renderWithApp } from '../helpers/render.ts';
import { lobbyHost } from './harness/lobby-host';

stubOverlayDom();

function room(roomId: string, name: string, peers = 0) {
  return {
    roomId,
    name,
    peers,
    avatarUrl: null,
    createdAt: 1,
    emptySince: null,
    isStatic: true,
    relationship: 'owner' as const
  };
}

async function renderHome(rooms: ReturnType<typeof room>[] = []) {
  const props = {
    rooms,
    onOpenRoom: vi.fn(),
    onCreateRoom: vi.fn(),
    onJoinCode: vi.fn()
  };
  const view = await renderWithApp(lobbyHost(VoiceHome, props));
  return { ...props, ...view };
}

test('joining by code is one field that takes a code or a link and explains auto-save', async () => {
  const props = await renderHome();
  const field = screen.getByRole('searchbox', { name: 'Код или ссылка на комнату' });
  const hint = document.getElementById(field.getAttribute('aria-describedby') ?? '');
  expect(hint?.textContent).toMatch(/Постоянные комнаты сохраняются автоматически/);

  await userEvent.type(field, 'abc123{Enter}');
  expect(props.onJoinCode).toHaveBeenCalledWith('abc123');
  expect(field).toHaveProperty('value', '');
});

test('an empty or blank code is not submitted', async () => {
  const props = await renderHome();
  const field = screen.getByPlaceholderText('Код или ссылка');
  await userEvent.type(field, '   {Enter}');
  expect(props.onJoinCode).not.toHaveBeenCalled();
});

test('rooms are listed busiest first and open on click', async () => {
  const props = await renderHome([room('quiet', 'Тихая', 0), room('busy', 'Шумная', 3)]);
  const cards = screen.getAllByRole('button', { name: /Тихая|Шумная/ });
  expect(cards.map((card) => card.textContent)).toEqual([
    expect.stringContaining('Шумная'),
    expect.stringContaining('Тихая')
  ]);
  await userEvent.click(defined(cards[1], 'cards[1]'));
  expect(props.onOpenRoom).toHaveBeenCalledWith('quiet');
});

test('a room card opens its menu on right click and from the keyboard, and Escape returns focus', async () => {
  await renderHome([room('abc123', 'Планёрка')]);
  const card = screen.getByRole('button', { name: /Планёрка/ });

  await fireEvent.contextMenu(card, { clientX: 40, clientY: 40 });
  expect(await screen.findByRole('menu', { name: 'Меню комнаты Планёрка' })).toBeTruthy();
  await settle();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(card));

  card.focus();
  await userEvent.keyboard('{Shift>}{F10}{/Shift}');
  expect(await screen.findByRole('menu', { name: 'Меню комнаты Планёрка' })).toBeTruthy();
});

test('a room with muted notifications shows a bell-off mark next to its name', async () => {
  const { pinia } = await renderHome([room('abc123', 'Планёрка'), room('other', 'Другая')]);
  useNotificationPreferencesStore(pinia).notificationPreferences.mutedRoomIds = ['abc123'];
  const muted = await screen.findAllByRole('img', { name: 'Уведомления отключены' });
  expect(muted).toHaveLength(1);
  expect(screen.getByRole('button', { name: /Планёрка/ }).contains(defined(muted[0], 'muted[0]'))).toBe(true);
});

test('the code field is not a login: browsers and password managers are told to stay out', async () => {
  await renderHome();
  // A search field: iCloud Passwords ignores autocomplete="off" but leaves these alone.
  const field = screen.getByRole('searchbox', { name: 'Код или ссылка на комнату' });
  expect(field.getAttribute('autocomplete')).toBe('off');
  // The attributes 1Password, LastPass and Bitwarden read to skip a field.
  expect(field.hasAttribute('data-1p-ignore')).toBe(true);
  expect(field.getAttribute('data-lpignore')).toBe('true');
  expect(field.hasAttribute('data-bwignore')).toBe(true);
});

test('rooms with people are listed under «Сейчас в эфире», the rest under «Остальные»', async () => {
  await renderHome([room('quiet', 'Тихая', 0), room('busy', 'Шумная', 3)]);
  const live = screen.getByRole('region', { name: 'Сейчас в эфире' });
  const rest = screen.getByRole('region', { name: 'Остальные' });
  expect(live.textContent).toContain('Шумная');
  expect(live.textContent).not.toContain('Тихая');
  expect(rest.textContent).toContain('Тихая');
  expect(rest.textContent).toContain('тихо');
});

test('without rooms there is a prompt to create the first one and no room sections', async () => {
  await renderHome();
  expect(screen.getByText('У вас пока нет комнат — создайте первую кнопкой выше.')).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Сейчас в эфире' })).toBeNull();
});

test('a hidden request banner comes back for a new request even when the count did not grow', async () => {
  const { pinia } = await renderHome();
  const lobby = useLobbyStore(pinia);
  const request = (id: string, login: string) => incomingRequest({ id, user: publicUser({ id: `user-${id}`, login }) });
  lobby.requests = { incoming: [request('r1', 'bob'), request('r2', 'eve')], outgoing: [] };
  lobby.incomingRequestCount = 2;
  expect(await screen.findByText(/2\s+новые заявки в друзья/)).toBeTruthy();

  await userEvent.click(screen.getByRole('button', { name: 'Скрыть' }));
  expect(screen.queryByText(/новые заявки в друзья/)).toBeNull();

  // One request was answered elsewhere and another one arrived: still two.
  lobby.requests = { incoming: [request('r2', 'eve'), request('r3', 'kim')], outgoing: [] };
  lobby.incomingRequestCount = 2;
  expect(await screen.findByText(/2\s+новые заявки в друзья/)).toBeTruthy();
});

test('the request banner shows from the friends count when the request list did not load, and hides until it changes', async () => {
  const { pinia } = await renderHome();
  const lobby = useLobbyStore(pinia);
  lobby.requests = { incoming: [], outgoing: [] };
  lobby.incomingRequestCount = 2;
  expect(await screen.findByText(/2\s+новые заявки в друзья/)).toBeTruthy();

  await userEvent.click(screen.getByRole('button', { name: 'Скрыть' }));
  expect(screen.queryByText(/новые заявки в друзья/)).toBeNull();

  lobby.incomingRequestCount = 3;
  expect(await screen.findByText(/3\s+новые заявки в друзья/)).toBeTruthy();
});
