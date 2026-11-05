// Who enters a room, without costing the join round trips it does not need:
// inside the lobby the session is already known, and nothing in a join needs the
// ownership answer.

import { createPinia, setActivePinia } from 'pinia';
import { expect, test, vi } from 'vitest';
import { lobbyRoom } from '../fixtures/answers';
import { stubFetch, type Reply } from '../fixtures/fetch';
import { authUser } from '../fixtures/users';

async function load(routes: Record<string, Reply>, { embedded = false } = {}) {
  vi.resetModules();
  setActivePinia(createPinia());
  const { calls, fetchMock } = stubFetch(routes);
  const entry = await import('@/features/room/client/room/room-entry');
  const embed = await import('@/features/room/client/core/embed');
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  const { useSessionStore } = await import('@/features/auth/session.store');
  const { useRoomSettingsStore } = await import('@/features/room/room-settings.store');
  embed.setRoomEmbedded(embedded);
  Object.assign(state, { roomId: 'abc123', roomIsStatic: false });
  return { entry, calls, fetchMock, useSessionStore, useRoomSettingsStore };
}

test('inside the lobby the known session is not fetched again', async () => {
  const { entry, calls, useSessionStore } = await load(
    { '/api/auth/rooms': { body: { ok: true, rooms: [] } } },
    { embedded: true }
  );
  useSessionStore().setUser(authUser());

  await expect(entry.resolveRoomEntryName()).resolves.toBe('authenticated');
  expect(calls.map((call) => call.url)).not.toContain('/api/auth/me');
});

test('inside the lobby with no known session the server is still asked', async () => {
  const { entry, calls } = await load(
    {
      '/api/auth/me': { body: { ok: true, user: authUser() } },
      '/api/auth/rooms': { body: { ok: true, rooms: [] } }
    },
    { embedded: true }
  );

  await expect(entry.resolveRoomEntryName()).resolves.toBe('authenticated');
  expect(calls.map((call) => call.url)).toContain('/api/auth/me');
});

test('the entry does not wait for the ownership answer, which arrives on its own', async () => {
  let answerRooms: (value: Response) => void = () => {};
  const { entry, fetchMock, useSessionStore, useRoomSettingsStore } = await load({}, { embedded: true });
  useSessionStore().setUser(authUser());
  fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (answerRooms = resolve)));

  await expect(entry.resolveRoomEntryName()).resolves.toBe('authenticated');
  expect(useRoomSettingsStore().isOwner).toBe(false);

  answerRooms(
    new Response(JSON.stringify({ ok: true, rooms: [lobbyRoom({ roomId: 'abc123', relationship: 'owner' })] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  );
  await vi.waitFor(() => expect(useRoomSettingsStore().isOwner).toBe(true));
});
