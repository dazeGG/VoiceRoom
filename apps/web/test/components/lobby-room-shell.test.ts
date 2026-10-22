// The lobby and the room it hosts talk through the room shell: a room that is
// left closes in the lobby, a room that changes refreshes the lobby's list, and
// an invitation accepted in a DM opens its room.

import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { pushState, replaceState } from '$app/navigation';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import LobbyPage from '../../src/lib/features/home/LobbyPage.svelte';
import { setUser } from '../../src/lib/features/auth/session.svelte';
import { clearEmbeddedRoom, clearViewedRoom } from '../../src/lib/features/home/model/room-navigation.svelte';
import { stubFetch } from '../fixtures/fetch.ts';
import { installFakeWebSocket } from '../fixtures/fake-websocket.ts';
import { authUser } from '../fixtures/users.ts';
import { stubMatchMedia } from '../helpers/match-media.ts';

vi.mock('$app/navigation', () => ({ pushState: vi.fn(), replaceState: vi.fn(), goto: vi.fn(async () => {}) }));
vi.mock('../../src/lib/features/room/RoomPage.svelte', () => import('./harness/RoomShellHarness.svelte'));

const user = authUser({ id: 'ada', login: 'ada', displayName: 'Ада' });
const bob = authUser({ id: 'bob', login: 'bob', displayName: 'Боб' });

beforeEach(() => {
  installFakeWebSocket();
  stubMatchMedia();
  setUser(user);
});
afterEach(() => {
  cleanup();
  clearEmbeddedRoom();
  clearViewedRoom();
  window.history.replaceState(null, '', '/');
  vi.mocked(pushState).mockClear();
  vi.mocked(replaceState).mockClear();
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

function renderLobby(): void {
  render(LobbyPage, { props: { user, loggingOut: false, onLogout: vi.fn(), onToast: vi.fn() } });
}

const roomsFetches = (calls: Array<{ method: string; url: string }>): number =>
  calls.filter((call) => call.method === 'GET' && call.url === '/api/auth/rooms').length;

test('leaving the room the lobby shows closes it and gives the address back', async () => {
  window.history.replaceState(null, '', '/r/abc123');
  stubLobby();
  renderLobby();

  await userEvent.click(await screen.findByRole('button', { name: 'Покинуть комнату' }));

  await vi.waitFor(() => expect(screen.queryByRole('region', { name: 'Комната abc123' })).toBeNull());
  expect(document.body.dataset.screen).toBe('start');
  expect(vi.mocked(replaceState)).toHaveBeenCalledWith('/', {});
});

test('a room that changes refreshes the lobby room list', async () => {
  window.history.replaceState(null, '', '/r/abc123');
  const { calls } = stubLobby();
  renderLobby();
  const save = await screen.findByRole('button', { name: 'Сохранить комнату' });
  await vi.waitFor(() => expect(roomsFetches(calls)).toBeGreaterThan(0));
  const before = roomsFetches(calls);

  await userEvent.click(save);

  await vi.waitFor(() => expect(roomsFetches(calls)).toBe(before + 1));
});

test('accepting a room invitation in a DM opens that room', async () => {
  window.history.replaceState(null, '', '/?dm=bob');
  stubLobby();
  renderLobby();

  await userEvent.click(await screen.findByRole('button', { name: 'Войти' }));

  expect(await screen.findByRole('region', { name: 'Комната abc123' })).toBeTruthy();
  expect(vi.mocked(pushState)).toHaveBeenCalledWith('/r/abc123', {});
});
