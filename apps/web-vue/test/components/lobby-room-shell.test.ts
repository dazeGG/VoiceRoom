// The lobby and the room it hosts talk through the room shell: a room that is
// left closes in the lobby, a room that changes refreshes the lobby's list, and
// an invitation accepted in a DM opens its room.

import { screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import LobbyPage from '@/features/home/LobbyPage.vue';
import { useSessionStore } from '@/features/auth/session.store';
import { usePageStore } from '@/stores/page.store';
import { stubFetch } from '../fixtures/fetch.ts';
import { installFakeWebSocket } from '../fixtures/fake-websocket.ts';
import { authUser } from '../fixtures/users.ts';
import { stubMatchMedia } from '../helpers/match-media.ts';
import { stubOverlayDom } from '../helpers/overlay-dom';
import { renderWithApp } from '../helpers/render.ts';

vi.mock('../../src/features/room/RoomPage.vue', () => import('./harness/RoomShellHarness'));

stubOverlayDom();

const user = authUser({ id: 'ada', login: 'ada', displayName: 'Ада' });
const bob = authUser({ id: 'bob', login: 'bob', displayName: 'Боб' });

beforeEach(() => {
  installFakeWebSocket();
  stubMatchMedia();
});
afterEach(() => {
  window.history.replaceState(null, '', '/');
});

const invite = {
  kind: 'dm',
  id: 'i1',
  author: { userId: 'bob' },
  recipientId: 'ada',
  content: { type: 'text', text: '' },
  createdAt: 1_000,
  cursor: 'c1',
  readCursor: 'r1',
  metadata: { kind: 'room-invite', roomId: 'abc123', roomName: 'Планёрка' }
};

function stubLobby() {
  return stubFetch({
    'GET /api/auth/rooms': { body: { ok: true, rooms: [] } },
    'GET /api/friends': {
      body: {
        ok: true,
        incomingRequestCount: 0,
        friends: [{ user: bob, online: true, friendsSince: 1, lastMessage: null, unreadCount: 0 }]
      }
    },
    'GET /api/friends/requests': { body: { ok: true, incoming: [], outgoing: [] } },
    'GET /api/dm/bob/history?mode=latest&limit=50': {
      body: {
        ok: true,
        contractVersion: 1,
        mode: 'latest',
        messages: [invite],
        pageInfo: { hasMoreBefore: false, hasMoreAfter: false }
      }
    },
    'POST /api/dm/bob/invites/i1/respond': {
      body: {
        ok: true,
        message: {
          id: 'i1',
          senderId: 'bob',
          recipientId: 'ada',
          body: '',
          createdAt: 1_000,
          editedAt: null,
          readAt: null,
          invite: { roomId: 'abc123', roomName: 'Планёрка', status: 'accepted', expiresAt: null }
        }
      }
    }
  });
}

async function renderLobby() {
  const view = await renderWithApp(LobbyPage, {
    props: { user, loggingOut: false, onLogout: vi.fn(), onToast: vi.fn() }
  });
  useSessionStore(view.pinia).setUser(user);
  return view;
}

const roomsFetches = (calls: Array<{ method: string; url: string }>): number =>
  calls.filter((call) => call.method === 'GET' && call.url === '/api/auth/rooms').length;

test('leaving the room the lobby shows closes it and gives the address back', async () => {
  window.history.replaceState(null, '', '/r/abc123');
  stubLobby();
  const { router, pinia } = await renderLobby();
  const replace = vi.spyOn(router, 'replace');

  await userEvent.click(await screen.findByRole('button', { name: 'Покинуть комнату' }));

  await vi.waitFor(() => expect(screen.queryByRole('region', { name: 'Комната abc123' })).toBeNull());
  expect(usePageStore(pinia).screen).toBe('start');
  expect(replace).toHaveBeenCalledWith('/');
});

test('a room that changes refreshes the lobby room list', async () => {
  window.history.replaceState(null, '', '/r/abc123');
  const { calls } = stubLobby();
  await renderLobby();
  const save = await screen.findByRole('button', { name: 'Сохранить комнату' });
  await vi.waitFor(() => expect(roomsFetches(calls)).toBeGreaterThan(0));
  const before = roomsFetches(calls);

  await userEvent.click(save);

  await vi.waitFor(() => expect(roomsFetches(calls)).toBe(before + 1));
});

test('accepting a room invitation in a DM opens that room', async () => {
  window.history.replaceState(null, '', '/?dm=bob');
  stubLobby();
  const { router } = await renderLobby();
  const push = vi.spyOn(router, 'push');

  await userEvent.click(await screen.findByRole('button', { name: 'Войти' }));

  expect(await screen.findByRole('region', { name: 'Комната abc123' })).toBeTruthy();
  expect(push).toHaveBeenCalledWith('/r/abc123');
});
