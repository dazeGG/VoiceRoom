// The lobby signs out when the server ends this device's session: quietly when
// this device asked for it, with a message when it happened elsewhere. A
// ?dm= link lands on that conversation.

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import LobbyPage from '../../src/lib/features/home/LobbyPage.svelte';
import { expectSessionEnd, session, setUser } from '../../src/lib/features/auth/session.svelte';
import { stubFetch } from '../fixtures/fetch.ts';
import { FakeWebSocket, installFakeWebSocket } from '../fixtures/fake-websocket.ts';
import { authUser } from '../fixtures/users.ts';
import { stubMatchMedia } from '../helpers/match-media.ts';

vi.mock('$app/navigation', () => ({ pushState: vi.fn(), replaceState: vi.fn(), goto: vi.fn(async () => {}) }));

const user = authUser({ id: 'ada', login: 'ada', displayName: 'Ада' });
const bob = authUser({ id: 'bob', login: 'bob', displayName: 'Боб' });

beforeEach(() => {
  installFakeWebSocket();
  stubMatchMedia();
  setUser(user);
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

function stubLobby() {
  return stubFetch({
    'GET /api/auth/rooms': { body: { ok: true, rooms: [] } },
    'GET /api/friends': {
      body: {
        ok: true,
        incomingRequestCount: 0,
        friends: [{ user: bob, online: true, friendsSince: 1, lastMessage: null, unreadCount: 2 }]
      }
    },
    'GET /api/friends/requests': { body: { ok: true, incoming: [], outgoing: [] } },
    'GET /api/dm/bob/history?mode=latest&limit=50': {
      body: {
        ok: true,
        contractVersion: 1,
        mode: 'latest',
        messages: [],
        pageInfo: { hasMoreBefore: false, hasMoreAfter: false }
      }
    }
  });
}

function renderLobby() {
  const onToast = vi.fn();
  render(LobbyPage, { props: { user, loggingOut: false, onLogout: vi.fn(), onToast } });
  return onToast;
}

async function socket(): Promise<FakeWebSocket> {
  await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
  const current = FakeWebSocket.latest();
  current.open();
  return current;
}

test('a session ended on another device signs out with a message', async () => {
  stubLobby();
  const onToast = renderLobby();
  (await socket()).serverClose(4401);

  await vi.waitFor(() => expect(session.user).toBeNull());
  expect(onToast).toHaveBeenCalledWith('Сеанс на этом устройстве завершён. Войдите снова');
});

test("this device's own sign-out ends the session without a second message", async () => {
  stubLobby();
  const onToast = renderLobby();
  const current = await socket();
  expectSessionEnd();
  current.serverClose(4401);

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(onToast).not.toHaveBeenCalledWith('Сеанс на этом устройстве завершён. Войдите снова');
  expect(session.user).not.toBeNull();
});

test('a ?dm= link opens that conversation', async () => {
  window.history.replaceState(null, '', '/?dm=bob');
  const { calls } = stubLobby();
  renderLobby();

  expect(await screen.findByRole('region', { name: 'Личные сообщения' })).toBeTruthy();
  await vi.waitFor(() => expect(calls.some((call) => call.url.startsWith('/api/dm/bob/history?'))).toBe(true));
});
