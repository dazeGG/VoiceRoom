// Opening a room link (/r/:roomId) outside the lobby: the room must exist,
// a signed-in account enters under its own name and saves the room, a guest
// is asked for a name, and a failed account check stops entry.

import { beforeEach, expect, test, vi } from 'vitest';
import { stubFetch, type Reply } from '../fixtures/fetch.ts';
import { lobbyRoom, roomStatus } from '../fixtures/answers.ts';
import { authUser } from '../fixtures/users.ts';

vi.mock('../../src/lib/features/room/client/ui/devices', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  refreshDevices: vi.fn(async () => {})
}));
vi.mock('../../src/lib/features/room/client/ui/toast', () => ({ showToast: vi.fn() }));

async function load(routes: Record<string, Reply>) {
  vi.resetModules();
  const fetchStub = stubFetch(routes);
  const shell = { roomLeft: vi.fn<(roomId: string) => void>(), roomsChanged: vi.fn<(roomId: string) => void>() };
  const { setRoomShell } = await import('../../src/lib/features/room/client/core/embed.ts');
  setRoomShell(shell);
  const room = await import('../../src/lib/features/room/client/room/room.ts');
  const { state } = await import('../../src/lib/features/room/client/core/state.svelte.ts');
  const names = await import('../../src/lib/features/room/client/ui/names.ts');
  const { guestNameUi } = await import('../../src/lib/features/room/guest-name-ui.svelte.ts');
  const { showToast } = await import('../../src/lib/features/room/client/ui/toast');
  state.roomId = 'abc123';
  return { ...room, ...names, state, guestNameUi, fetchStub, shell, showToast: vi.mocked(showToast) };
}

const roomExists = {
  '/api/rooms/abc123': { body: roomStatus({ name: 'Планёрка', isStatic: true }) }
};

beforeEach(() => {
  localStorage.clear();
  delete document.body.dataset.screen;
});

test('a missing room shows the not-found screen without checking the account', async () => {
  const app = await load({ '/api/rooms/abc123': { status: 404 } });
  await expect(app.showRoomRoute()).resolves.toBe(false);
  expect(document.body.dataset.screen).toBe('not-found');
  expect(app.fetchStub.calls.map((call) => call.url)).toEqual(['/api/rooms/abc123']);
});

test('a signed-in account enters under its name, saves the room to its list and learns ownership', async () => {
  const app = await load({
    ...roomExists,
    '/api/auth/me': { body: { ok: true, user: authUser({ displayName: 'Аня' }) } },
    'POST /api/auth/rooms': { body: { ok: true, room: lobbyRoom() } },
    '/api/auth/rooms': { body: { ok: true, rooms: [lobbyRoom({ relationship: 'owner' })] } }
  });

  await expect(app.showRoomRoute()).resolves.toBe(true);

  expect(document.body.dataset.screen).toBe('room');
  expect(app.state.roomName).toBe('Планёрка');
  expect(localStorage.getItem('voice-room:name')).toBe('Аня');
  await vi.waitFor(() => expect(app.shell.roomsChanged).toHaveBeenCalledWith('abc123'));
  const { roomSettingsUi } = await import('../../src/lib/features/room/room-settings.svelte.ts');
  expect(roomSettingsUi.isOwner).toBe(true);
});

test('a temporary room is not offered to the account list: only permanent rooms can be kept', async () => {
  const app = await load({
    '/api/rooms/abc123': { body: roomStatus({ name: 'Созвон', isStatic: false }) },
    '/api/auth/me': { body: { ok: true, user: authUser({ displayName: 'Аня' }) } },
    '/api/auth/rooms': { body: { ok: true, rooms: [] } }
  });

  await expect(app.showRoomRoute()).resolves.toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(app.fetchStub.calls.filter((call) => call.method === 'POST')).toEqual([]);
});

test('a failed account check stops entry instead of treating the visitor as a guest', async () => {
  const app = await load({ ...roomExists, '/api/auth/me': { status: 500 } });
  await expect(app.showRoomRoute()).resolves.toBe(false);
  expect(app.guestNameUi.open).toBe(false);
  expect(app.showToast).toHaveBeenCalledWith('Не удалось проверить аккаунт. Попробуйте обновить страницу.');
});

test('a guest is asked for a name; an empty name is refused and a real one enters', async () => {
  const app = await load({ ...roomExists, '/api/auth/me': { body: { ok: true, user: null } } });
  const entering = app.showRoomRoute();
  await vi.waitFor(() => expect(app.guestNameUi.open).toBe(true));

  app.guestNameUi.inputValue = '   ';
  app.handleGuestNameSubmit(new Event('submit'));
  expect(app.guestNameUi.error).toBe('Введите имя, чтобы войти в комнату');
  expect(app.guestNameUi.open).toBe(true);

  app.guestNameUi.inputValue = 'Гость Вася';
  app.handleGuestNameSubmit(new Event('submit'));
  await expect(entering).resolves.toBe(true);
  expect(localStorage.getItem('voice-room:name')).toBe('Гость Вася');
  expect(app.guestNameUi.open).toBe(false);
});

test('leaving the guest name prompt cancels entry', async () => {
  const app = await load({ ...roomExists, '/api/auth/me': { body: { ok: true, user: null } } });
  const entering = app.showRoomRoute();
  await vi.waitFor(() => expect(app.guestNameUi.open).toBe(true));
  app.resetGuestNameDialog();
  await expect(entering).resolves.toBe(false);
});
