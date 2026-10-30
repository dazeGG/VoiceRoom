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

const bob = authUser({ id: 'bob', login: 'bob', displayName: 'Боб' });

function renderPeople() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const lobby = useLobbyStore(pinia);
  const onToast = vi.fn();
  render(PeopleView, {
    props: { user: authUser({ login: 'ada' }), onToast, onHome: vi.fn() },
    global: { plugins: [pinia], provide: { [LOBBY_KEY]: lobby } }
  });
  return { lobby, onToast };
}

test('Enter sends a request for the typed login, @ or not, and empties the field', async () => {
  const { calls } = stubFetch({
    'POST /api/friends/requests': { body: { ok: true, status: 'sent', user: bob } },
    'GET /api/friends': { body: { ok: true, incomingRequestCount: 0, friends: [] } },
    'GET /api/friends/requests': { body: { ok: true, incoming: [], outgoing: [] } }
  });
  const { onToast } = renderPeople();

  const field = screen.getByRole('textbox', { name: 'Логин друга' });
  expect(screen.getByRole('button', { name: 'Отправить заявку' })).toHaveProperty('disabled', true);
  await userEvent.type(field, '@bob{Enter}');

  await vi.waitFor(() => expect(onToast).toHaveBeenCalledWith('Заявка отправлена'));
  expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ login: 'bob' });
  expect(field).toHaveProperty('value', '');
});

test('a refused request keeps the login and shows the reason', async () => {
  stubFetch({
    'POST /api/friends/requests': { status: 404, body: { ok: false, error: 'User not found', code: 'user_not_found' } }
  });
  const { onToast } = renderPeople();

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

  expect(await screen.findByText('2 общих друга')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Принять' }));
  await vi.waitFor(() => expect(onToast).toHaveBeenCalledWith('Заявка принята'));
  expect(calls.some((call) => call.url === '/api/friends/requests/req-1/accept')).toBe(true);
});
