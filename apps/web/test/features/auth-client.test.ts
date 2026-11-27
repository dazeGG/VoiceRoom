// Unexpected backend failures surface as errors; they are never turned into
// "signed out" or "no rooms".

import { beforeEach, expect, test, vi } from 'vitest';
import { stubFetch } from '../fixtures/fetch.ts';
import { authUser } from '../fixtures/users.ts';
import { freshImport } from '../helpers/fresh-module.ts';

vi.mock('../../src/features/home/model/push-notifications.store', () => ({
  usePushNotificationsStore: () => ({ detachPushSubscription: vi.fn(async () => {}) })
}));

beforeEach(() => localStorage.clear());

test('registration acknowledges the announcement before returning even if the acknowledgement fails', async () => {
  const user = authUser();
  const { calls, fetchMock } = stubFetch({
    'POST /api/auth/register': { status: 201, body: { ok: true, user } },
    'POST /api/auth/whats-new/seen': { status: 500, body: { ok: false, error: 'unavailable' } }
  });
  const acknowledgement = Promise.withResolvers<void>();
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    const reply = await fetchMock(url, init);
    if (url === '/api/auth/whats-new/seen') await acknowledgement.promise;
    return reply;
  });
  const { register } = await import('../../src/api/auth.ts');
  const input = { login: user.login, password: 'password123', passwordConfirm: 'password123' };
  const onRegistered = vi.fn<(value: typeof user) => void>();
  const registered = register(input).then(onRegistered);
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  expect(onRegistered).not.toHaveBeenCalled();
  acknowledgement.resolve();
  await registered;
  expect(onRegistered).toHaveBeenCalledWith(user);
  expect(calls).toEqual([
    { method: 'POST', url: '/api/auth/register', body: input },
    { method: 'POST', url: '/api/auth/whats-new/seen', body: { release: 'web/1.5.0' } }
  ]);
});

test('a failing room list is an error, not an empty list', async () => {
  stubFetch({ '/api/auth/rooms': { status: 500 } });
  const { fetchOwnedRooms } = await import('../../src/api/auth.ts');
  await expect(fetchOwnedRooms()).rejects.toThrow('Не удалось загрузить комнаты');
});

test('an empty room list is an empty list', async () => {
  stubFetch({ '/api/auth/rooms': { body: { ok: true, rooms: [] } } });
  const { fetchOwnedRooms } = await import('../../src/api/auth.ts');
  await expect(fetchOwnedRooms()).resolves.toEqual([]);
});

async function signedIn() {
  const signOutModule = await freshImport(() => import('../../src/features/home/model/sign-out.ts'));
  const session = (await import('../../src/features/auth/session.store.ts')).useSessionStore();
  session.setUser(authUser());
  return { ...signOutModule, session };
}

test('signing out ends the server session before forgetting the local one', async () => {
  const { calls } = stubFetch({ 'POST /api/auth/logout': { body: { ok: true } } });
  const app = await signedIn();

  await app.signOut();

  expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['POST /api/auth/logout']);
  expect(app.session.user).toBeNull();
  // The socket the server closes for this sign-out is expected, not "signed out elsewhere".
  expect(app.session.consumeExpectedSessionEnd()).toBe(true);
});

test('a failed sign-out keeps the account signed in and reports the failure', async () => {
  stubFetch({ 'POST /api/auth/logout': { status: 500, body: { ok: false, error: 'boom' } } });
  const app = await signedIn();

  await expect(app.signOut()).rejects.toThrow();
  expect(app.session.user?.login).toBe('anya');
  expect(app.session.consumeExpectedSessionEnd()).toBe(false);
});
