// The lobby signs out when the server ends this device's session: quietly when
// this device asked for it, with a message when it happened elsewhere. A
// ?dm= link lands on that conversation. An administrator gets the panel in
// the header, at its own address, and a new report as a notice that stays.

import { cleanup, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import LobbyPage from '../../src/lib/features/home/LobbyPage.svelte';
import { expectSessionEnd, session, setUser } from '../../src/lib/features/auth/session.svelte';
import { stubFetch } from '../fixtures/fetch.ts';
import { FakeWebSocket, installFakeWebSocket } from '../fixtures/fake-websocket.ts';
import { authUser } from '../fixtures/users.ts';
import { stubMatchMedia } from '../helpers/match-media.ts';
import { defined } from '../helpers/assert.ts';
import { state as roomClientState } from '../../src/lib/features/room/client/core/state.svelte';
import { voiceSession } from '../../src/lib/features/room/voice-session.svelte';
import type { ToastOptions } from '../../src/lib/features/home/model/toasts.svelte';

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
  voiceSession.roomId = null;
  roomClientState.roomId = '';
  roomClientState.roomName = '';
});

function stubLobby(extra: Parameters<typeof stubFetch>[0] = {}) {
  return stubFetch({
    ...extra,
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
  const onToast = vi.fn<(message: string, options?: ToastOptions) => void>();
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

test('the call card names a room the list does not have, such as a temporary one', async () => {
  stubLobby();
  roomClientState.roomId = 'tmp123';
  roomClientState.roomName = 'Созвон';
  voiceSession.roomId = 'tmp123';
  renderLobby();

  expect(await screen.findByRole('button', { name: 'Открыть комнату Созвон' })).toBeTruthy();
});

const asStaff = (openReports = 0) => ({
  'GET /api/staff/access': { body: { ok: true, staff: true, adminUrl: 'https://admin.example.test/', openReports } }
});

test('staff get an entry to the admin app beside the logo, with the open reports on it', async () => {
  stubLobby(asStaff(2));
  renderLobby();
  const entry = await screen.findByRole('button', { name: 'Открыть админку' });
  expect(within(entry).getByLabelText('открытых жалоб: 2')).toBeTruthy();
  const opened = vi.spyOn(window, 'open').mockReturnValue(null);
  await userEvent.click(entry);
  expect(opened).toHaveBeenCalledWith('https://admin.example.test/', '_blank', 'noopener');
  opened.mockRestore();
});

test('an account that is not staff gets no link', async () => {
  stubLobby({
    'GET /api/staff/access': { body: { ok: true, staff: false, adminUrl: null, openReports: 0 } }
  });
  renderLobby();
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Открыть настройки' })).toBeTruthy());
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByRole('button', { name: 'Открыть админку' })).toBeNull();
});

test('a new report reaches staff as a notice that stays until closed and opens the reports in the admin app', async () => {
  stubLobby(asStaff(0));
  const onToast = renderLobby();
  const current = await socket();
  await screen.findByRole('button', { name: 'Открыть админку' });
  const opened = vi.spyOn(window, 'open').mockReturnValue(null);

  current.receive({
    type: 'admin.reports',
    payload: { openReports: 1, filed: { reason: 'spam', targetKind: 'room_message', roomName: 'Кухня' } }
  });
  await vi.waitFor(() => expect(onToast).toHaveBeenCalledWith('Новая жалоба', expect.anything()));
  const options = defined(
    defined(
      onToast.mock.calls.find(([message]) => message === 'Новая жалоба'),
      'report notice'
    )[1],
    'notice options'
  );
  expect(options).toMatchObject({ duration: 0, description: 'Спам или реклама · комната «Кухня»' });
  expect(
    within(screen.getByRole('button', { name: 'Открыть админку' })).getByLabelText('открытых жалоб: 1')
  ).toBeTruthy();

  defined(defined(options.actions, 'notice actions')[0], 'the notice action').onClick('toast-1');
  expect(opened).toHaveBeenCalledWith('https://admin.example.test/reports', '_blank', 'noopener');
  opened.mockRestore();

  // A resolved report only moves the count.
  onToast.mockClear();
  current.receive({ type: 'admin.reports', payload: { openReports: 0, filed: null } });
  await vi.waitFor(() => expect(screen.queryByLabelText('открытых жалоб: 1')).toBeNull());
  expect(onToast).not.toHaveBeenCalled();
});
