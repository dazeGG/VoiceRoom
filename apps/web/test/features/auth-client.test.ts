// Unexpected backend failures surface as errors; they are never turned into
// "signed out" or "no rooms".

import { beforeEach, expect, test, vi } from 'vitest';
import { stubFetch } from '../fixtures/fetch.ts';
import { authUser } from '../fixtures/users.ts';
import { freshImport } from '../helpers/fresh-module.ts';
import type * as SignOutModule from '../../src/lib/features/home/model/sign-out.ts';

vi.mock('../../src/lib/features/home/model/push-notifications.svelte', () => ({
  detachPushSubscription: vi.fn(async () => {})
}));

beforeEach(() => localStorage.clear());

test('a failing room list is an error, not an empty list', async () => {
  stubFetch({ '/api/auth/rooms': { status: 500 } });
  const { fetchOwnedRooms } = await import('../../src/lib/api/auth.ts');
  await expect(fetchOwnedRooms()).rejects.toThrow('Не удалось загрузить комнаты');
});

test('an empty room list is an empty list', async () => {
  stubFetch({ '/api/auth/rooms': { body: { ok: true, rooms: [] } } });
  const { fetchOwnedRooms } = await import('../../src/lib/api/auth.ts');
  await expect(fetchOwnedRooms()).resolves.toEqual([]);
});

async function signedIn() {
  const signOutModule = await freshImport<typeof SignOutModule>('/src/lib/features/home/model/sign-out.ts');
  const session = await import('../../src/lib/features/auth/session.svelte.ts');
  session.setUser(authUser());
  return { ...signOutModule, ...session };
}

test('signing out ends the server session before forgetting the local one', async () => {
  const { calls } = stubFetch({ 'POST /api/auth/logout': { body: { ok: true } } });
  const app = await signedIn();

  await app.signOut();

  expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['POST /api/auth/logout']);
  expect(app.session.user).toBeNull();
  // The socket the server closes for this sign-out is expected, not "signed out elsewhere".
  expect(app.consumeExpectedSessionEnd()).toBe(true);
});

test('a failed sign-out keeps the account signed in and reports the failure', async () => {
  stubFetch({ 'POST /api/auth/logout': { status: 500, body: { ok: false, error: 'boom' } } });
  const app = await signedIn();

  await expect(app.signOut()).rejects.toThrow();
  expect(app.session.user?.login).toBe('anya');
  expect(app.consumeExpectedSessionEnd()).toBe(false);
});
