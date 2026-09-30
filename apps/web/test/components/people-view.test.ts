// Adding a friend is keyboard-first: type the login (with or without @) and
// press Enter. Incoming requests are answered from their cards.

import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import PeopleView from '../../src/lib/features/home/components/lobby/PeopleView.svelte';
import { LobbyStore } from '../../src/lib/features/home/model/lobby.svelte';
import { lobbyContext } from '../../src/lib/features/home/model/lobby-context';
import { stubFetch } from '../fixtures/fetch.ts';
import { authUser } from '../fixtures/users.ts';

afterEach(cleanup);

const bob = authUser({ id: 'bob', login: 'bob', displayName: 'Боб' });

function renderPeople(lobby = new LobbyStore()) {
  const onToast = vi.fn();
  render(PeopleView, {
    props: { user: authUser({ login: 'ada' }), onToast, onHome: vi.fn() },
    context: lobbyContext(lobby)
  });
  return onToast;
}

test('Enter sends a request for the typed login, @ or not, and empties the field', async () => {
  const { calls } = stubFetch({
    'POST /api/friends/requests': { body: { ok: true, status: 'sent', user: bob } },
    'GET /api/friends': { body: { ok: true, incomingRequestCount: 0, friends: [] } },
    'GET /api/friends/requests': { body: { ok: true, incoming: [], outgoing: [] } }
  });
  const onToast = renderPeople();

  const field = screen.getByRole('textbox', { name: 'Логин друга' });
  expect(screen.getByRole('button', { name: 'Отправить заявку' })).toHaveProperty('disabled', true);
  await userEvent.type(field, '@bob{Enter}');

  await vi.waitFor(() => expect(onToast).toHaveBeenCalledWith('Заявка отправлена'));
  expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ login: 'bob' });
  expect((field as HTMLInputElement).value).toBe('');
});

test('a refused request keeps the login and shows the reason', async () => {
  stubFetch({
    'POST /api/friends/requests': { status: 404, body: { ok: false, error: 'User not found', code: 'user_not_found' } }
  });
  const onToast = renderPeople();

  const field = screen.getByRole('textbox', { name: 'Логин друга' });
  await userEvent.type(field, 'nobody{Enter}');
  await vi.waitFor(() => expect(onToast).toHaveBeenCalledOnce());
  expect((field as HTMLInputElement).value).toBe('nobody');
});

test('an incoming request is accepted from its card', async () => {
  const { calls } = stubFetch({
    'POST /api/friends/requests/req-1/accept': { body: { ok: true, status: 'accepted', user: bob } },
    'GET /api/friends': { body: { ok: true, incomingRequestCount: 0, friends: [] } },
    'GET /api/friends/requests': { body: { ok: true, incoming: [], outgoing: [] } }
  });
  const lobby = new LobbyStore();
  lobby.requests = { incoming: [{ id: 'req-1', createdAt: 1, mutualFriends: 2, user: bob }], outgoing: [] };
  const onToast = renderPeople(lobby);

  expect(screen.getByText('2 общих друга')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Принять' }));
  await vi.waitFor(() => expect(onToast).toHaveBeenCalledWith('Заявка принята'));
  expect(calls.some((call) => call.url === '/api/friends/requests/req-1/accept')).toBe(true);
});
