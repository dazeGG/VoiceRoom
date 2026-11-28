// Adding a friend is keyboard-first: type the login (with or without @) and
// press Enter. Incoming requests are answered from their cards.

import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { createPinia, setActivePinia } from 'pinia';
import { expect, test, vi } from 'vitest';
import PeopleView from '@/features/home/components/lobby/PeopleView.vue';
import { LOBBY_KEY } from '@/features/home/model/lobby-context';
import { useLobbyStore } from '@/features/home/model/lobby.store';
import { stubFetch } from '../fixtures/fetch.ts';
import { authUser } from '../fixtures/users.ts';
import { stubOverlayDom } from '../helpers/overlay-dom';

stubOverlayDom();

const bob = authUser({ id: 'bob', login: 'bob', displayName: 'Боб' });

function renderPeople() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const lobby = useLobbyStore(pinia);
  const onToast = vi.fn();
  render(PeopleView, {
    props: { user: authUser({ login: 'ada' }), onToast },
    global: { plugins: [pinia], provide: { [LOBBY_KEY]: lobby } }
  });
  return { lobby, onToast };
}

test('Enter sends a request for the typed login and dismisses the add friend dialog', async () => {
  const { calls } = stubFetch({
    'POST /api/friends/requests': { body: { ok: true, status: 'sent', user: bob } },
    'GET /api/friends': { body: { ok: true, incomingRequestCount: 0, friends: [] } },
    'GET /api/friends/requests': { body: { ok: true, incoming: [], outgoing: [] } }
  });
  const { onToast } = renderPeople();

  await userEvent.click(screen.getByRole('button', { name: 'Добавить друга' }));
  const field = screen.getByRole('textbox', { name: 'Логин друга' });
  expect(screen.getByRole('button', { name: 'Отправить заявку' })).toHaveProperty('disabled', true);
  await userEvent.type(field, '@bob{Enter}');

  await vi.waitFor(() => expect(onToast).toHaveBeenCalledWith('Заявка отправлена'));
  expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ login: 'bob' });
  expect(screen.queryByRole('dialog', { name: 'Добавить друга' })).toBeNull();
});

test('a refused request keeps the login and shows the reason', async () => {
  stubFetch({
    'POST /api/friends/requests': { status: 404, body: { ok: false, error: 'User not found', code: 'user_not_found' } }
  });
  const { onToast } = renderPeople();

  await userEvent.click(screen.getByRole('button', { name: 'Добавить друга' }));
  const field = screen.getByRole('textbox', { name: 'Логин друга' });
  await userEvent.type(field, 'nobody{Enter}');
  await vi.waitFor(() => expect(onToast).toHaveBeenCalledOnce());
  expect(field).toHaveProperty('value', 'nobody');
});

test('an incoming request is accepted from its card', async () => {
  const { calls } = stubFetch({
    'POST /api/friends/requests/req-1/accept': { body: { ok: true, status: 'accepted', user: bob } },
    'GET /api/friends': { body: { ok: true, incomingRequestCount: 0, friends: [] } },
    'GET /api/friends/requests': { body: { ok: true, incoming: [], outgoing: [] } }
  });
  const { lobby, onToast } = renderPeople();
  lobby.requests = { incoming: [{ id: 'req-1', createdAt: 1, mutualFriends: 2, user: bob }], outgoing: [] };

  await userEvent.click(screen.getByRole('tab', { name: 'Заявки' }));
  expect(await screen.findByText(/2 общих друга/)).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Принять' }));
  await vi.waitFor(() => expect(onToast).toHaveBeenCalledWith('Заявка принята'));
  expect(calls.some((call) => call.url === '/api/friends/requests/req-1/accept')).toBe(true);
});

test('friends filter by tab and search, and the requests tab can decline an invitation', async () => {
  const { calls } = stubFetch({
    'POST /api/friends/requests/req-2/decline': { body: { ok: true, status: 'declined' } },
    'GET /api/friends/requests': { body: { ok: true, incoming: [], outgoing: [] } }
  });
  const { lobby } = renderPeople();
  const ada = authUser({ id: 'friend', login: 'friend', displayName: 'Ада' });
  lobby.friends = [
    { user: bob, online: true, unreadCount: 0, lastMessage: null, friendsSince: 1 },
    { user: ada, online: false, unreadCount: 0, lastMessage: null, friendsSince: 1 }
  ];
  lobby.requests = { incoming: [{ id: 'req-2', createdAt: 1, mutualFriends: 0, user: bob }], outgoing: [] };
  lobby.incomingRequestCount = 1;

  expect(await screen.findAllByRole('listitem')).toHaveLength(2);
  await userEvent.click(screen.getByRole('tab', { name: 'В сети' }));
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  await userEvent.click(screen.getByRole('tab', { name: 'Все' }));
  await userEvent.type(screen.getByRole('searchbox', { name: 'Поиск по друзьям' }), 'ада');
  expect(screen.getByRole('listitem').textContent).toContain('@friend');
  await userEvent.click(screen.getByRole('tab', { name: 'Заявки' }));
  expect(screen.queryByRole('searchbox')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Отклонить' }));
  expect(await screen.findByText('Новых заявок нет.')).toBeTruthy();
  expect(calls.some((call) => call.url === '/api/friends/requests/req-2/decline')).toBe(true);
});

test('requests show one empty state and only populated groups', async () => {
  const { lobby } = renderPeople();
  await userEvent.click(screen.getByRole('tab', { name: 'Заявки' }));
  expect(screen.getByText('Новых заявок нет.')).toBeTruthy();
  expect(screen.queryByText('Вы пока никому не отправляли заявки.')).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Исходящие' })).toBeNull();
  lobby.requests = { incoming: [], outgoing: [{ id: 'out-1', createdAt: 1, user: bob }] };
  expect(await screen.findByRole('heading', { name: 'Исходящие' })).toBeTruthy();
  expect(screen.queryByText('Новых заявок нет.')).toBeNull();
  expect(screen.getByRole('button', { name: 'Отменить' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'На главную' })).toBeNull();
});
